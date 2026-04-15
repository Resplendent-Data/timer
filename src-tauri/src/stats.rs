//! Statistics tracking and gamification module.
//!
//! Tracks user activity time (active vs idle) and ClickUp timer sessions.
//! Uses a heartbeat system for accurate time tracking.

use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;

/// Database retention period in days
const DB_RETENTION_DAYS: i64 = 90;
const DEFAULT_WORK_DAYS: [usize; 5] = [0, 1, 2, 3, 4];
/// Defensive cap for a single recorded ClickUp session.
const MAX_SESSION_DURATION_SECS: i64 = 24 * 60 * 60;

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
    pub session_seconds_today: i64,
    pub session_seconds_week: i64,
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

/// Lightweight work-progress totals for the timer tab.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkProgressStats {
    pub session_seconds_today: i64,
    pub session_seconds_week: i64,
}

fn sanitize_session_duration_secs(duration_secs: i64) -> Option<i64> {
    if duration_secs <= 0 {
        return None;
    }

    if duration_secs > MAX_SESSION_DURATION_SECS {
        eprintln!(
            "[stats] Ignoring implausible session duration ({}s > {}s cap)",
            duration_secs, MAX_SESSION_DURATION_SECS
        );
        return None;
    }

    Some(duration_secs)
}

fn get_db_path() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("resplendent-timer");
    std::fs::create_dir_all(&path).ok();
    path.push("stats.db");
    path
}

fn open_connection() -> Result<Connection> {
    let path = get_db_path();
    Connection::open(path)
}

fn initialize_schema(conn: &Connection) -> Result<()> {
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

    // Heartbeat event log used for work-hours-aware stats aggregation
    conn.execute(
        "CREATE TABLE IF NOT EXISTS activity_heartbeats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recorded_at INTEGER NOT NULL,
            is_idle BOOLEAN NOT NULL,
            duration_secs INTEGER NOT NULL DEFAULT 30
        )",
        (),
    )?;

    // Migration: Add session_duration_secs column if it doesn't exist (for existing databases)
    let _ = conn.execute(
        "ALTER TABLE idle_events ADD COLUMN session_duration_secs INTEGER DEFAULT 0",
        (),
    );
    let _ = conn.execute(
        "ALTER TABLE activity_heartbeats ADD COLUMN duration_secs INTEGER NOT NULL DEFAULT 30",
        (),
    );

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_idle_events_started_at ON idle_events(started_at)",
        (),
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_activity_heartbeats_recorded_at ON activity_heartbeats(recorded_at)",
        (),
    )?;

    Ok(())
}

fn ensure_schema_initialized() -> Result<()> {
    static SCHEMA_READY: OnceLock<()> = OnceLock::new();
    if SCHEMA_READY.get().is_some() {
        return Ok(());
    }

    let conn = open_connection()?;
    initialize_schema(&conn)?;
    let _ = SCHEMA_READY.get_or_init(|| ());
    Ok(())
}

fn get_connection() -> Result<Connection> {
    ensure_schema_initialized()?;
    open_connection()
}

/// Initialize the database (called at app startup).
/// Drops old tables to reset stats with new schema.
pub fn init_database() {
    if let Ok(conn) = open_connection() {
        // Drop old tables if they exist (full reset)
        let _ = conn.execute("DROP TABLE IF EXISTS daily_stats", ());

        // Ensure new schema is created once up front instead of on every write.
        let _ = initialize_schema(&conn);
        let _ = ensure_schema_initialized();

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
    let _ = conn.execute(
        "DELETE FROM activity_heartbeats WHERE recorded_at < ?",
        (cutoff,),
    );
}

/// Record a heartbeat from the frontend.
/// Called on each runtime scheduler tick with the current idle status and tick duration.
pub fn record_heartbeat(is_idle: bool, duration_secs: i64) {
    if duration_secs <= 0 {
        return;
    }

    if let Ok(conn) = get_connection() {
        let now_ts = chrono::Local::now().timestamp();
        let today = chrono::Local::now().date_naive().to_string();

        // Ensure the day exists
        let _ = conn.execute(
            "INSERT OR IGNORE INTO activity_days (date) VALUES (?)",
            (&today,),
        );

        // Keep heartbeat timestamps so stats can filter by work hours.
        let _ = conn.execute(
            "INSERT INTO activity_heartbeats (recorded_at, is_idle, duration_secs) VALUES (?, ?, ?)",
            (now_ts, is_idle, duration_secs),
        );

        // Add the observed tick duration to the appropriate daily bucket.
        if is_idle {
            let _ = conn.execute(
                "UPDATE activity_days SET idle_seconds = idle_seconds + ? WHERE date = ?",
                (duration_secs, &today),
            );
        } else {
            let _ = conn.execute(
                "UPDATE activity_days SET active_seconds = active_seconds + ? WHERE date = ?",
                (duration_secs, &today),
            );
        }
    }
}

/// Record a ClickUp timer session when stopped.
/// Called when a timer is stopped (either manually or due to idle).
pub fn record_timer_session(duration_secs: i64) {
    let Some(duration_secs) = sanitize_session_duration_secs(duration_secs) else {
        return;
    };

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
        let safe_session_duration_secs = sanitize_session_duration_secs(session_duration_secs)
            .unwrap_or_default();

        let _ = conn.execute(
            "INSERT INTO idle_events (started_at, duration_secs, timer_stopped, task_name, task_id, session_duration_secs)
             VALUES (?, ?, ?, ?, ?, ?)",
            (
                started_at,
                duration_secs,
                timer_stopped,
                task_name.as_deref(),
                task_id.as_deref(),
                safe_session_duration_secs,
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

fn clamp_work_minutes(value: Option<i64>, default_value: i64) -> i64 {
    value.unwrap_or(default_value).clamp(0, (24 * 60) - 1)
}

fn normalize_work_days(value: Option<Vec<i64>>) -> [bool; 7] {
    let mut work_days = [false; 7];
    let mut any_selected = false;

    if let Some(days) = value {
        for day in days {
            if (0..=6).contains(&day) {
                work_days[day as usize] = true;
                any_selected = true;
            }
        }
    }

    if !any_selected {
        for day in DEFAULT_WORK_DAYS {
            work_days[day] = true;
        }
    }

    work_days
}

fn is_work_day(date: NaiveDate, work_days: &[bool; 7]) -> bool {
    let index = date.weekday().num_days_from_monday() as usize;
    work_days[index]
}

fn build_work_hours_condition_sql(work_start_minutes: i64, work_end_minutes: i64) -> String {
    let minute_of_day = "(CAST(strftime('%H', datetime(recorded_at, 'unixepoch', 'localtime')) AS INTEGER) * 60 + CAST(strftime('%M', datetime(recorded_at, 'unixepoch', 'localtime')) AS INTEGER))";

    if work_start_minutes == work_end_minutes {
        "1 = 1".to_string()
    } else if work_start_minutes < work_end_minutes {
        format!("{minute_of_day} >= {work_start_minutes} AND {minute_of_day} < {work_end_minutes}")
    } else {
        format!("{minute_of_day} >= {work_start_minutes} OR {minute_of_day} < {work_end_minutes}")
    }
}

fn get_day_activity_for_work_hours(
    conn: &Connection,
    date: &str,
    work_start_minutes: i64,
    work_end_minutes: i64,
    work_days: &[bool; 7],
) -> Result<(i64, i64)> {
    if let Ok(parsed_date) = NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        if !is_work_day(parsed_date, work_days) {
            return Ok((0, 0));
        }
    }

    let work_hours_condition = build_work_hours_condition_sql(work_start_minutes, work_end_minutes);
    let sql = format!(
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN is_idle = 0 AND ({work_hours_condition}) THEN duration_secs ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN is_idle = 1 AND ({work_hours_condition}) THEN duration_secs ELSE 0 END), 0)
         FROM activity_heartbeats
         WHERE date(datetime(recorded_at, 'unixepoch', 'localtime')) = ?1"
    );

    let (heartbeat_count, filtered_active, filtered_idle): (i64, i64, i64) =
        conn.query_row(&sql, params![date], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;

    if heartbeat_count > 0 {
        return Ok((filtered_active, filtered_idle));
    }

    let fallback = conn
        .query_row(
            "SELECT COALESCE(active_seconds, 0), COALESCE(idle_seconds, 0)
             FROM activity_days WHERE date = ?",
            (date,),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, 0));

    Ok(fallback)
}

fn get_active_for_range(
    conn: &Connection,
    start_date: NaiveDate,
    end_date: NaiveDate,
    work_start_minutes: i64,
    work_end_minutes: i64,
    work_days: &[bool; 7],
) -> Result<i64> {
    if start_date > end_date {
        return Ok(0);
    }

    let mut total_active = 0;
    let mut cursor = start_date;

    while cursor <= end_date {
        let (active, _) = get_day_activity_for_work_hours(
            conn,
            &cursor.to_string(),
            work_start_minutes,
            work_end_minutes,
            work_days,
        )?;
        total_active += active;

        let Some(next_day) = cursor.checked_add_signed(chrono::Duration::days(1)) else {
            break;
        };
        cursor = next_day;
    }

    Ok(total_active)
}

fn get_total_active_seconds_for_work_hours(
    conn: &Connection,
    work_start_minutes: i64,
    work_end_minutes: i64,
    work_days: &[bool; 7],
) -> Result<i64> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT date
         FROM (
            SELECT date AS date FROM activity_days
            UNION ALL
            SELECT date(datetime(recorded_at, 'unixepoch', 'localtime')) AS date FROM activity_heartbeats
         )
         WHERE date IS NOT NULL
         ORDER BY date",
    )?;

    let dates: Vec<String> = stmt
        .query_map((), |row| row.get(0))?
        .filter_map(|d| d.ok())
        .collect();

    let mut total_active = 0;
    for date in dates {
        let (active, _) = get_day_activity_for_work_hours(
            conn,
            &date,
            work_start_minutes,
            work_end_minutes,
            work_days,
        )?;
        total_active += active;
    }

    Ok(total_active)
}

/// Calculate current and best streaks.
/// A streak is consecutive days with any app activity or tracked session.
fn calculate_streaks(conn: &Connection, today: NaiveDate) -> Result<(i64, i64)> {
    let mut stmt = conn.prepare(
        "SELECT date FROM activity_days
         WHERE active_seconds > 0 OR session_count > 0
         ORDER BY date DESC",
    )?;

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
pub fn get_productivity_stats(
    work_start_minutes: Option<i64>,
    work_end_minutes: Option<i64>,
    work_days: Option<Vec<i64>>,
) -> Result<ProductivityStats> {
    let conn = get_connection()?;
    let now = chrono::Local::now();
    let today = now.date_naive();
    let work_start_minutes = clamp_work_minutes(work_start_minutes, 8 * 60);
    let work_end_minutes = clamp_work_minutes(work_end_minutes, 17 * 60);
    let work_days = normalize_work_days(work_days);

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

    // Today's activity (work-hours-aware active/idle + session stats)
    let (active_today, idle_today) = get_day_activity_for_work_hours(
        &conn,
        &today.to_string(),
        work_start_minutes,
        work_end_minutes,
        &work_days,
    )?;
    let (sessions_today, session_seconds_today): (i64, i64) = conn
        .query_row(
            "SELECT
                COALESCE(session_count, 0),
                COALESCE(session_seconds, 0)
             FROM activity_days WHERE date = ?",
            (today.to_string(),),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, 0));

    // This week's session totals (work-hours do not alter ClickUp session durations/counts)
    let (sessions_week, session_seconds_week): (i64, i64) = conn
        .query_row(
            "SELECT
                COALESCE(SUM(session_count), 0),
                COALESCE(SUM(session_seconds), 0)
             FROM activity_days
             WHERE date BETWEEN ? AND ?",
            (week_start.to_string(), today.to_string()),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, 0));

    // Work-hours-aware weekly active totals
    let active_week = get_active_for_range(
        &conn,
        week_start,
        today,
        work_start_minutes,
        work_end_minutes,
        &work_days,
    )?;
    let active_last_week = get_active_for_range(
        &conn,
        last_week_start,
        last_week_end,
        work_start_minutes,
        work_end_minutes,
        &work_days,
    )?;

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

    // XP = total active minutes across all time (work-hours-aware)
    let total_active_seconds = get_total_active_seconds_for_work_hours(
        &conn,
        work_start_minutes,
        work_end_minutes,
        &work_days,
    )?;

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

        let (day_active, day_idle) = get_day_activity_for_work_hours(
            &conn,
            &date_str,
            work_start_minutes,
            work_end_minutes,
            &work_days,
        )?;
        let (session_count, session_seconds): (i64, i64) = conn
            .query_row(
                "SELECT COALESCE(session_count, 0), COALESCE(session_seconds, 0)
                 FROM activity_days WHERE date = ?",
                (&date_str,),
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));

        let day = DailyActivity {
            date: date_str,
            active_seconds: day_active,
            idle_seconds: day_idle,
            session_count,
            session_seconds,
        };

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
        session_seconds_today,
        session_seconds_week,
        avg_session_minutes,
        active_seconds_week: active_week,
        active_seconds_last_week: active_last_week,
        week_delta_seconds: active_week - active_last_week,
        last_7_days,
        recent_events,
    })
}

/// Get lightweight timer-tab work progress totals without the heavier stats aggregation.
pub fn get_work_progress_summary() -> Result<WorkProgressStats> {
    let conn = get_connection()?;
    let today = chrono::Local::now().date_naive();
    let days_since_monday = today.weekday().num_days_from_monday() as i64;
    let week_start = today
        .checked_sub_signed(chrono::Duration::days(days_since_monday))
        .unwrap_or(today);

    let (session_seconds_today, session_seconds_week): (i64, i64) = conn
        .query_row(
            "SELECT
                COALESCE((SELECT session_seconds FROM activity_days WHERE date = ?1), 0),
                COALESCE((SELECT SUM(session_seconds) FROM activity_days WHERE date BETWEEN ?2 AND ?1), 0)",
            params![today.to_string(), week_start.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

    Ok(WorkProgressStats {
        session_seconds_today,
        session_seconds_week,
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

    #[test]
    fn test_sanitize_session_duration_secs() {
        assert_eq!(sanitize_session_duration_secs(0), None);
        assert_eq!(sanitize_session_duration_secs(-5), None);
        assert_eq!(sanitize_session_duration_secs(3600), Some(3600));
        assert_eq!(
            sanitize_session_duration_secs(MAX_SESSION_DURATION_SECS),
            Some(MAX_SESSION_DURATION_SECS)
        );
        assert_eq!(
            sanitize_session_duration_secs(MAX_SESSION_DURATION_SECS + 1),
            None
        );
    }
}
