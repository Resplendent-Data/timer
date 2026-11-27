//! ClickUp API v2 client for time entry lifecycle, backdating, updates, search, and tags.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use chrono::TimeZone;
use serde::Deserialize;

use crate::{idle_monitor, stats, tracker};

use super::types::{
    IdleCheckResult, RunningTimerInfo, RuntimeSnapshot, StoppedTimeEntry, TaskSearchResult,
    TaskTag, TimeEntrySummary, TimeEntryTag, UpdateTimeEntryPayload, WorkspaceConnectionInfo,
};
use super::{
    build_tag_objects_with_rt, http_client, id_from_value, parse_i64_from_value, team_id_matches,
    MEETING_TAG_BG, MEETING_TAG_FG, MEETING_TAG_NAME, RT_TAG_BG, RT_TAG_FG, RT_TAG_NAME,
};

/// Default max backdate cap (2 hours) if caller does not specify one.
const DEFAULT_MAX_BACKDATE_SECS: u64 = 2 * 60 * 60;

#[derive(Debug, Deserialize)]
struct SingleEntryResponse {
    data: Option<RawTimeEntry>,
}

#[derive(Debug, Deserialize)]
struct MultiEntryResponse {
    #[serde(default)]
    data: Vec<RawTimeEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawTimeEntry {
    id: serde_json::Value,
    #[serde(default)]
    task: Option<RawTask>,
    #[serde(default)]
    duration: serde_json::Value,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    start: Option<serde_json::Value>,
    #[serde(default)]
    end: Option<serde_json::Value>,
    #[serde(default)]
    tags: Vec<TimeEntryTag>,
    #[serde(default)]
    billable: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct RawTask {
    id: String,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Clone)]
struct TrackedSession {
    team_id: String,
    timer_id: String,
    start_time_ms: i64,
}

impl RawTimeEntry {
    fn id_str(&self) -> String {
        id_from_value(&self.id).unwrap_or_default()
    }

    fn duration_ms(&self) -> i64 {
        parse_i64_from_value(&self.duration).unwrap_or(0)
    }

    fn is_running(&self) -> bool {
        self.duration_ms() < 0
    }

    fn start_time_ms(&self) -> Option<i64> {
        self.start.as_ref().and_then(parse_i64_from_value)
    }

    fn end_time_ms(&self) -> Option<i64> {
        self.end.as_ref().and_then(parse_i64_from_value)
    }

    fn clean_description(&self) -> Option<String> {
        self.description
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    }

    fn task_id(&self) -> Option<String> {
        self.task
            .as_ref()
            .map(|t| t.id.trim().to_string())
            .filter(|id| !id.is_empty())
    }

    fn task_name(&self) -> Option<String> {
        self.task
            .as_ref()
            .and_then(|t| t.name.as_deref())
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_string)
    }

    fn display_name(&self) -> String {
        if let Some(name) = self.task_name() {
            return name;
        }
        if let Some(desc) = self.clean_description() {
            return desc;
        }
        "Untitled session".to_string()
    }
}

fn tracked_session_store() -> &'static Mutex<Option<TrackedSession>> {
    static TRACKED_SESSION: OnceLock<Mutex<Option<TrackedSession>>> = OnceLock::new();
    TRACKED_SESSION.get_or_init(|| Mutex::new(None))
}

fn known_time_entry_tag_cache() -> &'static Mutex<HashSet<String>> {
    static KNOWN_TIME_ENTRY_TAGS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    KNOWN_TIME_ENTRY_TAGS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn tag_cache_key(team_id: &str, tag_name: &str) -> String {
    format!("{}:{}", team_id.trim(), tag_name.trim().to_ascii_lowercase())
}

fn calculate_elapsed_secs(start_ms: i64, end_ms: i64) -> i64 {
    ((end_ms - start_ms) / 1000).max(0)
}

fn track_running_session(team_id: &str, timer: &RunningTimerInfo) -> Option<TrackedSession> {
    let Ok(mut guard) = tracked_session_store().lock() else {
        return None;
    };

    let previous = guard.take();
    let mut displaced: Option<TrackedSession> = None;

    if let Some(prev) = previous {
        let is_same_timer = prev.team_id == team_id && prev.timer_id == timer.id;
        if is_same_timer {
            *guard = Some(TrackedSession {
                team_id: team_id.to_string(),
                timer_id: timer.id.clone(),
                start_time_ms: timer.start_time_ms,
            });
            return None;
        }

        if prev.team_id == team_id {
            displaced = Some(prev);
        }
    }

    *guard = Some(TrackedSession {
        team_id: team_id.to_string(),
        timer_id: timer.id.clone(),
        start_time_ms: timer.start_time_ms,
    });

    displaced
}

fn capture_external_stop_for_team(team_id: &str) -> Option<TrackedSession> {
    let Ok(mut guard) = tracked_session_store().lock() else {
        return None;
    };

    let matches_team = guard
        .as_ref()
        .map(|session| session.team_id == team_id)
        .unwrap_or(false);

    if !matches_team {
        return None;
    }

    guard.take()
}

fn clear_tracked_session_for_team(team_id: &str) {
    let Ok(mut guard) = tracked_session_store().lock() else {
        return;
    };

    if guard
        .as_ref()
        .map(|session| session.team_id == team_id)
        .unwrap_or(false)
    {
        *guard = None;
    }
}

fn raw_to_running_info(entry: RawTimeEntry, team_id: &str) -> Option<RunningTimerInfo> {
    if !entry.is_running() {
        return None;
    }

    let id = entry.id_str();
    let raw_start_ms = entry.start_time_ms().unwrap_or(0);
    let pending_backdate = stats::get_pending_backdate(&id, team_id);
    let (effective_start_ms, is_backdated) = match pending_backdate {
        Some(backdate_ms) if raw_start_ms == 0 || backdate_ms < raw_start_ms => (backdate_ms, true),
        _ => (raw_start_ms, false),
    };

    let is_manual = entry.task_id().is_none();
    let description = entry.clean_description();

    Some(RunningTimerInfo {
        id,
        name: entry.display_name(),
        task_id: entry.task_id(),
        start_time_ms: effective_start_ms,
        raw_start_time_ms: raw_start_ms,
        is_backdated,
        description,
        is_manual,
        tags: entry.tags,
        billable: entry.billable,
    })
}

fn raw_to_summary(entry: RawTimeEntry, team_id: &str, now_ms: i64) -> TimeEntrySummary {
    let id = entry.id_str();
    let is_running = entry.is_running();
    let raw_start_ms = entry.start_time_ms().unwrap_or(now_ms);
    let effective_start_ms = if is_running {
        stats::get_pending_backdate(&id, team_id)
            .filter(|backdate_ms| *backdate_ms < raw_start_ms)
            .unwrap_or(raw_start_ms)
    } else {
        raw_start_ms
    };

    let end_ms = if is_running {
        now_ms
    } else {
        entry
            .end_time_ms()
            .unwrap_or_else(|| effective_start_ms + entry.duration_ms().max(0))
    };

    let duration_secs = if is_running {
        calculate_elapsed_secs(effective_start_ms, now_ms)
    } else {
        let api_secs = (entry.duration_ms() / 1000).max(0);
        if api_secs > 0 {
            api_secs
        } else {
            calculate_elapsed_secs(effective_start_ms, end_ms)
        }
    };

    let is_manual = entry.task_id().is_none();
    let description = entry.clean_description();
    let name = entry.display_name();
    let task_id = entry.task_id();
    let task_name = entry.task_name();

    TimeEntrySummary {
        id,
        name,
        task_id,
        task_name,
        description,
        start_time_ms: effective_start_ms,
        end_time_ms: end_ms,
        duration_secs,
        is_manual,
        tags: entry.tags,
        billable: entry.billable,
        is_running,
    }
}

async fn fetch_running_time_entry(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
) -> Result<Option<RawTimeEntry>, String> {
    let current_url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/current",
        team_id
    );

    let response = client
        .get(&current_url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch running timer: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    let running_response: SingleEntryResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse running timer response: {}", e))?;

    Ok(running_response.data)
}

async fn fetch_single_time_entry(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
    entry_id: &str,
) -> Result<Option<RawTimeEntry>, String> {
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/{}",
        team_id, entry_id
    );

    let response = client
        .get(&url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch time entry: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    let parsed: SingleEntryResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse time entry response: {}", e))?;

    Ok(parsed.data)
}

/// Build the JSON body for ClickUp's `PUT /team/{team_id}/time_entries/{timer_id}`.
pub(crate) fn build_update_time_entry_body(payload: &UpdateTimeEntryPayload) -> serde_json::Value {
    let mut body = serde_json::Map::new();

    if let Some(desc) = &payload.description {
        body.insert(
            "description".to_string(),
            serde_json::Value::String(desc.trim().to_string()),
        );
    }

    if payload.clear_task == Some(true) {
        body.insert("tid".to_string(), serde_json::Value::Null);
    } else if let Some(tid) = &payload.task_id {
        let trimmed = tid.trim();
        if !trimmed.is_empty() {
            body.insert(
                "tid".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }

    if let Some(billable) = payload.billable {
        body.insert("billable".to_string(), serde_json::Value::Bool(billable));
    }

    if let Some(tags) = &payload.tags {
        let tag_objects = build_tag_objects_with_rt(Some(tags.clone()));
        body.insert("tags".to_string(), serde_json::Value::Array(tag_objects));
        body.insert(
            "tag_action".to_string(),
            serde_json::Value::String("replace".to_string()),
        );
    }

    // ClickUp API v2 requires both `start` and `end` together when modifying stopped timestamps.
    if let (Some(start_ms), Some(end_ms)) = (payload.start_time_ms, payload.end_time_ms) {
        if end_ms > start_ms {
            body.insert("start".to_string(), serde_json::json!(start_ms));
            body.insert("end".to_string(), serde_json::json!(end_ms));
        }
    }

    serde_json::Value::Object(body)
}

/// Best-effort live backdate update on a running entry. Returns `true` if ClickUp accepted
/// and confirmed the new start timestamp immediately; `false` triggers SQLite pending_backdate fallback.
async fn try_live_backdate_running_entry(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
    entry_id: &str,
    backdate_start_ms: i64,
    existing_tags: &[TimeEntryTag],
) -> bool {
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/{}",
        team_id, entry_id
    );

    let tag_names: Vec<String> = existing_tags.iter().map(|t| t.name.clone()).collect();
    let body = serde_json::json!({
        "start": backdate_start_ms,
        "tags": build_tag_objects_with_rt(Some(tag_names)),
        "tag_action": "replace"
    });

    let Ok(response) = client
        .put(&url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    else {
        return false;
    };

    if !response.status().is_success() {
        return false;
    }

    let Ok(parsed) = response.json::<SingleEntryResponse>().await else {
        return false;
    };

    parsed
        .data
        .and_then(|entry| entry.start_time_ms())
        .map(|actual_start| (actual_start - backdate_start_ms).abs() <= 2_000)
        .unwrap_or(false)
}

/// Apply a pending backdated start timestamp to a stopped ClickUp entry via PUT.
#[allow(clippy::too_many_arguments)]
async fn apply_pending_backdate_on_stopped_entry(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
    entry_id: &str,
    backdate_start_ms: i64,
    end_ms: i64,
    tags: &[TimeEntryTag],
    billable: bool,
    description: Option<&str>,
) -> bool {
    if backdate_start_ms >= end_ms {
        stats::clear_pending_backdate(entry_id);
        return false;
    }

    let payload = UpdateTimeEntryPayload {
        description: description.map(str::to_string),
        task_id: None,
        clear_task: None,
        billable: Some(billable),
        tags: Some(tags.iter().map(|t| t.name.clone()).collect()),
        start_time_ms: Some(backdate_start_ms),
        end_time_ms: Some(end_ms),
    };

    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/{}",
        team_id, entry_id
    );
    let body = build_update_time_entry_body(&payload);

    match client
        .put(&url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            stats::clear_pending_backdate(entry_id);
            true
        }
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            eprintln!(
                "[clickup] Failed to apply pending backdate on entry {} ({}): {}",
                entry_id, status, text
            );
            false
        }
        Err(err) => {
            eprintln!(
                "[clickup] Network error applying pending backdate on entry {}: {}",
                entry_id, err
            );
            false
        }
    }
}

/// Finalize any external stop (when a timer disappeared via ClickUp web/mobile),
/// applying pending backdate if one existed and recording session stats.
async fn finalize_external_stop(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
    prev: TrackedSession,
    now_ms: i64,
) {
    let mut final_start_ms = prev.start_time_ms;
    let mut final_end_ms = now_ms;

    if let Some(backdate_ms) = stats::get_pending_backdate(&prev.timer_id, team_id) {
        if let Ok(Some(stopped_entry)) =
            fetch_single_time_entry(client, api_key, team_id, &prev.timer_id).await
        {
            if let Some(end_ms) = stopped_entry.end_time_ms() {
                final_end_ms = end_ms;
            }
            let applied = apply_pending_backdate_on_stopped_entry(
                client,
                api_key,
                team_id,
                &prev.timer_id,
                backdate_ms,
                final_end_ms,
                &stopped_entry.tags,
                stopped_entry.billable,
                stopped_entry.clean_description().as_deref(),
            )
            .await;
            if applied {
                final_start_ms = backdate_ms;
            }
        }
    }

    let duration_secs = calculate_elapsed_secs(final_start_ms, final_end_ms);
    if duration_secs > 0 {
        stats::record_timer_session(duration_secs);
    }
    tracker::mark_timer_stopped_at(final_end_ms);
}

/// Unified 1-click timer starter (task or manual) with automatic two-tier backdating.
#[allow(clippy::too_many_arguments)]
pub async fn start_quick_timer(
    api_key: String,
    team_id: String,
    task_id: Option<String>,
    description: Option<String>,
    billable: bool,
    tags: Option<Vec<String>>,
    backdate_start_ms: Option<i64>,
    max_backdate_secs: Option<u64>,
) -> Result<RunningTimerInfo, String> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let clamped_backdate_ms = tracker::clamp_backdate_ms(
        now_ms,
        backdate_start_ms,
        max_backdate_secs.unwrap_or(DEFAULT_MAX_BACKDATE_SECS),
    );

    let client = http_client();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/start",
        team_id
    );

    let mut body = serde_json::json!({
        "billable": billable,
        "tags": build_tag_objects_with_rt(tags)
    });

    if let Some(tid) = task_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body["tid"] = serde_json::Value::String(tid.to_string());
    }

    if let Some(desc) = description
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        body["description"] = serde_json::Value::String(desc.to_string());
    }

    let response = client
        .post(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to start timer: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let response_text = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, response_text));
    }

    let started_entry = match response.json::<SingleEntryResponse>().await {
        Ok(SingleEntryResponse { data: Some(entry) }) if !entry.id_str().is_empty() => entry,
        _ => fetch_running_time_entry(client, &api_key, &team_id)
            .await?
            .ok_or_else(|| "Timer started but could not read running entry".to_string())?,
    };

    let entry_id = started_entry.id_str();
    let raw_start_ms = started_entry.start_time_ms().unwrap_or(now_ms);
    let mut effective_start_ms = raw_start_ms;
    let mut is_backdated = false;

    if let Some(target_start_ms) = clamped_backdate_ms {
        if target_start_ms < raw_start_ms.saturating_sub(5_000) {
            let live_applied = try_live_backdate_running_entry(
                client,
                &api_key,
                &team_id,
                &entry_id,
                target_start_ms,
                &started_entry.tags,
            )
            .await;

            if !live_applied {
                // Guaranteed fallback: persist locally and apply start+end via PUT on stop.
                stats::save_pending_backdate(&entry_id, &team_id, target_start_ms);
            }

            effective_start_ms = target_start_ms;
            is_backdated = true;
        }
    }

    let info = RunningTimerInfo {
        id: entry_id,
        name: started_entry.display_name(),
        task_id: started_entry.task_id(),
        start_time_ms: effective_start_ms,
        raw_start_time_ms: raw_start_ms,
        is_backdated,
        description: started_entry.clean_description(),
        is_manual: started_entry.task_id().is_none(),
        tags: started_entry.tags,
        billable: started_entry.billable,
    };

    tracker::mark_timer_running(true, now_ms);
    if let Some(displaced) = track_running_session(&team_id, &info) {
        finalize_external_stop(client, &api_key, &team_id, displaced, now_ms).await;
    }

    Ok(info)
}

/// Stop the currently running timer, apply any pending backdate, and return full entry metadata
/// for the post-stop Session Wrap-Up flow.
pub async fn stop_and_capture_timer(
    api_key: String,
    team_id: String,
) -> Result<StoppedTimeEntry, String> {
    let client = http_client();
    let now_ms = chrono::Utc::now().timestamp_millis();

    let pre_stop_running = fetch_running_time_entry(client, &api_key, &team_id)
        .await
        .ok()
        .flatten()
        .filter(|entry| entry.is_running());

    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/stop",
        team_id
    );

    let response = client
        .post(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to stop timer: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    let stopped_raw = response
        .json::<SingleEntryResponse>()
        .await
        .ok()
        .and_then(|resp| resp.data);

    let entry_id = stopped_raw
        .as_ref()
        .map(RawTimeEntry::id_str)
        .filter(|id| !id.is_empty())
        .or_else(|| pre_stop_running.as_ref().map(RawTimeEntry::id_str))
        .unwrap_or_default();

    let raw_start_ms = stopped_raw
        .as_ref()
        .and_then(RawTimeEntry::start_time_ms)
        .or_else(|| pre_stop_running.as_ref().and_then(RawTimeEntry::start_time_ms))
        .unwrap_or(now_ms);

    let end_ms = stopped_raw
        .as_ref()
        .and_then(RawTimeEntry::end_time_ms)
        .unwrap_or(now_ms)
        .max(raw_start_ms + 1_000);

    let task_id = stopped_raw
        .as_ref()
        .and_then(RawTimeEntry::task_id)
        .or_else(|| pre_stop_running.as_ref().and_then(RawTimeEntry::task_id));

    let task_name = stopped_raw
        .as_ref()
        .and_then(RawTimeEntry::task_name)
        .or_else(|| pre_stop_running.as_ref().and_then(RawTimeEntry::task_name));

    let description = stopped_raw
        .as_ref()
        .and_then(RawTimeEntry::clean_description)
        .or_else(|| {
            pre_stop_running
                .as_ref()
                .and_then(RawTimeEntry::clean_description)
        });

    let tags = stopped_raw
        .as_ref()
        .map(|e| e.tags.clone())
        .filter(|t| !t.is_empty())
        .or_else(|| pre_stop_running.as_ref().map(|e| e.tags.clone()))
        .unwrap_or_default();

    let billable = stopped_raw
        .as_ref()
        .map(|e| e.billable)
        .or_else(|| pre_stop_running.as_ref().map(|e| e.billable))
        .unwrap_or(false);

    let mut effective_start_ms = raw_start_ms;
    let mut is_backdated = false;

    if !entry_id.is_empty() {
        if let Some(backdate_ms) = stats::get_pending_backdate(&entry_id, &team_id) {
            if apply_pending_backdate_on_stopped_entry(
                client,
                &api_key,
                &team_id,
                &entry_id,
                backdate_ms,
                end_ms,
                &tags,
                billable,
                description.as_deref(),
            )
            .await
            {
                effective_start_ms = backdate_ms;
                is_backdated = true;
            }
        }
    }

    let duration_secs = calculate_elapsed_secs(effective_start_ms, end_ms);
    if duration_secs > 0 {
        stats::record_timer_session(duration_secs);
    }

    clear_tracked_session_for_team(&team_id);
    tracker::mark_timer_stopped_at(end_ms);

    let is_manual = task_id.is_none();
    let name = task_name
        .clone()
        .or_else(|| description.clone())
        .unwrap_or_else(|| "Untitled session".to_string());

    Ok(StoppedTimeEntry {
        id: entry_id,
        name,
        task_id,
        task_name,
        description,
        start_time_ms: effective_start_ms,
        end_time_ms: end_ms,
        duration_secs,
        is_manual,
        tags,
        billable,
        is_backdated,
    })
}

/// Update an existing ClickUp time entry (post-stop Wrap-Up or quick edit).
pub async fn update_time_entry(
    api_key: String,
    team_id: String,
    entry_id: String,
    payload: UpdateTimeEntryPayload,
) -> Result<TimeEntrySummary, String> {
    let client = http_client();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/{}",
        team_id, entry_id
    );

    let body = build_update_time_entry_body(&payload);

    let response = client
        .put(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to update time entry: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let response_text = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, response_text));
    }

    if payload.start_time_ms.is_some() {
        stats::clear_pending_backdate(&entry_id);
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    if let Ok(SingleEntryResponse { data: Some(raw) }) = response.json::<SingleEntryResponse>().await
    {
        return Ok(raw_to_summary(raw, &team_id, now_ms));
    }

    // Fallback: re-fetch the updated entry to return accurate summary.
    if let Ok(Some(raw)) = fetch_single_time_entry(client, &api_key, &team_id, &entry_id).await {
        return Ok(raw_to_summary(raw, &team_id, now_ms));
    }

    let start_ms = payload.start_time_ms.unwrap_or(now_ms);
    let end_ms = payload.end_time_ms.unwrap_or(now_ms);
    Ok(TimeEntrySummary {
        id: entry_id,
        name: payload
            .description
            .clone()
            .filter(|d| !d.trim().is_empty())
            .unwrap_or_else(|| "Untitled session".to_string()),
        task_id: payload.task_id,
        task_name: None,
        description: payload.description,
        start_time_ms: start_ms,
        end_time_ms: end_ms,
        duration_secs: calculate_elapsed_secs(start_ms, end_ms),
        is_manual: true,
        tags: vec![],
        billable: payload.billable.unwrap_or(false),
        is_running: false,
    })
}

/// Fetch recent ClickUp time entries for the authenticated user across the last `days`
/// calendar days (defaults to 14, clamped to 1..=60), sorted newest first.
pub async fn get_recent_time_entries(
    api_key: String,
    team_id: String,
    days: Option<i64>,
) -> Result<Vec<TimeEntrySummary>, String> {
    let lookback_days = days.unwrap_or(14).clamp(1, 60);
    let client = http_client();
    let now_local = chrono::Local::now();
    let start_date = now_local
        .date_naive()
        .checked_sub_signed(chrono::Duration::days(lookback_days - 1))
        .unwrap_or_else(|| now_local.date_naive());
    let start_naive = start_date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| "Failed to compute local lookback start".to_string())?;
    let start_ms = chrono::Local
        .from_local_datetime(&start_naive)
        .earliest()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|| {
            chrono::Utc::now().timestamp_millis() - lookback_days * 24 * 3600 * 1000
        });
    let now_ms = chrono::Utc::now().timestamp_millis();

    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries",
        team_id
    );

    let response = client
        .get(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .query(&[
            ("start_date", start_ms.to_string()),
            ("end_date", (now_ms + 60_000).to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to fetch recent time entries: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    let parsed: MultiEntryResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse recent time entries: {}", e))?;

    let mut entries: Vec<TimeEntrySummary> = parsed
        .data
        .into_iter()
        .map(|raw| raw_to_summary(raw, &team_id, now_ms))
        .collect();

    entries.sort_by(|a, b| b.start_time_ms.cmp(&a.start_time_ms));
    Ok(entries)
}

/// Fetch today's ClickUp time entries for the authenticated user (newest first).
pub async fn get_today_time_entries(
    api_key: String,
    team_id: String,
) -> Result<Vec<TimeEntrySummary>, String> {
    get_recent_time_entries(api_key, team_id, Some(1)).await
}

#[derive(Debug, Deserialize)]
struct WorkspaceCheckResponse {
    #[serde(default)]
    teams: Vec<WorkspaceCheckTeam>,
}

#[derive(Debug, Deserialize)]
struct WorkspaceCheckTeam {
    id: serde_json::Value,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    members: Vec<serde_json::Value>,
}

/// Validate ClickUp API credentials and workspace access for Settings.
pub async fn test_clickup_connection(
    api_key: String,
    team_id: String,
) -> Result<WorkspaceConnectionInfo, String> {
    let client = http_client();
    let response = client
        .get("https://api.clickup.com/api/v2/team")
        .header("Authorization", api_key.trim())
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Network error contacting ClickUp: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp rejected credentials ({}): {}", status, body));
    }

    let payload: WorkspaceCheckResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse ClickUp workspace response: {}", e))?;

    let team = payload
        .teams
        .into_iter()
        .find(|t| team_id_matches(&t.id, &team_id))
        .ok_or_else(|| format!("Workspace ID \"{}\" was not found for this API key", team_id))?;

    Ok(WorkspaceConnectionInfo {
        connected: true,
        workspace_name: team
            .name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| format!("Workspace {}", team_id)),
        member_count: team.members.len(),
    })
}

/// Start a time entry for a specific task (compatibility wrapper).
pub async fn start_timer(
    api_key: String,
    team_id: String,
    task_id: String,
    billable: bool,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    start_quick_timer(
        api_key,
        team_id,
        Some(task_id),
        None,
        billable,
        tags,
        None,
        None,
    )
    .await
    .map(|_| ())
}

/// Stop the currently running timer (compatibility wrapper).
pub async fn stop_timer(api_key: String, team_id: String) -> Result<(), String> {
    stop_and_capture_timer(api_key, team_id).await.map(|_| ())
}

/// Start a manual time entry (compatibility wrapper).
pub async fn start_manual_timer(
    api_key: String,
    team_id: String,
    description: Option<String>,
    billable: bool,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    start_quick_timer(
        api_key,
        team_id,
        None,
        description,
        billable,
        tags,
        None,
        None,
    )
    .await
    .map(|_| ())
}

#[derive(Debug, Deserialize)]
struct TaskSearchApiResult {
    id: String,
    name: String,
    custom_id: Option<String>,
    status: Option<TaskStatus>,
    list: Option<TaskList>,
    folder: Option<TaskFolder>,
    space: Option<TaskSpace>,
    #[serde(default)]
    tags: Vec<TaskTag>,
}

#[derive(Debug, Deserialize)]
struct TaskStatus {
    status: String,
    color: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskList {
    name: String,
}

#[derive(Debug, Deserialize)]
struct TaskFolder {
    name: String,
    #[serde(default)]
    hidden: bool,
}

#[derive(Debug, Deserialize)]
struct TaskSpace {
    name: Option<String>,
}

impl From<TaskSearchApiResult> for TaskSearchResult {
    fn from(api: TaskSearchApiResult) -> Self {
        TaskSearchResult {
            id: api.id,
            name: api.name,
            custom_id: api.custom_id,
            status_name: api.status.as_ref().map(|s| s.status.clone()),
            status_color: api.status.and_then(|s| s.color),
            list_name: api.list.map(|l| l.name),
            folder_name: api
                .folder
                .and_then(|f| if f.hidden { None } else { Some(f.name) }),
            space_name: api.space.and_then(|s| s.name),
            tags: api.tags,
        }
    }
}

#[derive(Debug, Deserialize)]
struct TaskSearchApiResponse {
    tasks: Vec<TaskSearchApiResult>,
}

/// Search for tasks in a workspace.
pub async fn search_tasks(
    api_key: String,
    team_id: String,
    query: String,
) -> Result<Vec<TaskSearchResult>, String> {
    let client = http_client();
    let url = format!("https://api.clickup.com/api/v2/team/{}/task", team_id);

    let query_lower = query.to_lowercase();
    let query_words: Vec<&str> = query_lower.split_whitespace().collect();

    let api_search_term = query_words
        .iter()
        .find(|w| w.len() >= 2)
        .copied()
        .unwrap_or(&query_lower);

    let response = client
        .get(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .query(&[
            ("search", api_search_term),
            ("page", "0"),
            ("order_by", "updated"),
            ("reverse", "true"),
            ("subtasks", "true"),
            ("include_closed", "true"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to search tasks: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    let search_response: TaskSearchApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let tasks: Vec<TaskSearchResult> = search_response
        .tasks
        .into_iter()
        .map(TaskSearchResult::from)
        .filter(|task| {
            let name_lower = task.name.to_lowercase();
            query_words.iter().all(|word| name_lower.contains(word))
        })
        .collect();

    Ok(tasks)
}

#[derive(Debug, Deserialize)]
struct TimeEntryTagsResponse {
    data: Vec<TimeEntryTag>,
}

/// Get all time entry tags for a workspace.
pub async fn get_time_entry_tags(
    api_key: String,
    team_id: String,
) -> Result<Vec<TimeEntryTag>, String> {
    let client = http_client();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/tags",
        team_id
    );

    let response = client
        .get(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch time entry tags: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    let tags_response: TimeEntryTagsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(tags_response.data)
}

async fn ensure_time_entry_tag_exists(
    api_key: String,
    team_id: String,
    tag_name: &str,
    tag_bg: &str,
    tag_fg: &str,
) -> Result<bool, String> {
    let cache_key = tag_cache_key(&team_id, tag_name);
    if known_time_entry_tag_cache()
        .lock()
        .map(|cache| cache.contains(&cache_key))
        .unwrap_or(false)
    {
        return Ok(false);
    }

    let existing_tags = get_time_entry_tags(api_key.clone(), team_id.clone()).await?;
    if existing_tags
        .iter()
        .any(|t| t.name.eq_ignore_ascii_case(tag_name))
    {
        if let Ok(mut cache) = known_time_entry_tag_cache().lock() {
            cache.insert(cache_key);
        }
        return Ok(false);
    }

    let client = http_client();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/tags",
        team_id
    );

    let body = serde_json::json!({
        "tag": {
            "name": tag_name,
            "tag_bg": tag_bg,
            "tag_fg": tag_fg
        }
    });

    let response = client
        .post(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to create {} tag: {}", tag_name, e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "ClickUp API error creating {} tag ({}): {}",
            tag_name, status, body
        ));
    }

    if let Ok(mut cache) = known_time_entry_tag_cache().lock() {
        cache.insert(cache_key);
    }

    Ok(true)
}

pub async fn ensure_rt_tag_exists(api_key: String, team_id: String) -> Result<bool, String> {
    ensure_time_entry_tag_exists(api_key, team_id, RT_TAG_NAME, RT_TAG_BG, RT_TAG_FG).await
}

pub async fn ensure_meeting_tag_exists(api_key: String, team_id: String) -> Result<bool, String> {
    ensure_time_entry_tag_exists(
        api_key,
        team_id,
        MEETING_TAG_NAME,
        MEETING_TAG_BG,
        MEETING_TAG_FG,
    )
    .await
}

pub async fn add_rt_tag_to_time_entry(
    api_key: String,
    team_id: String,
    time_entry_id: String,
    existing_tags: Vec<TimeEntryTag>,
) -> Result<bool, String> {
    if existing_tags
        .iter()
        .any(|t| t.name.eq_ignore_ascii_case(RT_TAG_NAME))
    {
        return Ok(false);
    }

    let client = http_client();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/tags",
        team_id
    );

    let body = serde_json::json!({
        "time_entry_ids": [time_entry_id],
        "tags": [{
            "name": RT_TAG_NAME,
            "tag_bg": RT_TAG_BG,
            "tag_fg": RT_TAG_FG
        }]
    });

    let response = client
        .post(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to add rt tag to time entry: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "ClickUp API error adding rt tag ({}): {}",
            status, body
        ));
    }

    Ok(true)
}

pub async fn check_and_stop_timer_impl(
    api_key: String,
    team_id: String,
    idle_threshold_secs: u64,
) -> Result<IdleCheckResult, String> {
    let snapshot = poll_runtime_impl(api_key, team_id, idle_threshold_secs).await?;
    let running_timer = snapshot.running_timer;

    Ok(IdleCheckResult {
        stopped: snapshot.stopped,
        task_name: snapshot
            .stopped_task_name
            .or_else(|| running_timer.as_ref().map(|timer| timer.name.clone())),
        task_id: snapshot
            .stopped_task_id
            .or_else(|| running_timer.as_ref().and_then(|timer| timer.task_id.clone())),
        description: snapshot.stopped_description.or_else(|| {
            running_timer
                .as_ref()
                .and_then(|timer| timer.description.clone())
        }),
        is_manual: if snapshot.stopped {
            snapshot.stopped_is_manual
        } else {
            running_timer
                .as_ref()
                .map(|timer| timer.is_manual)
                .unwrap_or(false)
        },
        tags: if snapshot.stopped {
            snapshot.stopped_tags
        } else {
            running_timer
                .as_ref()
                .map(|timer| timer.tags.clone())
                .unwrap_or_default()
        },
        billable: if snapshot.stopped {
            snapshot.stopped_billable
        } else {
            running_timer
                .as_ref()
                .map(|timer| timer.billable)
                .unwrap_or(false)
        },
        idle_duration: snapshot.idle_duration,
        error: snapshot.error,
    })
}

/// Core runtime poll: samples OS idle time, syncs running timer, applies auto-stop & pending
/// backdates, and returns the current untracked active-session snapshot.
pub async fn poll_runtime_impl(
    api_key: String,
    team_id: String,
    idle_threshold_secs: u64,
) -> Result<RuntimeSnapshot, String> {
    let now_dt = chrono::Utc::now();
    let now_secs = now_dt.timestamp();
    let now_ms = now_dt.timestamp_millis();
    let idle_secs = idle_monitor::get_idle_time_secs().await?;
    let client = http_client();

    let running_entry = fetch_running_time_entry(client, &api_key, &team_id).await?;
    let Some(entry) = running_entry.filter(|entry| entry.is_running()) else {
        if let Some(prev) = capture_external_stop_for_team(&team_id) {
            finalize_external_stop(client, &api_key, &team_id, prev, now_ms).await;
        }
        tracker::mark_timer_running(false, now_ms);
        tracker::observe_sample(now_ms, idle_secs);
        let untracked = tracker::get_snapshot(now_ms);

        return Ok(RuntimeSnapshot {
            idle_duration: idle_secs,
            running_timer: None,
            active_untracked_since_ms: untracked.active_since_ms,
            active_untracked_secs: untracked.active_duration_secs,
            stopped: false,
            stopped_entry_id: None,
            stopped_task_name: None,
            stopped_task_id: None,
            stopped_description: None,
            stopped_is_manual: false,
            stopped_tags: vec![],
            stopped_billable: false,
            stopped_start_time_ms: None,
            stopped_end_time_ms: None,
            stopped_duration_secs: 0,
            stopped_is_backdated: false,
            error: None,
        });
    };

    let running_timer = raw_to_running_info(entry.clone(), &team_id);

    if idle_secs < idle_threshold_secs {
        tracker::mark_timer_running(true, now_ms);
        tracker::observe_sample(now_ms, idle_secs);
        if let Some(timer) = running_timer.as_ref() {
            if let Some(displaced) = track_running_session(&team_id, timer) {
                finalize_external_stop(client, &api_key, &team_id, displaced, now_ms).await;
            }
        }

        return Ok(RuntimeSnapshot {
            idle_duration: idle_secs,
            running_timer,
            active_untracked_since_ms: None,
            active_untracked_secs: 0,
            stopped: false,
            stopped_entry_id: None,
            stopped_task_name: None,
            stopped_task_id: None,
            stopped_description: None,
            stopped_is_manual: false,
            stopped_tags: vec![],
            stopped_billable: false,
            stopped_start_time_ms: None,
            stopped_end_time_ms: None,
            stopped_duration_secs: 0,
            stopped_is_backdated: false,
            error: None,
        });
    }

    // Idle threshold exceeded while timer is running -> auto-stop in ClickUp.
    let entry_id = entry.id_str();
    let task_name = entry.display_name();
    let task_id = entry.task_id();
    let description = entry.clean_description();
    let is_manual = task_id.is_none();
    let tags = entry.tags.clone();
    let billable = entry.billable;
    let raw_start_ms = entry.start_time_ms().unwrap_or(now_ms);

    let stop_url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/stop",
        team_id
    );

    let stop_response = client
        .post(&stop_url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to stop timer: {}", e))?;

    if !stop_response.status().is_success() {
        let status = stop_response.status();
        let body = stop_response.text().await.unwrap_or_default();
        stats::record_idle_event(
            now_secs,
            idle_secs as i64,
            false,
            Some(task_name.clone()),
            task_id.clone(),
            0,
        );
        tracker::mark_timer_running(true, now_ms);
        return Ok(RuntimeSnapshot {
            idle_duration: idle_secs,
            running_timer,
            active_untracked_since_ms: None,
            active_untracked_secs: 0,
            stopped: false,
            stopped_entry_id: None,
            stopped_task_name: None,
            stopped_task_id: None,
            stopped_description: None,
            stopped_is_manual: false,
            stopped_tags: vec![],
            stopped_billable: false,
            stopped_start_time_ms: None,
            stopped_end_time_ms: None,
            stopped_duration_secs: 0,
            stopped_is_backdated: false,
            error: Some(format!("Failed to stop timer ({}): {}", status, body)),
        });
    }

    let stopped_raw = stop_response
        .json::<SingleEntryResponse>()
        .await
        .ok()
        .and_then(|resp| resp.data);
    let stopped_end_ms = stopped_raw
        .as_ref()
        .and_then(RawTimeEntry::end_time_ms)
        .unwrap_or(now_ms)
        .max(raw_start_ms + 1_000);

    let mut effective_start_ms = raw_start_ms;
    let mut is_backdated = false;
    if let Some(backdate_ms) = stats::get_pending_backdate(&entry_id, &team_id) {
        if apply_pending_backdate_on_stopped_entry(
            client,
            &api_key,
            &team_id,
            &entry_id,
            backdate_ms,
            stopped_end_ms,
            &tags,
            billable,
            description.as_deref(),
        )
        .await
        {
            effective_start_ms = backdate_ms;
            is_backdated = true;
        }
    }

    let session_duration = calculate_elapsed_secs(effective_start_ms, stopped_end_ms);
    stats::record_idle_event(
        now_secs,
        idle_secs as i64,
        true,
        Some(task_name.clone()),
        task_id.clone(),
        session_duration,
    );
    stats::record_timer_session(session_duration);
    clear_tracked_session_for_team(&team_id);
    tracker::mark_timer_stopped_at(stopped_end_ms);
    tracker::observe_sample(now_ms, idle_secs);
    let untracked = tracker::get_snapshot(now_ms);

    Ok(RuntimeSnapshot {
        idle_duration: idle_secs,
        running_timer: None,
        active_untracked_since_ms: untracked.active_since_ms,
        active_untracked_secs: untracked.active_duration_secs,
        stopped: true,
        stopped_entry_id: (!entry_id.is_empty()).then_some(entry_id),
        stopped_task_name: Some(task_name),
        stopped_task_id: task_id,
        stopped_description: description,
        stopped_is_manual: is_manual,
        stopped_tags: tags,
        stopped_billable: billable,
        stopped_start_time_ms: Some(effective_start_ms),
        stopped_end_time_ms: Some(stopped_end_ms),
        stopped_duration_secs: session_duration,
        stopped_is_backdated: is_backdated,
        error: None,
    })
}

pub async fn get_running_timer(api_key: String, team_id: String) -> Result<Option<String>, String> {
    let client = http_client();
    let running_entry = fetch_running_time_entry(client, &api_key, &team_id).await?;
    Ok(running_entry.and_then(|entry| entry.is_running().then(|| entry.display_name())))
}

pub async fn get_running_timer_info(
    api_key: String,
    team_id: String,
) -> Result<Option<RunningTimerInfo>, String> {
    let client = http_client();
    let running_entry = fetch_running_time_entry(client, &api_key, &team_id).await?;
    let info = running_entry.and_then(|entry| raw_to_running_info(entry, &team_id));
    let now_ms = chrono::Utc::now().timestamp_millis();

    if let Some(timer) = info.as_ref() {
        tracker::mark_timer_running(true, now_ms);
        if let Some(displaced) = track_running_session(&team_id, timer) {
            finalize_external_stop(client, &api_key, &team_id, displaced, now_ms).await;
        }
    } else if let Some(prev) = capture_external_stop_for_team(&team_id) {
        finalize_external_stop(client, &api_key, &team_id, prev, now_ms).await;
    }

    Ok(info)
}

pub async fn debug_api_call(api_key: String, team_id: String) -> Result<String, String> {
    let client = http_client();
    let current_url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/current",
        team_id
    );

    let response = client
        .get(&current_url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    Ok(format!(
        "URL: {}\nStatus: {}\nResponse: {}",
        current_url, status, body
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idle_check_result_serialization() {
        let result = IdleCheckResult {
            stopped: true,
            task_name: Some("Test Task".to_string()),
            task_id: Some("abc123".to_string()),
            description: None,
            is_manual: false,
            tags: vec![],
            billable: false,
            idle_duration: 600,
            error: None,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"stopped\":true"));
        assert!(json.contains("\"task_name\":\"Test Task\""));
        assert!(json.contains("\"task_id\":\"abc123\""));
        assert!(json.contains("\"is_manual\":false"));
        assert!(json.contains("\"idle_duration\":600"));
    }

    #[test]
    fn test_calculate_elapsed_secs_non_negative() {
        assert_eq!(calculate_elapsed_secs(1_000, 5_000), 4);
        assert_eq!(calculate_elapsed_secs(5_000, 1_000), 0);
    }

    #[test]
    fn test_build_update_time_entry_body_preserves_rt_tag_and_pairs_start_end() {
        let payload = UpdateTimeEntryPayload {
            description: Some("  Shipped new wrap-up flow  ".to_string()),
            task_id: Some("86abc".to_string()),
            clear_task: None,
            billable: Some(true),
            tags: Some(vec!["frontend".to_string()]),
            start_time_ms: Some(1_700_000_000_000),
            end_time_ms: Some(1_700_001_800_000),
        };

        let body = build_update_time_entry_body(&payload);
        assert_eq!(body["description"], "Shipped new wrap-up flow");
        assert_eq!(body["tid"], "86abc");
        assert_eq!(body["billable"], true);
        assert_eq!(body["tag_action"], "replace");
        assert_eq!(body["start"], 1_700_000_000_000_i64);
        assert_eq!(body["end"], 1_700_001_800_000_i64);

        let tags = body["tags"].as_array().unwrap();
        assert_eq!(tags.len(), 2);
        assert!(tags.iter().any(|t| t["name"] == "frontend"));
        assert!(tags.iter().any(|t| t["name"] == "rt"));
    }

    #[test]
    fn test_build_update_time_entry_body_omits_incomplete_time_range() {
        let payload = UpdateTimeEntryPayload {
            description: Some("Quick note".to_string()),
            start_time_ms: Some(1_700_000_000_000),
            end_time_ms: None,
            ..Default::default()
        };

        let body = build_update_time_entry_body(&payload);
        assert!(body.get("start").is_none());
        assert!(body.get("end").is_none());
        assert_eq!(body["description"], "Quick note");
    }

    #[test]
    fn test_build_update_time_entry_body_clears_task_when_requested() {
        let payload = UpdateTimeEntryPayload {
            clear_task: Some(true),
            task_id: Some("should_ignore".to_string()),
            ..Default::default()
        };

        let body = build_update_time_entry_body(&payload);
        assert_eq!(body["tid"], serde_json::Value::Null);
    }
}
