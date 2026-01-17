//! ClickUp API integration for time tracking.
//!
//! This module provides functions to interact with the ClickUp API
//! to check and manage time entries.

use crate::idle_monitor;
use serde::{Deserialize, Serialize};

/// Result of checking idle status and potentially stopping a timer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleCheckResult {
    /// Whether a timer was stopped due to inactivity
    pub stopped: bool,
    /// Name of the task that was stopped (if any)
    pub task_name: Option<String>,
    /// Current idle duration in seconds
    pub idle_duration: u64,
    /// Error message if something went wrong (but didn't prevent execution)
    pub error: Option<String>,
}

/// Information about a currently running timer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningTimerInfo {
    /// Name of the task
    pub name: String,
    /// Start time in milliseconds since epoch (for calculating elapsed time)
    pub start_time_ms: i64,
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
}

/// A ClickUp task reference
#[derive(Debug, Deserialize)]
struct Task {
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

    /// Get the start time in milliseconds since epoch
    fn start_time_ms(&self) -> Option<i64> {
        self.start.parse::<i64>().ok()
    }
}


/// A ClickUp task search result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSearchResult {
    pub id: String,
    pub name: String,
    pub custom_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskSearchResponse {
    tasks: Vec<TaskSearchResult>,
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

    let search_response: TaskSearchResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(search_response.tasks)
}

/// Start a time entry for a specific task.
pub async fn start_timer(
    api_key: String,
    team_id: String,
    task_id: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries/start",
        team_id
    );

    let body = serde_json::json!({
        "tid": task_id
    });

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
    let idle_secs = idle_monitor::get_idle_time_secs().await?;

    // If not idle enough, return early
    if idle_secs < idle_threshold_secs {
        return Ok(IdleCheckResult {
            stopped: false,
            task_name: None,
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
                return Ok(IdleCheckResult {
                    stopped: false,
                    task_name: Some(task_name),
                    idle_duration: idle_secs,
                    error: Some(format!("Failed to stop timer ({}): {}", status, body)),
                });
            }

            return Ok(IdleCheckResult {
                stopped: true,
                task_name: Some(task_name),
                idle_duration: idle_secs,
                error: None,
            });
        }
    }

    // No running timer found
    Ok(IdleCheckResult {
        stopped: false,
        task_name: None,
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
            Some(RunningTimerInfo {
                name: entry.display_name(),
                start_time_ms: entry.start_time_ms().unwrap_or(0),
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
            idle_duration: 600,
            error: None,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"stopped\":true"));
        assert!(json.contains("\"task_name\":\"Test Task\""));
        assert!(json.contains("\"idle_duration\":600"));
    }
}
