//! Native active-untracked session tracker.
//!
//! Lightweight local OS idle sampler (zero network calls) that accurately tracks
//! when the user began continuous active work without a ClickUp timer running.
//! Powers automatic backdating on 1-click timer start and actionable "No Timer"
//! notifications.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::idle_monitor;

/// Default inactivity duration (seconds) that resets an untracked work session.
pub const DEFAULT_IDLE_BREAK_SECS: u64 = 120;
/// Interval between local OS idle samples while actively working without a timer.
const ACTIVE_SAMPLE_INTERVAL_SECS: u64 = 15;
/// Backoff interval when already idle or when a ClickUp timer is running.
const IDLE_OR_RUNNING_SAMPLE_INTERVAL_SECS: u64 = 30;
/// Minimum past delta (ms) before we consider a start timestamp genuinely backdated.
const MIN_EFFECTIVE_BACKDATE_MS: i64 = 5_000;

/// Snapshot of untracked active time returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveUntrackedSnapshot {
    /// Epoch milliseconds when continuous untracked activity started, if active without a timer.
    pub active_since_ms: Option<i64>,
    /// Total seconds of continuous untracked activity so far.
    pub active_duration_secs: u64,
    /// Latest locally observed OS idle seconds.
    pub current_idle_secs: u64,
    /// Epoch milliseconds when the most recent timer ended (prevents overlaps).
    pub last_timer_end_ms: Option<i64>,
}

#[derive(Debug, Clone)]
struct TrackerState {
    active_since_ms: Option<i64>,
    last_idle_secs: u64,
    timer_running: bool,
    last_timer_end_ms: Option<i64>,
    idle_break_secs: u64,
}

impl Default for TrackerState {
    fn default() -> Self {
        Self {
            active_since_ms: None,
            last_idle_secs: 0,
            timer_running: false,
            last_timer_end_ms: None,
            idle_break_secs: DEFAULT_IDLE_BREAK_SECS,
        }
    }
}

impl TrackerState {
    fn observe_sample(&mut self, now_ms: i64, idle_secs: u64) {
        self.last_idle_secs = idle_secs;

        if self.timer_running {
            self.active_since_ms = None;
            return;
        }

        if idle_secs >= self.idle_break_secs {
            // User stepped away long enough to count as a break.
            self.active_since_ms = None;
            return;
        }

        // User is actively working with no timer running.
        let estimated_start_ms = now_ms.saturating_sub((idle_secs as i64).saturating_mul(1000));
        let floor_ms = self.last_timer_end_ms.unwrap_or(i64::MIN);
        let clamped_start_ms = estimated_start_ms.max(floor_ms).min(now_ms);

        match self.active_since_ms {
            None => {
                self.active_since_ms = Some(clamped_start_ms);
            }
            Some(existing_ms) => {
                if existing_ms < floor_ms {
                    self.active_since_ms = Some(floor_ms.min(now_ms));
                }
            }
        }
    }

    fn mark_timer_running(&mut self, running: bool, now_ms: i64) {
        if running {
            self.timer_running = true;
            self.active_since_ms = None;
        } else if self.timer_running {
            self.timer_running = false;
            self.last_timer_end_ms = Some(now_ms);
            // Only anchor immediately if the user is not currently idle.
            if self.last_idle_secs < self.idle_break_secs {
                self.active_since_ms = Some(now_ms);
            } else {
                self.active_since_ms = None;
            }
        }
    }

    fn mark_timer_stopped_at(&mut self, end_ms: i64) {
        self.timer_running = false;
        self.last_timer_end_ms = Some(end_ms);
        if self.last_idle_secs < self.idle_break_secs {
            self.active_since_ms = Some(end_ms);
        } else {
            self.active_since_ms = None;
        }
    }

    fn mark_system_sleep(&mut self) {
        self.active_since_ms = None;
    }

    fn reset_untracked_session(&mut self, now_ms: i64) {
        self.last_timer_end_ms = Some(now_ms);
        self.active_since_ms = if !self.timer_running && self.last_idle_secs < self.idle_break_secs
        {
            Some(now_ms)
        } else {
            None
        };
    }

    fn snapshot(&self, now_ms: i64) -> ActiveUntrackedSnapshot {
        let active_duration_secs = match self.active_since_ms {
            Some(since) if !self.timer_running && now_ms > since => {
                ((now_ms - since) / 1000) as u64
            }
            _ => 0,
        };

        ActiveUntrackedSnapshot {
            active_since_ms: if self.timer_running {
                None
            } else {
                self.active_since_ms
            },
            active_duration_secs,
            current_idle_secs: self.last_idle_secs,
            last_timer_end_ms: self.last_timer_end_ms,
        }
    }

    /// Validate and clamp a requested backdate timestamp so it is never in the future,
    /// never exceeds `max_backdate_secs`, and never overlaps `last_timer_end_ms`.
    fn clamp_backdate_ms(
        &self,
        now_ms: i64,
        requested_start_ms: Option<i64>,
        max_backdate_secs: u64,
    ) -> Option<i64> {
        let target = requested_start_ms?;
        if target >= now_ms.saturating_sub(MIN_EFFECTIVE_BACKDATE_MS) {
            return None;
        }

        let max_lookback_ms = (max_backdate_secs as i64).saturating_mul(1000);
        let min_allowed_by_cap = now_ms.saturating_sub(max_lookback_ms);
        let min_allowed_by_prev = self.last_timer_end_ms.unwrap_or(i64::MIN);
        let clamped = target.max(min_allowed_by_cap).max(min_allowed_by_prev);

        if clamped >= now_ms.saturating_sub(MIN_EFFECTIVE_BACKDATE_MS) {
            return None;
        }

        Some(clamped)
    }
}

fn tracker_store() -> &'static Mutex<TrackerState> {
    static TRACKER: OnceLock<Mutex<TrackerState>> = OnceLock::new();
    TRACKER.get_or_init(|| Mutex::new(TrackerState::default()))
}

/// Record an observed idle sample (called by the background sampler and runtime polls).
pub fn observe_sample(now_ms: i64, idle_secs: u64) {
    if let Ok(mut state) = tracker_store().lock() {
        state.observe_sample(now_ms, idle_secs);
    }
}

/// Update whether a ClickUp timer is currently active.
pub fn mark_timer_running(running: bool, now_ms: i64) {
    if let Ok(mut state) = tracker_store().lock() {
        state.mark_timer_running(running, now_ms);
    }
}

/// Record an explicit timer stop timestamp to anchor future untracked sessions.
pub fn mark_timer_stopped_at(end_ms: i64) {
    if let Ok(mut state) = tracker_store().lock() {
        state.mark_timer_stopped_at(end_ms);
    }
}

/// Clear active untracked session when the system goes to sleep.
pub fn mark_system_sleep() {
    if let Ok(mut state) = tracker_store().lock() {
        state.mark_system_sleep();
    }
}

/// Reset the untracked active anchor (e.g., if the user dismisses backdating).
pub fn reset_untracked_session(now_ms: i64) {
    if let Ok(mut state) = tracker_store().lock() {
        state.reset_untracked_session(now_ms);
    }
}

/// Return the current active-untracked snapshot.
pub fn get_snapshot(now_ms: i64) -> ActiveUntrackedSnapshot {
    tracker_store()
        .lock()
        .map(|state| state.snapshot(now_ms))
        .unwrap_or(ActiveUntrackedSnapshot {
            active_since_ms: None,
            active_duration_secs: 0,
            current_idle_secs: 0,
            last_timer_end_ms: None,
        })
}

/// Clamp a requested backdate timestamp safely against bounds and previous timer end.
pub fn clamp_backdate_ms(
    now_ms: i64,
    requested_start_ms: Option<i64>,
    max_backdate_secs: u64,
) -> Option<i64> {
    tracker_store()
        .lock()
        .ok()
        .and_then(|state| state.clamp_backdate_ms(now_ms, requested_start_ms, max_backdate_secs))
}

/// Spawn the adaptive background OS idle sampler (zero network overhead).
///
/// - Skips native idle queries while a timer is already running (`poll_runtime` handles it).
/// - Samples every 15s while actively working untracked (accurate to the second via OS `idle_secs`).
/// - Backs off to 30s once idle past the break threshold.
pub fn start_idle_sampler() {
    tauri::async_runtime::spawn(async move {
        loop {
            let (is_running, is_idle) = tracker_store()
                .lock()
                .map(|state| (state.timer_running, state.last_idle_secs >= state.idle_break_secs))
                .unwrap_or((false, false));

            if !is_running {
                if let Ok(idle_secs) = idle_monitor::get_idle_time_secs().await {
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    observe_sample(now_ms, idle_secs);
                }
            }

            let sleep_secs = if is_running || is_idle {
                IDLE_OR_RUNNING_SAMPLE_INTERVAL_SECS
            } else {
                ACTIVE_SAMPLE_INTERVAL_SECS
            };
            tokio::time::sleep(Duration::from_secs(sleep_secs)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_continuous_untracked_activity_and_resets_on_idle_break() {
        let mut state = TrackerState::default();
        let t0 = 1_700_000_000_000_i64;

        // First active sample with 15s idle -> anchors 15s earlier
        state.observe_sample(t0, 15);
        assert_eq!(state.active_since_ms, Some(t0 - 15_000));

        // 5 minutes later, still active (idle 5s) -> keeps original anchor
        let t1 = t0 + 300_000;
        state.observe_sample(t1, 5);
        assert_eq!(state.active_since_ms, Some(t0 - 15_000));
        let snap = state.snapshot(t1);
        assert_eq!(snap.active_duration_secs, 315);

        // User steps away for 3 minutes (>= 120s break) -> clears active session
        let t2 = t1 + 180_000;
        state.observe_sample(t2, 180);
        assert_eq!(state.active_since_ms, None);
        assert_eq!(state.snapshot(t2).active_duration_secs, 0);

        // User comes back -> anchors fresh session
        let t3 = t2 + 10_000;
        state.observe_sample(t3, 2);
        assert_eq!(state.active_since_ms, Some(t3 - 2_000));
    }

    #[test]
    fn prevents_backdate_overlap_with_previous_stopped_timer() {
        let mut state = TrackerState::default();
        let t0 = 1_700_000_000_000_i64;

        state.mark_timer_running(true, t0);
        assert_eq!(state.active_since_ms, None);

        // Timer stops at t1
        let t1 = t0 + 600_000;
        state.mark_timer_stopped_at(t1);
        assert_eq!(state.last_timer_end_ms, Some(t1));

        // 10 minutes later, user requests a backdate that goes 20 minutes back (before t1)
        let t2 = t1 + 600_000;
        let clamped = state.clamp_backdate_ms(t2, Some(t2 - 1_200_000), 7200);
        assert_eq!(clamped, Some(t1));
    }

    #[test]
    fn clamps_backdate_to_max_cap_and_ignores_tiny_deltas() {
        let state = TrackerState::default();
        let now = 1_700_000_000_000_i64;

        // 3 hours ago clamped to 2 hour cap (7200s)
        let clamped = state.clamp_backdate_ms(now, Some(now - 3 * 3600 * 1000), 7200);
        assert_eq!(clamped, Some(now - 7200 * 1000));

        // 2 seconds ago ignored (< 5s min threshold)
        assert_eq!(state.clamp_backdate_ms(now, Some(now - 2_000), 7200), None);

        // Future timestamp ignored
        assert_eq!(state.clamp_backdate_ms(now, Some(now + 60_000), 7200), None);
    }

    #[test]
    fn system_sleep_clears_untracked_anchor() {
        let mut state = TrackerState::default();
        let t0 = 1_700_000_000_000_i64;

        state.observe_sample(t0, 0);
        assert!(state.active_since_ms.is_some());

        state.mark_system_sleep();
        assert_eq!(state.active_since_ms, None);
    }
}
