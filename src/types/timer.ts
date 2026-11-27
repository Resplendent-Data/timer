/**
 * Shared TypeScript types matching Rust backend DTOs (snake_case preserved).
 */

export interface TimeEntryTag {
  name: string;
  tag_bg: string | null;
  tag_fg: string | null;
}

export interface TaskTag {
  name: string;
  tag_fg: string | null;
  tag_bg: string | null;
}

export interface TaskSearchResult {
  id: string;
  name: string;
  custom_id: string | null;
  status_name: string | null;
  status_color: string | null;
  list_name: string | null;
  folder_name: string | null;
  space_name: string | null;
  tags: TaskTag[];
}

export interface RunningTimerInfo {
  id: string;
  name: string;
  task_id: string | null;
  start_time_ms: number;
  raw_start_time_ms: number;
  is_backdated: boolean;
  description: string | null;
  is_manual: boolean;
  tags: TimeEntryTag[];
  billable: boolean;
}

export interface StoppedTimeEntry {
  id: string;
  name: string;
  task_id: string | null;
  task_name: string | null;
  description: string | null;
  start_time_ms: number;
  end_time_ms: number;
  duration_secs: number;
  is_manual: boolean;
  tags: TimeEntryTag[];
  billable: boolean;
  is_backdated: boolean;
}

export interface TimeEntrySummary {
  id: string;
  name: string;
  task_id: string | null;
  task_name: string | null;
  description: string | null;
  start_time_ms: number;
  end_time_ms: number;
  duration_secs: number;
  is_manual: boolean;
  tags: TimeEntryTag[];
  billable: boolean;
  is_running: boolean;
}

export interface UpdateTimeEntryPayload {
  description?: string;
  task_id?: string | null;
  clear_task?: boolean;
  billable?: boolean;
  tags?: string[];
  start_time_ms?: number;
  end_time_ms?: number;
}

export interface RuntimeSnapshot {
  idle_duration: number;
  running_timer: RunningTimerInfo | null;
  active_untracked_since_ms: number | null;
  active_untracked_secs: number;
  stopped: boolean;
  stopped_entry_id: string | null;
  stopped_task_name: string | null;
  stopped_task_id: string | null;
  stopped_description: string | null;
  stopped_is_manual: boolean;
  stopped_tags: TimeEntryTag[];
  stopped_billable: boolean;
  stopped_start_time_ms: number | null;
  stopped_end_time_ms: number | null;
  stopped_duration_secs: number;
  stopped_is_backdated: boolean;
  error: string | null;
}

export interface ActiveUntrackedSnapshot {
  active_since_ms: number | null;
  active_duration_secs: number;
  current_idle_secs: number;
  last_timer_end_ms: number | null;
}

export interface WorkspaceConnectionInfo {
  connected: boolean;
  workspace_name: string;
  member_count: number;
}

export interface MeetingResumePayload {
  kind: "task" | "manual";
  task_id: string | null;
  task_name: string | null;
  description: string | null;
  tags: string[];
  billable: boolean;
}

export interface DailyActivity {
  date: string;
  active_seconds: number;
  idle_seconds: number;
  session_count: number;
  session_seconds: number;
}

export interface IdleEvent {
  id: number;
  started_at: number;
  duration_secs: number;
  timer_stopped: boolean;
  task_name: string | null;
  task_id: string | null;
  session_duration_secs: number;
}

export interface ProductivityStats {
  active_seconds_today: number;
  idle_seconds_today: number;
  current_streak: number;
  best_streak: number;
  current_xp: number;
  current_level: number;
  xp_for_next_level: number;
  xp_progress_percent: number;
  sessions_today: number;
  sessions_week: number;
  session_seconds_today: number;
  session_seconds_week: number;
  avg_session_minutes: number;
  active_seconds_week: number;
  active_seconds_last_week: number;
  week_delta_seconds: number;
  last_7_days: DailyActivity[];
  recent_events: IdleEvent[];
}

export interface WorkProgressStats {
  session_seconds_today: number;
  session_seconds_week: number;
}

export interface TeamLeaderboardUser {
  user_id: string;
  username: string;
  profile_picture: string | null;
  active_seconds: number;
  past_seconds: number;
  total_seconds: number;
  running_entry_count: number;
}

export interface TeamLeaderboardResponse {
  window_days: number;
  generated_at_ms: number;
  is_partial: boolean;
  warning: string | null;
  debug_details: string | null;
  users: TeamLeaderboardUser[];
}

export interface PrItem {
  title: string;
  html_url: string;
  number: number;
  repo: string;
}

export interface PrCounts {
  review_requests: number;
  my_open_prs: number;
  needs_reviewers: number;
  review_requests_items: PrItem[];
  my_open_prs_items: PrItem[];
  needs_reviewers_items: PrItem[];
}

export interface WidgetTimerPayload {
  taskName: string | null;
  startTimeMs: number | null;
  isBackdated: boolean;
  untrackedSinceMs: number | null;
  untrackedEligible: boolean;
}

/** Entry opened inside the Session Wrap-Up / Quick Edit drawer. */
export interface WrapUpEntry {
  id: string;
  name: string;
  task_id: string | null;
  task_name: string | null;
  description: string;
  /** Optional note from a resumed previous session, offered as a 1-click suggestion in Wrap-Up. */
  suggested_description?: string | null;
  start_time_ms: number;
  end_time_ms: number;
  duration_secs: number;
  is_manual: boolean;
  tags: TimeEntryTag[];
  billable: boolean;
  is_backdated: boolean;
  source: "manual-stop" | "auto-stop" | "edit";
}
