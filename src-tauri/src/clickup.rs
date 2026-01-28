//! ClickUp API integration for time tracking.
//!
//! This module provides functions to interact with the ClickUp API
//! to check and manage time entries.

use crate::{idle_monitor, stats};
use serde::{Deserialize, Serialize};

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
    #[allow(dead_code)]
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
            folder_name: api.folder.and_then(|f| if f.hidden { None } else { Some(f.name) }),
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
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/task",
        team_id
    );

    let response = client
        .get(&url)
        .header("Authorization", &api_key)
        .header("Content-Type", "application/json")
        .query(&[("search", query), ("page", "0".to_string())])
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

    // Convert API results to our richer TaskSearchResult type
    let tasks: Vec<TaskSearchResult> = search_response.tasks.into_iter().map(|t| t.into()).collect();
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

    // Add tags if provided (format: [{"name": "tag1"}, {"name": "tag2"}])
    if let Some(tag_names) = tags {
        if !tag_names.is_empty() {
            let tag_objects: Vec<serde_json::Value> = tag_names
                .into_iter()
                .map(|name| serde_json::json!({"name": name}))
                .collect();
            body["tags"] = serde_json::Value::Array(tag_objects);
        }
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
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    Ok(())
}

/// Stop the currently running timer.
pub async fn stop_timer(api_key: String, team_id: String) -> Result<(), String> {
    let client = reqwest::Client::new();
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

    // Add tags if provided (format: [{"name": "tag1"}, {"name": "tag2"}])
    if let Some(tag_names) = tags {
        if !tag_names.is_empty() {
            let tag_objects: Vec<serde_json::Value> = tag_names
                .into_iter()
                .map(|name| serde_json::json!({"name": name}))
                .collect();
            body["tags"] = serde_json::Value::Array(tag_objects);
        }
    }

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

    // User is idle, check for running timer using the dedicated endpoint
    let client = reqwest::Client::new();

    // Use the dedicated "current" endpoint to get the running timer
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
        .map_err(|e| format!("Failed to fetch running timer: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    let running_response: RunningTimeEntryResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse ClickUp response: {}", e))?;

    // Check if there's a running timer (data exists and duration is negative)
    if let Some(entry) = running_response.data {
        if entry.is_running() {
            let task_name = entry.display_name();
            let task_id = entry.task_id();
            
            // Calculate session duration from start time
            let session_duration_secs = entry.start_time_ms()
                .map(|start_ms| {
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    ((now_ms - start_ms) / 1000).max(0)
                })
                .unwrap_or(0);

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
                stats::record_idle_event(now, idle_secs as i64, false, Some(task_name.clone()), task_id.clone(), 0);
                return Ok(IdleCheckResult {
                    stopped: false,
                    task_name: Some(task_name),
                    task_id,
                    idle_duration: idle_secs,
                    error: Some(format!("Failed to stop timer ({}): {}", status, body)),
                });
            }

            // Record the successful timer stop with session duration
            stats::record_idle_event(now, idle_secs as i64, true, Some(task_name.clone()), task_id.clone(), session_duration_secs);
            stats::record_timer_session(session_duration_secs);
            
            return Ok(IdleCheckResult {
                stopped: true,
                task_name: Some(task_name),
                task_id,
                idle_duration: idle_secs,
                error: None,
            });
        }
    }

    // No running timer found - record that we went idle but no timer was active
    stats::record_idle_event(now, idle_secs as i64, false, None, None, 0);
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

    // Use the dedicated "current" endpoint
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
        .map_err(|e| format!("Failed to fetch running timer: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    let running_response: RunningTimeEntryResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Check if there's a running timer (data exists and duration is negative)
    let running = running_response.data.and_then(|entry| {
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
        .map_err(|e| format!("Failed to fetch running timer: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("ClickUp API error ({}): {}", status, body));
    }

    let running_response: RunningTimeEntryResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let info = running_response.data.and_then(|entry| {
        if entry.is_running() {
            let is_manual = entry.task.is_none();
            let description = if entry.description.is_empty() {
                None
            } else {
                Some(entry.description.clone())
            };
            Some(RunningTimerInfo {
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
}
