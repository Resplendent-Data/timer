//! ClickUp API v2 integration for Resplendent Timer.
//!
//! Split cleanly into:
//! - `types`: Public DTOs shared with Tauri commands and frontend TypeScript types.
//! - `client`: Running timer, quick start/backdating, stop+capture, PUT update, search, tags, and runtime polling.
//! - `leaderboard`: 30-day workspace team leaderboard aggregation.

mod client;
mod leaderboard;
mod types;

use std::sync::OnceLock;
use std::time::Duration;

pub use client::{
    add_rt_tag_to_time_entry, check_and_stop_timer_impl, debug_api_call, ensure_meeting_tag_exists,
    ensure_rt_tag_exists, get_recent_time_entries, get_running_timer, get_running_timer_info,
    get_time_entry_tags, get_today_time_entries, poll_runtime_impl, search_tasks,
    start_manual_timer, start_quick_timer, start_timer, stop_and_capture_timer, stop_timer,
    test_clickup_connection, update_time_entry,
};
pub use leaderboard::get_clickup_team_leaderboard;
pub use types::{
    IdleCheckResult, RunningTimerInfo, RuntimeSnapshot, StoppedTimeEntry, TaskSearchResult,
    TeamLeaderboardResponse, TimeEntrySummary, TimeEntryTag, UpdateTimeEntryPayload,
    WorkspaceConnectionInfo,
};

/// The tag used to identify time entries tracked by Resplendent Timer.
pub const RT_TAG_NAME: &str = "rt";
/// The tag used for meeting-mode entries.
pub const MEETING_TAG_NAME: &str = "meeting";

pub(crate) const RT_TAG_BG: &str = "#7b68ee";
pub(crate) const RT_TAG_FG: &str = "#ffffff";
pub(crate) const MEETING_TAG_BG: &str = "#2563eb";
pub(crate) const MEETING_TAG_FG: &str = "#ffffff";

/// Shared bounded HTTP client used across ClickUp and GitHub integrations
/// to minimize idle TLS connections and prevent hung sockets.
pub(crate) fn http_client() -> &'static reqwest::Client {
    static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .pool_max_idle_per_host(2)
            .pool_idle_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

pub(crate) fn parse_i64_from_value(value: &serde_json::Value) -> Option<i64> {
    match value {
        serde_json::Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_u64().and_then(|raw| i64::try_from(raw).ok())),
        serde_json::Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
}

pub(crate) fn id_from_value(value: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::String(text) = value {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    parse_i64_from_value(value).map(|id| id.to_string())
}

pub(crate) fn team_id_matches(team_value: &serde_json::Value, selected_team_id: &str) -> bool {
    let selected_team_id = selected_team_id.trim();
    let Some(candidate_id) = id_from_value(team_value) else {
        return false;
    };

    if candidate_id == selected_team_id {
        return true;
    }

    match (candidate_id.parse::<i64>(), selected_team_id.parse::<i64>()) {
        (Ok(candidate), Ok(selected)) => candidate == selected,
        _ => false,
    }
}

/// Build ClickUp tag JSON objects, always preserving the `"rt"` tracking tag.
pub(crate) fn build_tag_objects_with_rt(tags: Option<Vec<String>>) -> Vec<serde_json::Value> {
    let mut seen: Vec<String> = Vec::new();
    for tag in tags.unwrap_or_default() {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !seen.iter().any(|existing| existing.eq_ignore_ascii_case(trimmed)) {
            seen.push(trimmed.to_string());
        }
    }

    if !seen.iter().any(|t| t.eq_ignore_ascii_case(RT_TAG_NAME)) {
        seen.push(RT_TAG_NAME.to_string());
    }

    seen.into_iter()
        .map(|name| {
            if name.eq_ignore_ascii_case(RT_TAG_NAME) {
                serde_json::json!({
                    "name": RT_TAG_NAME,
                    "tag_bg": RT_TAG_BG,
                    "tag_fg": RT_TAG_FG
                })
            } else {
                serde_json::json!({ "name": name })
            }
        })
        .collect()
}
