//! Public ClickUp DTOs serialized across the Tauri IPC bridge.

use serde::{Deserialize, Serialize};

/// A tag on a ClickUp task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskTag {
    pub name: String,
    #[serde(default)]
    pub tag_fg: Option<String>,
    #[serde(default)]
    pub tag_bg: Option<String>,
}

/// A workspace-level tag applied to ClickUp time entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeEntryTag {
    pub name: String,
    #[serde(default)]
    pub tag_bg: Option<String>,
    #[serde(default)]
    pub tag_fg: Option<String>,
}

/// A ClickUp task search result with project hierarchy metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSearchResult {
    pub id: String,
    pub name: String,
    pub custom_id: Option<String>,
    pub status_name: Option<String>,
    pub status_color: Option<String>,
    pub list_name: Option<String>,
    pub folder_name: Option<String>,
    pub space_name: Option<String>,
    pub tags: Vec<TaskTag>,
}

/// Result of checking idle status and potentially stopping a timer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleCheckResult {
    pub stopped: bool,
    pub task_name: Option<String>,
    pub task_id: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub is_manual: bool,
    #[serde(default)]
    pub tags: Vec<TimeEntryTag>,
    #[serde(default)]
    pub billable: bool,
    pub idle_duration: u64,
    pub error: Option<String>,
}

/// Information about a currently running ClickUp timer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningTimerInfo {
    /// Time entry ID.
    pub id: String,
    /// Display name (task name, description, or "Untitled session").
    pub name: String,
    /// Linked task ID, if any.
    pub task_id: Option<String>,
    /// Effective start time in milliseconds since epoch (reflects backdating).
    pub start_time_ms: i64,
    /// ClickUp's raw server start time in milliseconds since epoch.
    #[serde(default)]
    pub raw_start_time_ms: i64,
    /// Whether this running timer was backdated to cover prior untracked active time.
    #[serde(default)]
    pub is_backdated: bool,
    /// Description on the time entry, if any.
    pub description: Option<String>,
    /// Whether this is a manual timer (no task linked).
    pub is_manual: bool,
    /// Tags currently attached to the time entry.
    pub tags: Vec<TimeEntryTag>,
    /// Whether this entry is marked billable.
    pub billable: bool,
}

/// Full details of a just-stopped ClickUp time entry, used to populate Session Wrap-Up.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoppedTimeEntry {
    pub id: String,
    pub name: String,
    pub task_id: Option<String>,
    pub task_name: Option<String>,
    pub description: Option<String>,
    pub start_time_ms: i64,
    pub end_time_ms: i64,
    pub duration_secs: i64,
    pub is_manual: bool,
    pub tags: Vec<TimeEntryTag>,
    pub billable: bool,
    #[serde(default)]
    pub is_backdated: bool,
}

/// Summary of a ClickUp time entry for Today's Sessions timeline & post-update refresh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeEntrySummary {
    pub id: String,
    pub name: String,
    pub task_id: Option<String>,
    pub task_name: Option<String>,
    pub description: Option<String>,
    pub start_time_ms: i64,
    pub end_time_ms: i64,
    pub duration_secs: i64,
    pub is_manual: bool,
    pub tags: Vec<TimeEntryTag>,
    pub billable: bool,
    pub is_running: bool,
}

/// Payload for updating a ClickUp time entry via PUT.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateTimeEntryPayload {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub clear_task: Option<bool>,
    #[serde(default)]
    pub billable: Option<bool>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub start_time_ms: Option<i64>,
    #[serde(default)]
    pub end_time_ms: Option<i64>,
}

/// Combined runtime snapshot used by the frontend scheduler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSnapshot {
    pub idle_duration: u64,
    pub running_timer: Option<RunningTimerInfo>,
    /// Epoch ms when continuous untracked work began (if active without a timer).
    #[serde(default)]
    pub active_untracked_since_ms: Option<i64>,
    /// Continuous seconds of active work without a running timer.
    #[serde(default)]
    pub active_untracked_secs: u64,
    pub stopped: bool,
    #[serde(default)]
    pub stopped_entry_id: Option<String>,
    pub stopped_task_name: Option<String>,
    pub stopped_task_id: Option<String>,
    pub stopped_description: Option<String>,
    #[serde(default)]
    pub stopped_is_manual: bool,
    #[serde(default)]
    pub stopped_tags: Vec<TimeEntryTag>,
    #[serde(default)]
    pub stopped_billable: bool,
    #[serde(default)]
    pub stopped_start_time_ms: Option<i64>,
    #[serde(default)]
    pub stopped_end_time_ms: Option<i64>,
    #[serde(default)]
    pub stopped_duration_secs: i64,
    #[serde(default)]
    pub stopped_is_backdated: bool,
    pub error: Option<String>,
}

/// Result of validating ClickUp API credentials in Settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConnectionInfo {
    pub connected: bool,
    pub workspace_name: String,
    pub member_count: usize,
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

/// Team leaderboard payload for the Insights UI.
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
