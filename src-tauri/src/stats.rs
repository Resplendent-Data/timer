//! Statistics tracking and gamification module.
//!
//! Manages local SQLite database for idle events and calculates
//! XP, levels, streaks, and productivity metrics.

use chrono::Datelike;
use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const DB_RETENTION_DAYS: i64 = 90;
const STREAK_MIN_MINUTES: i64 = 60;
const XP_BONUS_SESSION_THRESHOLD_MINUTES: i64 = 30;
const XP_BONUS_SESSION_AMOUNT: i64 = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleEvent {
    pub id: i64,
    pub started_at: i64,
    pub duration_secs: i64,
    pub timer_stopped: bool,
    pub task_name: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStats {
    pub date: String,
    pub focus_minutes: i64,
    pub idle_count: i64,
    pub longest_focus_mins: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductivityStats {
    pub current_xp: i64,
    pub current_level: i64,
    pub xp_for_next_level: i64,
    pub xp_progress_percent: f64,
    pub current_streak: i64,
    pub best_streak: i64,
    pub weekly_rank: i64,
    pub weekly_rank_trend: i64,
    pub total_focus_minutes_today: i64,
    pub total_idle_count_today: i64,
    pub total_focus_minutes_week: i64,
    pub average_focus_minutes: f64,
    pub recent_events: Vec<IdleEvent>,
    pub last_7_days: Vec<DailyStats>,
}

fn get_db_path() -> PathBuf {
    let mut path = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    path.push("resplendent-timer");
    std::fs::create_dir_all(&path).ok();
    path.push("stats.db");
    path
}

fn get_connection() -> Result<Connection> {
    let path = get_db_path();
    let conn = Connection::open(path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS idle_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at INTEGER NOT NULL,
            duration_secs INTEGER NOT NULL,
            timer_stopped BOOLEAN NOT NULL,
            task_name TEXT,
            task_id TEXT
        )",
        (),
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS daily_stats (
            date TEXT PRIMARY KEY,
            focus_minutes INTEGER DEFAULT 0,
            idle_count INTEGER DEFAULT 0,
            longest_focus_mins INTEGER DEFAULT 0
        )",
        (),
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_idle_events_started_at ON idle_events(started_at)",
        (),
    )?;

    Ok(conn)
}

pub fn init_database() {
    if let Err(e) = get_connection() {
        eprintln!("Failed to initialize stats database: {}", e);
    }
}

pub fn record_idle_event(
    started_at: i64,
    duration_secs: i64,
    timer_stopped: bool,
    task_name: Option<String>,
    task_id: Option<String>,
) {
    if let Ok(conn) = get_connection() {
        let _ = conn.execute(
            "INSERT INTO idle_events (started_at, duration_secs, timer_stopped, task_name, task_id)
             VALUES (?, ?, ?, ?, ?)",
            (started_at, duration_secs, timer_stopped, task_name.as_deref(), task_id.as_deref()),
        );

        cleanup_old_data(&conn);
        update_daily_stats(&conn, started_at, duration_secs, timer_stopped);
    }
}

fn cleanup_old_data(conn: &Connection) {
    let cutoff = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::days(DB_RETENTION_DAYS))
        .unwrap()
        .timestamp();
    let _ = conn.execute(
        "DELETE FROM idle_events WHERE started_at < ?",
        (cutoff,),
    );
}

fn update_daily_stats(conn: &Connection, event_started_at: i64, _duration_secs: i64, timer_stopped: bool) {
    let date = chrono::DateTime::from_timestamp(event_started_at, 0)
        .map(|dt| dt.date_naive().to_string())
        .unwrap_or_else(|| chrono::Local::now().date_naive().to_string());

    let focus_minutes = if timer_stopped {
        let duration_mins = (_duration_secs / 60).max(1);
        let bonus = if duration_mins >= XP_BONUS_SESSION_THRESHOLD_MINUTES {
            XP_BONUS_SESSION_AMOUNT
        } else {
            0
        };
        duration_mins + bonus
    } else {
        0
    };

    let _ = conn.execute(
        "INSERT INTO daily_stats (date, focus_minutes, idle_count, longest_focus_mins)
         VALUES (?, 0, 1, 0)
         ON CONFLICT(date) DO UPDATE SET
            idle_count = idle_count + 1",
        (&date,),
    );

    if timer_stopped {
        let _ = conn.execute(
            "INSERT INTO daily_stats (date, focus_minutes, idle_count, longest_focus_mins)
             VALUES (?, ?, 0, ?)
             ON CONFLICT(date) DO UPDATE SET
                focus_minutes = focus_minutes + ?,
                longest_focus_mins = CASE
                    WHEN ? > longest_focus_mins THEN ?
                    ELSE longest_focus_mins
                END",
            (&date, focus_minutes, focus_minutes, focus_minutes, _duration_secs / 60, focus_minutes),
        );
    }
}

fn calculate_level(xp: i64) -> i64 {
    if xp < 100 { 1 }
    else { ((xp as f64).sqrt() / 10.0).floor() as i64 + 1 }
}

fn xp_for_level(level: i64) -> i64 {
    if level <= 1 { 0 }
    else { ((level - 1) * 10).pow(2) }
}

pub fn get_productivity_stats() -> Result<ProductivityStats> {
    let conn = get_connection()?;
    let now = chrono::Utc::now();
    let today = now.date_naive();
    let week_start = today
        .checked_sub_signed(chrono::Duration::days(today.weekday().num_days_from_monday() as i64))
        .unwrap_or(today);

    let total_xp: i64 = conn.query_row(
        "SELECT COALESCE(SUM(focus_minutes), 0) FROM daily_stats",
        (),
        |row| row.get(0),
    )?;

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

    let (current_streak, best_streak) = calculate_streaks(&conn, today)?;

    let (weekly_rank, weekly_rank_trend) = calculate_weekly_rank(&conn, today)?;

    let total_focus_today: i64 = conn.query_row(
        "SELECT COALESCE(SUM(focus_minutes), 0) FROM daily_stats WHERE date = ?",
        (today.to_string(),),
        |row| row.get(0),
    )?;

    let idle_count_today: i64 = conn.query_row(
        "SELECT COALESCE(SUM(idle_count), 0) FROM daily_stats WHERE date = ?",
        (today.to_string(),),
        |row| row.get(0),
    )?;

    let total_focus_week: i64 = conn.query_row(
        "SELECT COALESCE(SUM(focus_minutes), 0) FROM daily_stats WHERE date >= ?",
        (week_start.to_string(),),
        |row| row.get(0),
    )?;

    let avg_focus: f64 = conn.query_row(
        "SELECT COALESCE(AVG(focus_minutes), 0) FROM daily_stats WHERE focus_minutes > 0",
        (),
        |row| row.get(0),
    )?;

    let recent_events: Vec<IdleEvent> = conn.prepare(
        "SELECT id, started_at, duration_secs, timer_stopped, task_name, task_id
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
        })
    })?
    .filter_map(|e| e.ok())
    .collect();

    let last_7_days: Vec<DailyStats> = conn.prepare(
        "SELECT date, focus_minutes, idle_count, longest_focus_mins
         FROM daily_stats ORDER BY date DESC LIMIT 7",
    )?
    .query_map((), |row| {
        Ok(DailyStats {
            date: row.get(0)?,
            focus_minutes: row.get(1)?,
            idle_count: row.get(2)?,
            longest_focus_mins: row.get(3)?,
        })
    })?
    .filter_map(|e| e.ok())
    .collect();

    Ok(ProductivityStats {
        current_xp: total_xp,
        current_level,
        xp_for_next_level: xp_for_next,
        xp_progress_percent,
        current_streak,
        best_streak,
        weekly_rank,
        weekly_rank_trend,
        total_focus_minutes_today: total_focus_today,
        total_idle_count_today: idle_count_today,
        total_focus_minutes_week: total_focus_week,
        average_focus_minutes: avg_focus,
        recent_events,
        last_7_days,
    })
}

fn calculate_streaks(conn: &Connection, today: chrono::NaiveDate) -> Result<(i64, i64)> {
    let mut stmt = conn.prepare(
        "SELECT date FROM daily_stats WHERE focus_minutes >= ? ORDER BY date DESC",
    )?;
    let dates: Vec<String> = stmt.query_map([STREAK_MIN_MINUTES], |row| row.get(0))?
        .filter_map(|e| e.ok())
        .collect();

    let mut current_streak: i64 = 0;
    let mut best_streak: i64 = 0;
    let mut temp_streak: i64 = 0;
    let mut previous_date: Option<chrono::NaiveDate> = None;

    for date_str in &dates {
        if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            if let Some(prev) = previous_date {
                let diff = (prev - date).num_days();
                if diff == 1 {
                    temp_streak += 1;
                } else {
                    best_streak = best_streak.max(temp_streak);
                    temp_streak = 1;
                }
            } else {
                let days_since_today = (today - date).num_days();
                if days_since_today <= 1 {
                    temp_streak = 1;
                }
            }
            previous_date = Some(date);
        }
    }
    best_streak = best_streak.max(temp_streak);

    if let Some(prev) = previous_date {
        let days_since_last = (today - prev).num_days();
        if days_since_last <= 1 {
            current_streak = temp_streak;
        }
    }

    Ok((current_streak, best_streak))
}

fn calculate_weekly_rank(conn: &Connection, today: chrono::NaiveDate) -> Result<(i64, i64)> {
    let week_end = today;
    let week_start = week_end
        .checked_sub_signed(chrono::Duration::days(6))
        .unwrap_or(week_end);

    let current_week_focus: i64 = conn.query_row(
        "SELECT COALESCE(SUM(focus_minutes), 0) FROM daily_stats WHERE date BETWEEN ? AND ?",
        (week_start.to_string(), week_end.to_string()),
        |row| row.get(0),
    )?;

    let mut stmt2 = conn.prepare(
        "SELECT date, focus_minutes FROM daily_stats WHERE date < ? ORDER BY date DESC LIMIT 14",
    )?;
    let past_weeks: Vec<(String, i64)> = stmt2.query_map([week_start.to_string()], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|e| e.ok())
        .collect();

    let mut week_totals: Vec<(chrono::NaiveDate, i64)> = past_weeks
        .iter()
        .filter_map(|(date_str, mins)| {
            chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                .ok()
                .map(|d| (d, *mins))
        })
        .collect();

    week_totals.sort_by_key(|(d, _)| *d);
    let mut weekly_comparison: Vec<(chrono::NaiveDate, i64)> = Vec::new();
    let mut i = 0;
    while i < week_totals.len() {
        let week_start_date = week_totals[i].0;
        let mut week_total = week_totals[i].1;
        let mut j = i;
        while j < week_totals.len() && (week_totals[j].0 - week_start_date).num_days() < 7 {
            week_total += week_totals[j].1;
            j += 1;
        }
        weekly_comparison.push((week_start_date, week_total));
        i = j;
    }

    let mut rank: i64 = 1;
    let mut trend: i64 = 0;
    let mut prev_week_total: i64 = 0;

    for (_, week_total) in weekly_comparison.iter().rev() {
        if *week_total > current_week_focus {
            rank += 1;
        }
        if prev_week_total > 0 {
            if *week_total > prev_week_total {
                trend = trend.min(-1);
            } else if *week_total < prev_week_total {
                trend = trend.max(1);
            }
        }
        prev_week_total = *week_total;
    }

    let total_weeks = weekly_comparison.len() as i64 + 1;
    let position = if total_weeks > 1 {
        ((total_weeks - rank + 1) as f64 / total_weeks as f64 * 4.0).ceil() as i64
    } else {
        1
    };

    Ok((position.clamp(1, 4), trend))
}
