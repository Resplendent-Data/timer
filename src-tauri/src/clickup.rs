//! ClickUp API integration for time tracking.
//!
//! This module provides functions to interact with the ClickUp API
//! to check and manage time entries.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::{idle_monitor, stats};
/// Result of checking idle status and potentially stopping a timer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleCheckResult {
    /// Whether a timer was stopped due to inactivity
    pub stopped: bool,
    /// Name of the task that was stopped (if any)
    pub task_name: Option<String>,
    /// ID of the task that was stopped (for resume functionality)
    pub task_id: Option<String>,
    /// Description of the stopped time entry (for manual timers)
    pub description: Option<String>,
    /// Whether the stopped timer was manual (no task attached)
    #[serde(default)]
    pub is_manual: bool,
    /// Tags from the stopped time entry (used to preserve tags on resume)
    #[serde(default)]
    pub tags: Vec<TimeEntryTag>,
    /// Whether the stopped time entry was billable
    #[serde(default)]
    pub billable: bool,
    /// Current idle duration in seconds
    pub idle_duration: u64,
    /// Error message if something went wrong (but didn't prevent execution)
    pub error: Option<String>,
}

/// Information about a currently running timer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningTimerInfo {
    /// Time entry ID (needed for updating tags on externally-started timers)
    pub id: String,
    /// Name of the task or description for manual timers
    pub name: String,
    /// Task ID (None for manual timers without a task)
    pub task_id: Option<String>,
    /// Start time in milliseconds since epoch (for calculating elapsed time)
    pub start_time_ms: i64,
    /// Description of the time entry (for manual timers)
    pub description: Option<String>,
    /// Whether this is a manual timer (no task attached)
    pub is_manual: bool,
    /// Tags on this time entry
    pub tags: Vec<TimeEntryTag>,
    /// Whether this time entry is billable
    pub billable: bool,
}

/// Combined runtime snapshot used by the battery-first frontend scheduler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSnapshot {
    /// Current idle duration in seconds.
    pub idle_duration: u64,
    /// Currently running timer info, if any.
    pub running_timer: Option<RunningTimerInfo>,
    /// Whether the runtime poll auto-stopped a timer on this tick.
    pub stopped: bool,
    /// Name of the timer that was stopped, if any.
    pub stopped_task_name: Option<String>,
    /// Task ID of the timer that was stopped, if any.
    pub stopped_task_id: Option<String>,
    /// Description of the stopped timer for manual entries.
    pub stopped_description: Option<String>,
    /// Whether the stopped timer was a manual timer.
    #[serde(default)]
    pub stopped_is_manual: bool,
    /// Tags from the stopped timer.
    #[serde(default)]
    pub stopped_tags: Vec<TimeEntryTag>,
    /// Whether the stopped timer was billable.
    #[serde(default)]
    pub stopped_billable: bool,
    /// Best-effort error that did not prevent returning a snapshot.
    pub error: Option<String>,
}

/// A ranked leaderboard user for team comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamLeaderboardUser {
    pub user_id: String,
    pub username: String,
    #[serde(default)]
    pub profile_picture: Option<String>,
    pub active_seconds: i64,
    pub past_seconds: i64,
    pub total_seconds: i64,
    pub running_entry_count: i64,
}

/// Team leaderboard payload for the stats UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamLeaderboardResponse {
    pub window_days: i64,
    pub generated_at_ms: i64,
    #[serde(default)]
    pub is_partial: bool,
    #[serde(default)]
    pub warning: Option<String>,
    #[serde(default)]
    pub debug_details: Option<String>,
    pub users: Vec<TeamLeaderboardUser>,
}

#[derive(Debug, Deserialize)]
struct AuthorizedTeamsResponse {
    #[serde(default)]
    teams: Vec<AuthorizedTeam>,
}

#[derive(Debug, Deserialize)]
struct AuthorizedTeam {
    id: serde_json::Value,
    #[serde(default)]
    members: Vec<AuthorizedTeamMember>,
}

#[derive(Debug, Deserialize)]
struct AuthorizedTeamMember {
    user: AuthorizedTeamUser,
}

#[derive(Debug, Deserialize)]
struct AuthorizedTeamUser {
    id: serde_json::Value,
    #[serde(default)]
    username: Option<String>,
    #[serde(default, alias = "profilePicture")]
    profile_picture: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TimeEntriesResponse {
    #[serde(default)]
    data: Vec<TimeEntryApiResult>,
}

#[derive(Debug, Deserialize)]
struct TimeEntryApiResult {
    #[serde(default)]
    user: Option<TimeEntryApiUser>,
    #[serde(default)]
    assignee: Option<TimeEntryApiUser>,
    #[serde(default)]
    uid: Option<serde_json::Value>,
    duration: serde_json::Value,
    #[serde(default)]
    start: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct TimeEntryApiUser {
    id: serde_json::Value,
    #[serde(default)]
    username: Option<String>,
    #[serde(default, alias = "profilePicture")]
    profile_picture: Option<String>,
}

#[derive(Debug, Clone)]
struct TeamMemberIdentity {
    username: String,
    profile_picture: Option<String>,
}

#[derive(Debug, Clone)]
struct TeamMemberRecord {
    user_id: String,
    username: String,
    profile_picture: Option<String>,
}

#[derive(Debug, Clone)]
struct LeaderboardEntryInput {
    user_id: String,
    username: Option<String>,
    profile_picture: Option<String>,
    duration_ms: i64,
    start_ms: Option<i64>,
}

#[derive(Debug, Default, Clone)]
struct LeaderboardUserAccum {
    username: String,
    profile_picture: Option<String>,
    active_seconds: i64,
    past_seconds: i64,
    running_entry_count: i64,
}

#[derive(Debug)]
struct ClickUpApiError {
    context: &'static str,
    status: Option<StatusCode>,
    body: String,
}

impl ClickUpApiError {
    fn network(context: &'static str, error: reqwest::Error) -> Self {
        Self {
            context,
            status: error.status(),
            body: error.to_string(),
        }
    }

    fn http(context: &'static str, status: StatusCode, body: String) -> Self {
        Self {
            context,
            status: Some(status),
            body,
        }
    }

    fn parse(context: &'static str, error: impl std::fmt::Display) -> Self {
        Self {
            context,
            status: None,
            body: error.to_string(),
        }
    }

    fn into_message(self) -> String {
        match self.status {
            Some(status) => format!("{} ({}): {}", self.context, status, self.body),
            None => format!("{}: {}", self.context, self.body),
        }
    }
}

/// Response from ClickUp "Get running time entry" API
/// The response wraps the data in a "data" field
#[derive(Debug, Deserialize)]
struct RunningTimeEntryResponse {
    data: Option<RunningTimeEntry>,
}

/// A currently running ClickUp time entry
#[derive(Debug, Clone, Deserialize)]
struct RunningTimeEntry {
    id: String,
    /// Task is optional - manual timers don't have a task
    task: Option<Task>,
    /// Duration in milliseconds - NEGATIVE means timer is running
    duration: i64,
    /// Description of the time entry (used for manual timers)
    #[serde(default)]
    description: String,
    /// Start time in milliseconds since epoch
    #[serde(default)]
    start: String,
    /// Tags on this time entry
    #[serde(default)]
    tags: Vec<TimeEntryTag>,
    /// Whether this time entry is billable
    #[serde(default)]
    billable: bool,
}

/// Snapshot of the last running timer observed by the app.
#[derive(Debug, Clone)]
struct TrackedSession {
    team_id: String,
    timer_id: String,
    start_time_ms: i64,
}

/// A ClickUp task reference
#[derive(Debug, Clone, Deserialize)]
struct Task {
    id: String,
    name: String,
}

impl RunningTimeEntry {
    /// Check if this timer is currently running (negative duration)
    fn is_running(&self) -> bool {
        self.duration < 0
    }

    /// Get a display name for this timer entry
    fn display_name(&self) -> String {
        // First try to get the task name
        if let Some(task) = &self.task {
            return task.name.clone();
        }

        // If no task, use the description if available
        if !self.description.is_empty() {
            return self.description.clone();
        }

        // Fallback for manual timers without description
        "Manual Timer".to_string()
    }

    /// Get the task ID if this timer is associated with a task
    fn task_id(&self) -> Option<String> {
        self.task.as_ref().map(|t| t.id.clone())
    }

    /// Get the start time in milliseconds since epoch
    fn start_time_ms(&self) -> Option<i64> {
        self.start.parse::<i64>().ok()
    }
}

fn tracked_session_store() -> &'static Mutex<Option<TrackedSession>> {
    static TRACKED_SESSION: OnceLock<Mutex<Option<TrackedSession>>> = OnceLock::new();
    TRACKED_SESSION.get_or_init(|| Mutex::new(None))
}

fn http_client() -> &'static reqwest::Client {
    static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}

fn known_time_entry_tag_cache() -> &'static Mutex<HashSet<String>> {
    static KNOWN_TIME_ENTRY_TAGS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    KNOWN_TIME_ENTRY_TAGS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn tag_cache_key(team_id: &str, tag_name: &str) -> String {
    format!("{}:{}", team_id.trim(), tag_name.trim().to_ascii_lowercase())
}

/// Track the currently running timer and detect if a previous timer disappeared.
fn track_running_session(team_id: &str, timer_id: &str, start_time_ms: i64) -> Option<i64> {
    let Ok(mut guard) = tracked_session_store().lock() else {
        return None;
    };

    let now_ms = chrono::Utc::now().timestamp_millis();
    let previous = guard.take();
    let mut external_stop_duration: Option<i64> = None;

    if let Some(prev) = previous {
        let is_same_timer = prev.team_id == team_id && prev.timer_id == timer_id;
        if is_same_timer {
            *guard = Some(prev);
            return None;
        }

        if prev.team_id == team_id {
            external_stop_duration = Some(calculate_elapsed_secs(prev.start_time_ms, now_ms));
        }
    }

    *guard = Some(TrackedSession {
        team_id: team_id.to_string(),
        timer_id: timer_id.to_string(),
        start_time_ms,
    });

    external_stop_duration.filter(|duration| *duration > 0)
}

/// Detect when a tracked timer disappears and return the inferred session duration.
fn capture_external_stop_for_team(team_id: &str) -> Option<i64> {
    let Ok(mut guard) = tracked_session_store().lock() else {
        return None;
    };

    let Some(prev) = guard.as_ref() else {
        return None;
    };

    if prev.team_id != team_id {
        return None;
    }

    let prev = guard.take()?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let duration = calculate_elapsed_secs(prev.start_time_ms, now_ms);
    (duration > 0).then_some(duration)
}

/// Clear tracked session state for team after app-initiated stop.
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

/// Calculate elapsed seconds between start and now (both in ms).
fn calculate_elapsed_secs(start_ms: i64, now_ms: i64) -> i64 {
    ((now_ms - start_ms) / 1000).max(0)
}

/// Calculate current session duration in seconds for a running entry.
fn session_duration_secs(entry: &RunningTimeEntry) -> i64 {
    entry
        .start_time_ms()
        .map(|start_ms| calculate_elapsed_secs(start_ms, chrono::Utc::now().timestamp_millis()))
        .unwrap_or(0)
}

fn running_entry_to_info(entry: RunningTimeEntry) -> Option<RunningTimerInfo> {
    if !entry.is_running() {
        return None;
    }

    let id = entry.id.clone();
    let is_manual = entry.task.is_none();
    let description = if entry.description.is_empty() {
        None
    } else {
        Some(entry.description.clone())
    };

    Some(RunningTimerInfo {
        id,
        name: entry.display_name(),
        task_id: entry.task_id(),
        start_time_ms: entry.start_time_ms().unwrap_or(0),
        description,
        is_manual,
        tags: entry.tags,
        billable: entry.billable,
    })
}

fn sync_tracked_session(team_id: &str, timer: Option<&RunningTimerInfo>) {
    if let Some(timer) = timer {
        if timer.start_time_ms > 0 {
            if let Some(duration_secs) =
                track_running_session(team_id, &timer.id, timer.start_time_ms)
            {
                stats::record_timer_session(duration_secs);
            }
        }
    } else if let Some(duration_secs) = capture_external_stop_for_team(team_id) {
        stats::record_timer_session(duration_secs);
    }
}

impl TimeEntryApiResult {
    fn into_leaderboard_input(self) -> Option<LeaderboardEntryInput> {
        let identity = self.user.or(self.assignee);
        let user_id = identity
            .as_ref()
            .and_then(|user| id_from_value(&user.id))
            .or_else(|| self.uid.as_ref().and_then(id_from_value))?;

        let username = identity
            .as_ref()
            .and_then(|user| user.username.clone())
            .filter(|name| !name.trim().is_empty());
        let profile_picture = identity.and_then(|user| user.profile_picture);
        let duration_ms = parse_i64_from_value(&self.duration)?;
        let start_ms = self.start.as_ref().and_then(parse_i64_from_value);

        Some(LeaderboardEntryInput {
            user_id,
            username,
            profile_picture,
            duration_ms,
            start_ms,
        })
    }
}

fn parse_i64_from_value(value: &serde_json::Value) -> Option<i64> {
    match value {
        serde_json::Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_u64().and_then(|raw| i64::try_from(raw).ok())),
        serde_json::Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn id_from_value(value: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::String(text) = value {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    parse_i64_from_value(value).map(|id| id.to_string())
}

fn team_id_matches(team_value: &serde_json::Value, selected_team_id: &str) -> bool {
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

fn millis_to_seconds(duration_ms: i64) -> i64 {
    (duration_ms / 1000).max(0)
}

fn running_seconds_from_entry(duration_ms: i64, start_ms: Option<i64>, now_ms: i64) -> i64 {
    if let Some(start_ms) = start_ms.filter(|start| *start > 0) {
        return ((now_ms - start_ms) / 1000).max(0);
    }

    millis_to_seconds(duration_ms.saturating_abs())
}

fn should_retry_without_assignee(status: Option<StatusCode>, body: &str) -> bool {
    if matches!(
        status,
        Some(StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
    ) {
        return true;
    }

    if status != Some(StatusCode::BAD_REQUEST) {
        return false;
    }

    let body = body.to_lowercase();
    body.contains("assignee")
        || body.contains("permission")
        || body.contains("forbidden")
        || body.contains("not authorized")
        || body.contains("not allowed")
}

fn aggregate_team_leaderboard_users(
    entries: Vec<LeaderboardEntryInput>,
    member_lookup: &HashMap<String, TeamMemberIdentity>,
    now_ms: i64,
) -> Vec<TeamLeaderboardUser> {
    let mut by_user: HashMap<String, LeaderboardUserAccum> = HashMap::new();

    for entry in entries {
        let fallback_username = entry
            .username
            .as_ref()
            .map(|name| name.trim())
            .filter(|name| !name.is_empty())
            .map(|name| name.to_string())
            .unwrap_or_else(|| format!("User {}", entry.user_id));

        let username = member_lookup
            .get(&entry.user_id)
            .map(|member| member.username.clone())
            .unwrap_or(fallback_username);
        let profile_picture = member_lookup
            .get(&entry.user_id)
            .and_then(|member| member.profile_picture.clone())
            .or(entry.profile_picture.clone());

        let user = by_user
            .entry(entry.user_id.clone())
            .or_insert_with(|| LeaderboardUserAccum {
                username: username.clone(),
                profile_picture: profile_picture.clone(),
                ..LeaderboardUserAccum::default()
            });

        if user.username.starts_with("User ") && !username.starts_with("User ") {
            user.username = username;
        }
        if user.profile_picture.is_none() {
            user.profile_picture = profile_picture;
        }

        if entry.duration_ms > 0 {
            let past_seconds = millis_to_seconds(entry.duration_ms);
            if past_seconds > 0 {
                user.past_seconds += past_seconds;
            }
            continue;
        }

        if entry.duration_ms < 0 {
            let active_seconds =
                running_seconds_from_entry(entry.duration_ms, entry.start_ms, now_ms);
            if active_seconds > 0 {
                user.active_seconds += active_seconds;
                user.running_entry_count += 1;
            }
        }
    }

    let mut users: Vec<TeamLeaderboardUser> = by_user
        .into_iter()
        .filter_map(|(user_id, user)| {
            let total_seconds = user.active_seconds + user.past_seconds;
            if total_seconds <= 0 {
                return None;
            }

            Some(TeamLeaderboardUser {
                user_id,
                username: user.username,
                profile_picture: user.profile_picture,
                active_seconds: user.active_seconds,
                past_seconds: user.past_seconds,
                total_seconds,
                running_entry_count: user.running_entry_count,
            })
        })
        .collect();

    users.sort_by(|left, right| {
        right
            .total_seconds
            .cmp(&left.total_seconds)
            .then_with(|| right.active_seconds.cmp(&left.active_seconds))
            .then_with(|| {
                left.username
                    .to_ascii_lowercase()
                    .cmp(&right.username.to_ascii_lowercase())
            })
    });

    users
}

async fn fetch_team_members(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
) -> Result<Vec<TeamMemberRecord>, ClickUpApiError> {
    const CONTEXT: &str = "Failed to fetch ClickUp workspaces";
    let response = client
        .get("https://api.clickup.com/api/v2/team")
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|error| ClickUpApiError::network(CONTEXT, error))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ClickUpApiError::http(CONTEXT, status, body));
    }

    let payload: AuthorizedTeamsResponse = response
        .json()
        .await
        .map_err(|error| ClickUpApiError::parse(CONTEXT, error))?;

    let selected_team = payload
        .teams
        .into_iter()
        .find(|team| team_id_matches(&team.id, team_id))
        .ok_or_else(|| ClickUpApiError {
            context: "ClickUp workspace is not accessible with this API key",
            status: None,
            body: team_id.to_string(),
        })?;

    let mut members: HashMap<String, TeamMemberRecord> = HashMap::new();
    for member in selected_team.members {
        let Some(user_id) = id_from_value(&member.user.id) else {
            continue;
        };

        let username = member
            .user
            .username
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("User {}", user_id));

        members.entry(user_id.clone()).or_insert(TeamMemberRecord {
            user_id,
            username,
            profile_picture: member.user.profile_picture,
        });
    }

    Ok(members.into_values().collect())
}

async fn fetch_team_time_entries(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
    start_date_ms: i64,
    end_date_ms: i64,
    assignees: Option<&[String]>,
) -> Result<Vec<TimeEntryApiResult>, ClickUpApiError> {
    const CONTEXT: &str = "Failed to fetch ClickUp team time entries";
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries",
        team_id
    );

    let mut query: Vec<(String, String)> = vec![
        ("start_date".to_string(), start_date_ms.to_string()),
        ("end_date".to_string(), end_date_ms.to_string()),
    ];
    if let Some(assignees) = assignees {
        if !assignees.is_empty() {
            // ClickUp expects multiple assignees as a single comma-separated value.
            query.push(("assignee".to_string(), assignees.join(",")));
        }
    }

    let response = client
        .get(&url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .query(&query)
        .send()
        .await
        .map_err(|error| ClickUpApiError::network(CONTEXT, error))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ClickUpApiError::http(CONTEXT, status, body));
    }

    let payload: TimeEntriesResponse = response
        .json()
        .await
        .map_err(|error| ClickUpApiError::parse(CONTEXT, error))?;
    Ok(payload.data)
}

/// Fetch the current running time entry for a team.
async fn fetch_running_time_entry(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
) -> Result<Option<RunningTimeEntry>, String> {
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

    let running_response: RunningTimeEntryResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse running timer response: {}", e))?;

    Ok(running_response.data)
}

/// A tag on a ClickUp task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskTag {
    pub name: String,
    #[serde(default)]
    pub tag_fg: Option<String>,
    #[serde(default)]
    pub tag_bg: Option<String>,
}

/// A tag that can be applied to time entries (workspace-level)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeEntryTag {
    pub name: String,
    #[serde(default)]
    pub tag_bg: Option<String>,
    #[serde(default)]
    pub tag_fg: Option<String>,
}

/// A ClickUp task search result with detailed information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSearchResult {
    pub id: String,
    pub name: String,
    pub custom_id: Option<String>,
    /// Task status name (e.g., "in progress", "complete")
    pub status_name: Option<String>,
    /// Task status color (hex, e.g., "#d3d3d3")
    pub status_color: Option<String>,
    /// Name of the list containing this task
    pub list_name: Option<String>,
    /// Name of the folder (if any)
    pub folder_name: Option<String>,
    /// Name of the space
    pub space_name: Option<String>,
    /// Tags on the task
    pub tags: Vec<TaskTag>,
}

/// Internal struct for deserializing ClickUp API response
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

    // Build query parameters - include_closed ensures we search all statuses
    // subtasks=true includes subtasks in results
    let query_lower = query.to_lowercase();
    let query_words: Vec<&str> = query_lower.split_whitespace().collect();

    // Use the first word with 2+ characters for API search to get broader results
    // Short words like "a" can cause issues with ClickUp's search
    let api_search_term = query_words
        .iter()
        .find(|w| w.len() >= 2)
        .map(|s| *s)
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

    // Filter client-side: check if ALL query words appear in task name (case-insensitive)
    // This handles cases where API returns partial matches
    let tasks: Vec<TaskSearchResult> = search_response
        .tasks
        .into_iter()
        .map(|t| t.into())
        .filter(|task: &TaskSearchResult| {
            let name_lower = task.name.to_lowercase();
            query_words.iter().all(|word| name_lower.contains(word))
        })
        .collect();

    Ok(tasks)
}

/// Get a 30-day workspace leaderboard split by active (running) and past (completed) time.
pub async fn get_clickup_team_leaderboard(
    api_key: String,
    team_id: String,
) -> Result<TeamLeaderboardResponse, String> {
    const WINDOW_DAYS: i64 = 30;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let start_date_ms = now_ms - chrono::Duration::days(WINDOW_DAYS).num_milliseconds();

    let client = http_client();
    let members = fetch_team_members(&client, &api_key, &team_id)
        .await
        .map_err(ClickUpApiError::into_message)?;

    let mut member_lookup: HashMap<String, TeamMemberIdentity> = HashMap::new();
    let mut assignee_ids: Vec<String> = Vec::new();
    for member in members {
        assignee_ids.push(member.user_id.clone());
        member_lookup.insert(
            member.user_id,
            TeamMemberIdentity {
                username: member.username,
                profile_picture: member.profile_picture,
            },
        );
    }
    assignee_ids.sort_unstable();
    assignee_ids.dedup();

    let scoped_entries_result = if assignee_ids.is_empty() {
        fetch_team_time_entries(&client, &api_key, &team_id, start_date_ms, now_ms, None).await
    } else {
        fetch_team_time_entries(
            &client,
            &api_key,
            &team_id,
            start_date_ms,
            now_ms,
            Some(&assignee_ids),
        )
        .await
    };

    let mut is_partial = false;
    let mut warning = None;
    let mut debug_details = None;
    let raw_entries = match scoped_entries_result {
        Ok(entries) => entries,
        Err(error)
            if !assignee_ids.is_empty()
                && should_retry_without_assignee(error.status, &error.body) =>
        {
            let status_text = error
                .status
                .map(|status| status.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let context = error.context;
            let body = error.body.clone();

            is_partial = true;
            warning = Some(
                "Showing partial leaderboard because this API key cannot read all teammates' time entries."
                    .to_string(),
            );
            debug_details = Some(format!(
                "Context: {}\nStatus: {}\nBody: {}",
                context, status_text, body
            ));
            fetch_team_time_entries(&client, &api_key, &team_id, start_date_ms, now_ms, None)
                .await
                .map_err(ClickUpApiError::into_message)?
        }
        Err(error) => return Err(error.into_message()),
    };

    let leaderboard_entries: Vec<LeaderboardEntryInput> = raw_entries
        .into_iter()
        .filter_map(TimeEntryApiResult::into_leaderboard_input)
        .collect();
    let users = aggregate_team_leaderboard_users(leaderboard_entries, &member_lookup, now_ms);

    Ok(TeamLeaderboardResponse {
        window_days: WINDOW_DAYS,
        generated_at_ms: now_ms,
        is_partial,
        warning,
        debug_details,
        users,
    })
}

/// Response from ClickUp "Get time entry tags" API
#[derive(Debug, Deserialize)]
struct TimeEntryTagsResponse {
    data: Vec<TimeEntryTag>,
}

/// Get all time entry tags for a workspace.
///
/// These are workspace-level tags that can be applied to time entries.
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

/// The name of the tag used to identify time entries tracked by Resplendent Timer
pub const RT_TAG_NAME: &str = "rt";
/// The name of the manual meeting tag used by meeting detection flow
pub const MEETING_TAG_NAME: &str = "meeting";

const RT_TAG_BG: &str = "#7b68ee";
const RT_TAG_FG: &str = "#ffffff";
const MEETING_TAG_BG: &str = "#2563eb";
const MEETING_TAG_FG: &str = "#ffffff";

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

/// Ensure the "rt" tag exists in the workspace for identifying Resplendent Timer entries.
///
/// If the tag doesn't exist, it will be created with a distinctive purple color.
///
/// # Arguments
///
/// * `api_key` - ClickUp API key
/// * `team_id` - ClickUp team/workspace ID
///
/// # Returns
///
/// Ok(true) if tag was created, Ok(false) if it already existed
pub async fn ensure_rt_tag_exists(api_key: String, team_id: String) -> Result<bool, String> {
    ensure_time_entry_tag_exists(api_key, team_id, RT_TAG_NAME, RT_TAG_BG, RT_TAG_FG).await
}

/// Ensure the "meeting" time-entry tag exists.
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

/// Add the "rt" tag to an existing time entry.
///
/// This is used to tag time entries that were started externally (e.g., from ClickUp web)
/// while the Resplendent Timer app is running.
///
/// # Arguments
///
/// * `api_key` - ClickUp API key
/// * `team_id` - ClickUp team/workspace ID
/// * `time_entry_id` - The ID of the time entry to tag
/// * `existing_tags` - Current tags on the time entry (to preserve them)
///
/// # Returns
///
/// Ok(true) if tag was added, Ok(false) if it was already present
pub async fn add_rt_tag_to_time_entry(
    api_key: String,
    team_id: String,
    time_entry_id: String,
    existing_tags: Vec<TimeEntryTag>,
) -> Result<bool, String> {
    // Check if rt tag is already present
    if existing_tags.iter().any(|t| t.name == RT_TAG_NAME) {
        return Ok(false); // Already has the tag
    }

    // Use the dedicated "Add tags to time entries" endpoint
    // POST /team/{team_id}/time_entries/tags
    let client = http_client();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/tags",
        team_id
    );

    // The endpoint expects time_entry_ids and tags arrays
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

/// Helper function to ensure "rt" tag is included in the tags list.
///
/// Used when starting timers to always include the rt tag.
/// Returns tag objects with name and color fields as required by ClickUp API.
fn build_tag_objects_with_rt(tags: Option<Vec<String>>) -> Vec<serde_json::Value> {
    let mut result = tags.unwrap_or_default();
    if !result.iter().any(|t| t == RT_TAG_NAME) {
        result.push(RT_TAG_NAME.to_string());
    }

    result
        .into_iter()
        .map(|name| {
            if name == RT_TAG_NAME {
                // Use distinctive purple color for rt tag
                serde_json::json!({
                    "name": RT_TAG_NAME,
                    "tag_bg": RT_TAG_BG,
                    "tag_fg": RT_TAG_FG
                })
            } else {
                // For other tags, just use name (ClickUp will use existing tag's colors)
                serde_json::json!({"name": name})
            }
        })
        .collect()
}

/// Start a time entry for a specific task.
///
/// # Arguments
///
/// * `api_key` - ClickUp API key
/// * `team_id` - ClickUp team/workspace ID
/// * `task_id` - The task ID to start the timer for
/// * `billable` - Whether the time entry is billable
/// * `tags` - Optional list of tag names to apply
pub async fn start_timer(
    api_key: String,
    team_id: String,
    task_id: String,
    billable: bool,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    let client = http_client();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/start",
        team_id
    );

    // Build the request body with task ID
    let mut body = serde_json::json!({
        "tid": task_id,
        "billable": billable
    });

    // Always include "rt" tag, plus any user-selected tags
    let tag_objects = build_tag_objects_with_rt(tags);
    body["tags"] = serde_json::Value::Array(tag_objects);

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

    Ok(())
}

/// Stop the currently running timer.
pub async fn stop_timer(api_key: String, team_id: String) -> Result<(), String> {
    let client = http_client();

    // Best-effort pre-fetch so manual stops also count toward session stats.
    let session_duration = fetch_running_time_entry(client, &api_key, &team_id)
        .await
        .ok()
        .flatten()
        .filter(|entry| entry.is_running())
        .map(|entry| session_duration_secs(&entry))
        .unwrap_or(0);

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

    if session_duration > 0 {
        stats::record_timer_session(session_duration);
    }

    clear_tracked_session_for_team(&team_id);

    Ok(())
}

/// Start a manual time entry (without a linked task).
///
/// # Arguments
///
/// * `api_key` - ClickUp API key
/// * `team_id` - ClickUp team/workspace ID
/// * `description` - Optional description for the time entry
/// * `billable` - Whether the time entry is billable
/// * `tags` - Optional list of tag names to apply
pub async fn start_manual_timer(
    api_key: String,
    team_id: String,
    description: Option<String>,
    billable: bool,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    let client = http_client();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/start",
        team_id
    );

    // Build the request body - no "tid" field means manual timer
    let mut body = serde_json::json!({
        "billable": billable
    });

    // Add description if provided
    if let Some(desc) = description {
        if !desc.is_empty() {
            body["description"] = serde_json::Value::String(desc);
        }
    }

    // Always include "rt" tag, plus any user-selected tags
    let tag_objects = build_tag_objects_with_rt(tags);
    body["tags"] = serde_json::Value::Array(tag_objects);

    let response = client
        .post(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to start manual timer: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    Ok(())
}

/// Check idle time and stop ClickUp timer if user has been idle too long.
///
/// # Arguments
///
/// * `api_key` - ClickUp API key (pk_...)
/// * `team_id` - ClickUp team/workspace ID
/// * `idle_threshold_secs` - Number of seconds of inactivity before stopping timer
///
/// # Returns
///
/// An `IdleCheckResult` indicating whether a timer was stopped and relevant details.
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
        description: snapshot
            .stopped_description
            .or_else(|| running_timer.as_ref().and_then(|timer| timer.description.clone())),
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

pub async fn poll_runtime_impl(
    api_key: String,
    team_id: String,
    idle_threshold_secs: u64,
) -> Result<RuntimeSnapshot, String> {
    let now = chrono::Utc::now().timestamp();
    let idle_secs = idle_monitor::get_idle_time_secs().await?;
    let client = http_client();
    let running_entry = fetch_running_time_entry(client, &api_key, &team_id).await?;
    let Some(entry) = running_entry.filter(|entry| entry.is_running()) else {
        sync_tracked_session(&team_id, None);
        return Ok(RuntimeSnapshot {
            idle_duration: idle_secs,
            running_timer: None,
            stopped: false,
            stopped_task_name: None,
            stopped_task_id: None,
            stopped_description: None,
            stopped_is_manual: false,
            stopped_tags: vec![],
            stopped_billable: false,
            error: None,
        });
    };

    let running_timer = running_entry_to_info(entry.clone());

    if idle_secs < idle_threshold_secs {
        sync_tracked_session(&team_id, running_timer.as_ref());
        return Ok(RuntimeSnapshot {
            idle_duration: idle_secs,
            running_timer,
            stopped: false,
            stopped_task_name: None,
            stopped_task_id: None,
            stopped_description: None,
            stopped_is_manual: false,
            stopped_tags: vec![],
            stopped_billable: false,
            error: None,
        });
    }

    let task_name = entry.display_name();
    let task_id = entry.task_id();
    let description = if entry.description.is_empty() {
        None
    } else {
        Some(entry.description.clone())
    };
    let is_manual = entry.task.is_none();
    let tags = entry.tags.clone();
    let billable = entry.billable;
    let session_duration_secs = session_duration_secs(&entry);

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
            now,
            idle_secs as i64,
            false,
            Some(task_name.clone()),
            task_id.clone(),
            0,
        );
        sync_tracked_session(&team_id, running_timer.as_ref());
        return Ok(RuntimeSnapshot {
            idle_duration: idle_secs,
            running_timer,
            stopped: false,
            stopped_task_name: None,
            stopped_task_id: None,
            stopped_description: None,
            stopped_is_manual: false,
            stopped_tags: vec![],
            stopped_billable: false,
            error: Some(format!("Failed to stop timer ({}): {}", status, body)),
        });
    }

    stats::record_idle_event(
        now,
        idle_secs as i64,
        true,
        Some(task_name.clone()),
        task_id.clone(),
        session_duration_secs,
    );
    stats::record_timer_session(session_duration_secs);
    clear_tracked_session_for_team(&team_id);

    Ok(RuntimeSnapshot {
        idle_duration: idle_secs,
        running_timer: None,
        stopped: true,
        stopped_task_name: Some(task_name),
        stopped_task_id: task_id,
        stopped_description: description,
        stopped_is_manual: is_manual,
        stopped_tags: tags,
        stopped_billable: billable,
        error: None,
    })
}

/// Get the currently running time entry, if any.
///
/// Uses the dedicated ClickUp endpoint for getting the current running timer.
///
/// # Arguments
///
/// * `api_key` - ClickUp API key
/// * `team_id` - ClickUp team/workspace ID
///
/// # Returns
///
/// The name of the currently running task, or None if no timer is running.
pub async fn get_running_timer(api_key: String, team_id: String) -> Result<Option<String>, String> {
    let client = http_client();
    let running_entry = fetch_running_time_entry(client, &api_key, &team_id).await?;

    // Check if there's a running timer (data exists and duration is negative)
    let running = running_entry.and_then(|entry| {
        if entry.is_running() {
            Some(entry.display_name())
        } else {
            None
        }
    });

    Ok(running)
}

/// Get detailed information about the currently running timer, including start time.
///
/// # Arguments
///
/// * `api_key` - ClickUp API key
/// * `team_id` - ClickUp team/workspace ID
///
/// # Returns
///
/// Information about the running timer including name and start time, or None if no timer is running.
pub async fn get_running_timer_info(
    api_key: String,
    team_id: String,
) -> Result<Option<RunningTimerInfo>, String> {
    let client = http_client();
    let running_entry = fetch_running_time_entry(client, &api_key, &team_id).await?;
    let info = running_entry.and_then(running_entry_to_info);
    sync_tracked_session(&team_id, info.as_ref());

    Ok(info)
}

/// Debug function to test the ClickUp API and return raw response
pub async fn debug_api_call(api_key: String, team_id: String) -> Result<String, String> {
    let client = http_client();

    // Test the "current" endpoint
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
    use std::collections::HashMap;

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
        assert!(json.contains("\"tags\":[]"));
        assert!(json.contains("\"idle_duration\":600"));
    }

    #[test]
    fn test_calculate_elapsed_secs_non_negative() {
        assert_eq!(calculate_elapsed_secs(1_000, 5_000), 4);
        assert_eq!(calculate_elapsed_secs(5_000, 1_000), 0);
    }

    #[test]
    fn test_aggregate_team_leaderboard_splits_active_and_past() {
        let now_ms = 1_700_000_000_000_i64;
        let mut member_lookup = HashMap::new();
        member_lookup.insert(
            "101".to_string(),
            TeamMemberIdentity {
                username: "Alice".to_string(),
                profile_picture: Some("https://cdn.example.com/alice.png".to_string()),
            },
        );

        let users = aggregate_team_leaderboard_users(
            vec![
                LeaderboardEntryInput {
                    user_id: "101".to_string(),
                    username: Some("Alice".to_string()),
                    profile_picture: None,
                    duration_ms: 3_600_000,
                    start_ms: Some(now_ms - 3_600_000),
                },
                LeaderboardEntryInput {
                    user_id: "101".to_string(),
                    username: Some("Alice".to_string()),
                    profile_picture: None,
                    duration_ms: -1,
                    start_ms: Some(now_ms - 1_800_000),
                },
            ],
            &member_lookup,
            now_ms,
        );

        assert_eq!(users.len(), 1);
        assert_eq!(users[0].user_id, "101");
        assert_eq!(users[0].username, "Alice");
        assert_eq!(
            users[0].profile_picture.as_deref(),
            Some("https://cdn.example.com/alice.png")
        );
        assert_eq!(users[0].past_seconds, 3600);
        assert_eq!(users[0].active_seconds, 1800);
        assert_eq!(users[0].total_seconds, 5400);
        assert_eq!(users[0].running_entry_count, 1);
    }

    #[test]
    fn test_aggregate_team_leaderboard_filters_zero_totals() {
        let users = aggregate_team_leaderboard_users(
            vec![
                LeaderboardEntryInput {
                    user_id: "301".to_string(),
                    username: Some("Zero".to_string()),
                    profile_picture: None,
                    duration_ms: 0,
                    start_ms: None,
                },
                LeaderboardEntryInput {
                    user_id: "302".to_string(),
                    username: Some("Hero".to_string()),
                    profile_picture: None,
                    duration_ms: 1_000,
                    start_ms: None,
                },
            ],
            &HashMap::new(),
            1_700_000_000_000_i64,
        );

        assert_eq!(users.len(), 1);
        assert_eq!(users[0].user_id, "302");
        assert_eq!(users[0].total_seconds, 1);
    }

    #[test]
    fn test_aggregate_team_leaderboard_sorting_rules() {
        let now_ms = 1_700_000_000_000_i64;
        let mut member_lookup = HashMap::new();
        member_lookup.insert(
            "1".to_string(),
            TeamMemberIdentity {
                username: "Delta".to_string(),
                profile_picture: None,
            },
        );
        member_lookup.insert(
            "2".to_string(),
            TeamMemberIdentity {
                username: "Charlie".to_string(),
                profile_picture: None,
            },
        );
        member_lookup.insert(
            "3".to_string(),
            TeamMemberIdentity {
                username: "Bravo".to_string(),
                profile_picture: None,
            },
        );

        let users = aggregate_team_leaderboard_users(
            vec![
                LeaderboardEntryInput {
                    user_id: "1".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: 5_400_000,
                    start_ms: None,
                },
                LeaderboardEntryInput {
                    user_id: "2".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: 2_400_000,
                    start_ms: None,
                },
                LeaderboardEntryInput {
                    user_id: "2".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: -1,
                    start_ms: Some(now_ms - 1_200_000),
                },
                LeaderboardEntryInput {
                    user_id: "3".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: 2_400_000,
                    start_ms: None,
                },
                LeaderboardEntryInput {
                    user_id: "3".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: -1,
                    start_ms: Some(now_ms - 1_200_000),
                },
            ],
            &member_lookup,
            now_ms,
        );

        let sorted_names: Vec<&str> = users.iter().map(|u| u.username.as_str()).collect();
        assert_eq!(sorted_names, vec!["Delta", "Bravo", "Charlie"]);
    }

    #[test]
    fn test_team_leaderboard_response_serialization_uses_snake_case() {
        let response = TeamLeaderboardResponse {
            window_days: 30,
            generated_at_ms: 1_700_000_000_000,
            is_partial: true,
            warning: Some("partial".to_string()),
            debug_details: Some("Context: test\nStatus: 403\nBody: forbidden".to_string()),
            users: vec![TeamLeaderboardUser {
                user_id: "99".to_string(),
                username: "Ada".to_string(),
                profile_picture: Some("https://cdn.example.com/ada.png".to_string()),
                active_seconds: 120,
                past_seconds: 240,
                total_seconds: 360,
                running_entry_count: 1,
            }],
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"window_days\":30"));
        assert!(json.contains("\"generated_at_ms\":1700000000000"));
        assert!(json.contains("\"is_partial\":true"));
        assert!(
            json.contains("\"debug_details\":\"Context: test\\nStatus: 403\\nBody: forbidden\"")
        );
        assert!(json.contains("\"profile_picture\":\"https://cdn.example.com/ada.png\""));
        assert!(json.contains("\"active_seconds\":120"));
        assert!(json.contains("\"past_seconds\":240"));
        assert!(json.contains("\"total_seconds\":360"));
        assert!(json.contains("\"running_entry_count\":1"));
    }
}
