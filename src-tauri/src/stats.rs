//! Statistics tracking and gamification module.
//!
//! Tracks user activity time (active vs idle) and ClickUp timer sessions.
//! Uses a heartbeat system for accurate time tracking.

use chrono::{Datelike, NaiveDate};
use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Heartbeat interval in seconds (must match frontend)
const HEARTBEAT_INTERVAL_SECS: i64 = 30;

/// Database retention period in days
const DB_RETENTION_DAYS: i64 = 90;

/// Daily activity record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyActivity {
    pub date: String,
    pub active_seconds: i64,
    pub idle_seconds: i64,
    pub session_count: i64,
    pub session_seconds: i64,
}

/// Idle event record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleEvent {
    pub id: i64,
    pub started_at: i64,
    pub duration_secs: i64,
    pub timer_stopped: bool,
    pub task_name: Option<String>,
    pub task_id: Option<String>,
    pub session_duration_secs: i64,
}

/// Complete productivity stats returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductivityStats {
    // Today's activity
    pub active_seconds_today: i64,
    pub idle_seconds_today: i64,

    // Streaks (consecutive days with any app activity)
    pub current_streak: i64,
    pub best_streak: i64,

    // XP/Level (based on real active time)
    pub current_xp: i64,
    pub current_level: i64,
    pub xp_for_next_level: i64,
    pub xp_progress_percent: f64,

    // ClickUp sessions
    pub sessions_today: i64,
    pub sessions_week: i64,
    pub avg_session_minutes: f64,

    // Weekly comparison
    pub active_seconds_week: i64,
    pub active_seconds_last_week: i64,
    pub week_delta_seconds: i64,

    // Charts
    pub last_7_days: Vec<DailyActivity>,

    // Events
    pub recent_events: Vec<IdleEvent>,
}

fn get_db_path() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("resplendent-timer");
    std::fs::create_dir_all(&path).ok();
    path.push("stats.db");
    path
}

fn get_connection() -> Result<Connection> {
    let path = get_db_path();
    let conn = Connection::open(path)?;

    // New activity_days table (replaces daily_stats)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS activity_days (
            date TEXT PRIMARY KEY,
            active_seconds INTEGER DEFAULT 0,
            idle_seconds INTEGER DEFAULT 0,
            session_count INTEGER DEFAULT 0,
            session_seconds INTEGER DEFAULT 0
        )",
        (),
    )?;

    // Updated idle_events table with session_duration_secs
    conn.execute(
        "CREATE TABLE IF NOT EXISTS idle_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at INTEGER NOT NULL,
            duration_secs INTEGER NOT NULL,
            timer_stopped BOOLEAN NOT NULL,
            task_name TEXT,
            task_id TEXT,
            session_duration_secs INTEGER DEFAULT 0
        )",
        (),
    )?;

    // Migration: Add session_duration_secs column if it doesn't exist (for existing databases)
    let _ = conn.execute(
        "ALTER TABLE idle_events ADD COLUMN session_duration_secs INTEGER DEFAULT 0",
        (),
    );

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_idle_events_started_at ON idle_events(started_at)",
        (),
    )?;

    Ok(conn)
}

/// Initialize the database (called at app startup).
/// Drops old tables to reset stats with new schema.
pub fn init_database() {
    if let Ok(conn) = get_connection() {
        // Drop old tables if they exist (full reset)
        let _ = conn.execute("DROP TABLE IF EXISTS daily_stats", ());

        // Ensure new schema is created
        let _ = get_connection();

        // Clean up old data
        cleanup_old_data(&conn);
    }
}

fn cleanup_old_data(conn: &Connection) {
    let cutoff = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::days(DB_RETENTION_DAYS))
        .unwrap()
        .timestamp();

    let cutoff_date = chrono::DateTime::from_timestamp(cutoff, 0)
        .map(|dt| dt.date_naive().to_string())
        .unwrap_or_default();

    let _ = conn.execute("DELETE FROM idle_events WHERE started_at < ?", (cutoff,));
    let _ = conn.execute("DELETE FROM activity_days WHERE date < ?", (cutoff_date,));
}

/// Record a heartbeat from the frontend.
/// Called every 30 seconds with the current idle status.
pub fn record_heartbeat(is_idle: bool) {
    if let Ok(conn) = get_connection() {
        let today = chrono::Local::now().date_naive().to_string();

        // Ensure the day exists
        let _ = conn.execute(
            "INSERT OR IGNORE INTO activity_days (date) VALUES (?)",
            (&today,),
        );

        // Add heartbeat interval to appropriate column
        if is_idle {
            let _ = conn.execute(
                "UPDATE activity_days SET idle_seconds = idle_seconds + ? WHERE date = ?",
                (HEARTBEAT_INTERVAL_SECS, &today),
            );
        } else {
            let _ = conn.execute(
                "UPDATE activity_days SET active_seconds = active_seconds + ? WHERE date = ?",
                (HEARTBEAT_INTERVAL_SECS, &today),
            );
        }
    }
}

/// Record a ClickUp timer session when stopped.
/// Called when a timer is stopped (either manually or due to idle).
pub fn record_timer_session(duration_secs: i64) {
    if duration_secs <= 0 {
        return;
    }

    if let Ok(conn) = get_connection() {
        let today = chrono::Local::now().date_naive().to_string();

        // Ensure the day exists
        let _ = conn.execute(
            "INSERT OR IGNORE INTO activity_days (date) VALUES (?)",
            (&today,),
        );

        // Add session to today's stats
        let _ = conn.execute(
            "UPDATE activity_days SET 
                session_count = session_count + 1,
                session_seconds = session_seconds + ?
             WHERE date = ?",
            (duration_secs, &today),
        );
    }
}

/// Record an idle event (when user exceeds idle threshold).
pub fn record_idle_event(
    started_at: i64,
    duration_secs: i64,
    timer_stopped: bool,
    task_name: Option<String>,
    task_id: Option<String>,
    session_duration_secs: i64,
) {
    if let Ok(conn) = get_connection() {
        let _ = conn.execute(
            "INSERT INTO idle_events (started_at, duration_secs, timer_stopped, task_name, task_id, session_duration_secs)
             VALUES (?, ?, ?, ?, ?, ?)",
            (
                started_at,
                duration_secs,
                timer_stopped,
                task_name.as_deref(),
                task_id.as_deref(),
                session_duration_secs,
            ),
        );

        cleanup_old_data(&conn);
    }
}

/// Calculate XP level from total XP (1 XP per active minute).
fn calculate_level(xp: i64) -> i64 {
    if xp < 100 {
        1
    } else {
        ((xp as f64).sqrt() / 10.0).floor() as i64 + 1
    }
}

/// Calculate XP required to reach a given level.
fn xp_for_level(level: i64) -> i64 {
    if level <= 1 {
        0
    } else {
        ((level - 1) * 10).pow(2)
    }
}

/// Calculate current and best streaks.
/// A streak is consecutive days with any app activity (active_seconds > 0).
fn calculate_streaks(conn: &Connection, today: NaiveDate) -> Result<(i64, i64)> {
    let mut stmt =
        conn.prepare("SELECT date FROM activity_days WHERE active_seconds > 0 ORDER BY date DESC")?;

    let dates: Vec<String> = stmt
        .query_map((), |row| row.get(0))?
        .filter_map(|e| e.ok())
        .collect();

    if dates.is_empty() {
        return Ok((0, 0));
    }

    let mut current_streak: i64 = 0;
    let mut best_streak: i64 = 0;
    let mut temp_streak: i64 = 0;
    let mut previous_date: Option<NaiveDate> = None;
    let mut is_current_streak_active = false;

    for date_str in &dates {
        if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            if let Some(prev) = previous_date {
                let diff = (prev - date).num_days();
                if diff == 1 {
                    // Consecutive day
                    temp_streak += 1;
                } else {
                    // Gap in streak
                    best_streak = best_streak.max(temp_streak);
                    if is_current_streak_active {
                        current_streak = temp_streak;
                        is_current_streak_active = false;
                    }
                    temp_streak = 1;
                }
            } else {
                // First date (most recent)
                let days_since_today = (today - date).num_days();
                if days_since_today <= 1 {
                    // Today or yesterday - streak is active
                    temp_streak = 1;
                    is_current_streak_active = true;
                } else {
                    // Last activity was more than 1 day ago - no current streak
                    temp_streak = 1;
                }
            }
            previous_date = Some(date);
        }
    }

    best_streak = best_streak.max(temp_streak);
    if is_current_streak_active {
        current_streak = temp_streak;
    }

    Ok((current_streak, best_streak))
}

/// Get complete productivity stats.
pub fn get_productivity_stats() -> Result<ProductivityStats> {
    let conn = get_connection()?;
    let now = chrono::Local::now();
    let today = now.date_naive();

    // Calculate week boundaries (Monday to Sunday)
    let days_since_monday = today.weekday().num_days_from_monday() as i64;
    let week_start = today
        .checked_sub_signed(chrono::Duration::days(days_since_monday))
        .unwrap_or(today);
    let last_week_start = week_start
        .checked_sub_signed(chrono::Duration::days(7))
        .unwrap_or(week_start);
    let last_week_end = week_start
        .checked_sub_signed(chrono::Duration::days(1))
        .unwrap_or(week_start);

    // Today's activity
    let (active_today, idle_today, sessions_today): (i64, i64, i64) = conn
        .query_row(
            "SELECT COALESCE(active_seconds, 0), COALESCE(idle_seconds, 0), COALESCE(session_count, 0) 
             FROM activity_days WHERE date = ?",
            (today.to_string(),),
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap_or((0, 0, 0));

    // This week's activity
    let (active_week, sessions_week, _session_seconds_week): (i64, i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(active_seconds), 0), COALESCE(SUM(session_count), 0), COALESCE(SUM(session_seconds), 0) 
             FROM activity_days WHERE date >= ?",
            (week_start.to_string(),),
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap_or((0, 0, 0));

    // Last week's activity
    let active_last_week: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(active_seconds), 0) FROM activity_days WHERE date BETWEEN ? AND ?",
            (last_week_start.to_string(), last_week_end.to_string()),
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Average session duration (across all time)
    let (total_sessions, total_session_seconds): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(session_count), 0), COALESCE(SUM(session_seconds), 0) FROM activity_days",
            (),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, 0));

    let avg_session_minutes = if total_sessions > 0 {
        (total_session_seconds as f64 / total_sessions as f64) / 60.0
    } else {
        0.0
    };

    // XP = total active minutes across all time
    let total_active_seconds: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(active_seconds), 0) FROM activity_days",
            (),
            |row| row.get(0),
        )
        .unwrap_or(0);

    let total_xp = total_active_seconds / 60; // 1 XP per active minute
    let current_level = calculate_level(total_xp);
    let xp_for_next = xp_for_level(current_level + 1);
    let xp_for_current = xp_for_level(current_level);
    let xp_in_current_level = total_xp - xp_for_current;
    let xp_needed_for_next = xp_for_next - xp_for_current;
    let xp_progress_percent = if xp_needed_for_next > 0 {
        (xp_in_current_level as f64 / xp_needed_for_next as f64).min(1.0) * 100.0
    } else {
        100.0
    };

    // Streaks
    let (current_streak, best_streak) = calculate_streaks(&conn, today)?;

    // Last 7 days of activity (fill in missing days with zeros)
    let mut last_7_days: Vec<DailyActivity> = Vec::new();
    for i in (0..7).rev() {
        let date = today
            .checked_sub_signed(chrono::Duration::days(i))
            .unwrap_or(today);
        let date_str = date.to_string();

        let day = conn
            .query_row(
                "SELECT date, active_seconds, idle_seconds, session_count, session_seconds 
                 FROM activity_days WHERE date = ?",
                (&date_str,),
                |row| {
                    Ok(DailyActivity {
                        date: row.get(0)?,
                        active_seconds: row.get(1)?,
                        idle_seconds: row.get(2)?,
                        session_count: row.get(3)?,
                        session_seconds: row.get(4)?,
                    })
                },
            )
            .unwrap_or(DailyActivity {
                date: date_str,
                active_seconds: 0,
                idle_seconds: 0,
                session_count: 0,
                session_seconds: 0,
            });

        last_7_days.push(day);
    }

    // Recent idle events
    let recent_events: Vec<IdleEvent> = conn
        .prepare(
            "SELECT id, started_at, duration_secs, timer_stopped, task_name, task_id, session_duration_secs
             FROM idle_events ORDER BY started_at DESC LIMIT 10",
        )?
        .query_map((), |row| {
            Ok(IdleEvent {
                id: row.get(0)?,
                started_at: row.get(1)?,
                duration_secs: row.get(2)?,
                timer_stopped: row.get(3)?,
                task_name: row.get(4)?,
                task_id: row.get(5)?,
                session_duration_secs: row.get(6).unwrap_or(0),
            })
        })?
        .filter_map(|e| e.ok())
        .collect();

    Ok(ProductivityStats {
        active_seconds_today: active_today,
        idle_seconds_today: idle_today,
        current_streak,
        best_streak,
        current_xp: total_xp,
        current_level,
        xp_for_next_level: xp_for_next,
        xp_progress_percent,
        sessions_today,
        sessions_week,
        avg_session_minutes,
        active_seconds_week: active_week,
        active_seconds_last_week: active_last_week,
        week_delta_seconds: active_week - active_last_week,
        last_7_days,
        recent_events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_level_calculation() {
        assert_eq!(calculate_level(0), 1);
        assert_eq!(calculate_level(50), 1);
        assert_eq!(calculate_level(100), 2);
        assert_eq!(calculate_level(400), 3);
        assert_eq!(calculate_level(900), 4);
    }

    #[test]
    fn test_xp_for_level() {
        assert_eq!(xp_for_level(1), 0);
        assert_eq!(xp_for_level(2), 100);
        assert_eq!(xp_for_level(3), 400);
        assert_eq!(xp_for_level(4), 900);
    }
}
