//! ClickUp API integration for time tracking.
//!
//! This module provides functions to interact with the ClickUp API
//! to check and manage time entries.

use crate::{idle_monitor, stats};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

/// Result of checking idle status and potentially stopping a timer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleCheckResult {
    /// Whether a timer was stopped due to inactivity
    pub stopped: bool,
    /// Name of the task that was stopped (if any)
    pub task_name: Option<String>,
    /// ID of the task that was stopped (for resume functionality)
    pub task_id: Option<String>,
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

/// Response from ClickUp "Get running time entry" API
/// The response wraps the data in a "data" field
#[derive(Debug, Deserialize)]
struct RunningTimeEntryResponse {
    data: Option<RunningTimeEntry>,
}

/// A currently running ClickUp time entry
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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
    let client = reqwest::Client::new();
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
    let client = reqwest::Client::new();
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
    // First check if the tag already exists
    let existing_tags = get_time_entry_tags(api_key.clone(), team_id.clone()).await?;

    if existing_tags.iter().any(|t| t.name == RT_TAG_NAME) {
        return Ok(false); // Tag already exists
    }

    // Create the tag with a distinctive purple color
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/tags",
        team_id
    );

    let body = serde_json::json!({
        "tag": {
            "name": RT_TAG_NAME,
            "tag_bg": "#7b68ee",  // Medium slate blue - distinctive but not jarring
            "tag_fg": "#ffffff"
        }
    });

    let response = client
        .post(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to create rt tag: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "ClickUp API error creating rt tag ({}): {}",
            status, body
        ));
    }

    Ok(true)
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
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/tags",
        team_id
    );

    // The endpoint expects time_entry_ids and tags arrays
    let body = serde_json::json!({
        "time_entry_ids": [time_entry_id],
        "tags": [{
            "name": RT_TAG_NAME,
            "tag_bg": "#7b68ee",
            "tag_fg": "#ffffff"
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
                    "tag_bg": "#7b68ee",
                    "tag_fg": "#ffffff"
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
    let client = reqwest::Client::new();
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
    let client = reqwest::Client::new();

    // Best-effort pre-fetch so manual stops also count toward session stats.
    let session_duration = fetch_running_time_entry(&client, &api_key, &team_id)
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
    let client = reqwest::Client::new();
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
    // Get current idle time
    let now = chrono::Utc::now().timestamp();
    let idle_secs = idle_monitor::get_idle_time_secs().await?;

    // If not idle enough, return early
    if idle_secs < idle_threshold_secs {
        return Ok(IdleCheckResult {
            stopped: false,
            task_name: None,
            task_id: None,
            idle_duration: idle_secs,
            error: None,
        });
    }

    // User is idle, check for running timer using the dedicated endpoint.
    let client = reqwest::Client::new();
    let running_entry = fetch_running_time_entry(&client, &api_key, &team_id).await?;
    // Check if there's a running timer.
    if let Some(entry) = running_entry {
        if entry.is_running() {
            let task_name = entry.display_name();
            let task_id = entry.task_id();
            let session_duration_secs = session_duration_secs(&entry);

            // Stop the running timer
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
                return Ok(IdleCheckResult {
                    stopped: false,
                    task_name: Some(task_name),
                    task_id,
                    idle_duration: idle_secs,
                    error: Some(format!("Failed to stop timer ({}): {}", status, body)),
                });
            }

            // Record the successful timer stop with session duration
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

            return Ok(IdleCheckResult {
                stopped: true,
                task_name: Some(task_name),
                task_id,
                idle_duration: idle_secs,
                error: None,
            });
        }
    }

    // No running timer found, nothing to stop.
    Ok(IdleCheckResult {
        stopped: false,
        task_name: None,
        task_id: None,
        idle_duration: idle_secs,
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
    let client = reqwest::Client::new();
    let running_entry = fetch_running_time_entry(&client, &api_key, &team_id).await?;

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
    let client = reqwest::Client::new();
    let running_entry = fetch_running_time_entry(&client, &api_key, &team_id).await?;

    let info = running_entry.and_then(|entry| {
        if entry.is_running() {
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
        } else {
            None
        }
    });

    if let Some(timer) = &info {
        if timer.start_time_ms > 0 {
            if let Some(duration_secs) =
                track_running_session(&team_id, &timer.id, timer.start_time_ms)
            {
                stats::record_timer_session(duration_secs);
            }
        }
    } else if let Some(duration_secs) = capture_external_stop_for_team(&team_id) {
        stats::record_timer_session(duration_secs);
    }

    Ok(info)
}

/// Debug function to test the ClickUp API and return raw response
pub async fn debug_api_call(api_key: String, team_id: String) -> Result<String, String> {
    let client = reqwest::Client::new();

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

    #[test]
    fn test_idle_check_result_serialization() {
        let result = IdleCheckResult {
            stopped: true,
            task_name: Some("Test Task".to_string()),
            task_id: Some("abc123".to_string()),
            idle_duration: 600,
            error: None,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"stopped\":true"));
        assert!(json.contains("\"task_name\":\"Test Task\""));
        assert!(json.contains("\"task_id\":\"abc123\""));
        assert!(json.contains("\"idle_duration\":600"));
    }

    #[test]
    fn test_calculate_elapsed_secs_non_negative() {
        assert_eq!(calculate_elapsed_secs(1_000, 5_000), 4);
        assert_eq!(calculate_elapsed_secs(5_000, 1_000), 0);
    }
}
