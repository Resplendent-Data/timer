//! Statistics tracking and gamification module.
//!
//! Tracks user activity time (active vs idle) and ClickUp timer sessions using
//! a single persistent WAL-mode SQLite connection (capped at 1 MB cache) and
//! an in-memory cache for pending backdates to keep idle CPU & RAM minimal.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

/// Database retention period in days.
const DB_RETENTION_DAYS: i64 = 90;
const DEFAULT_WORK_DAYS: [usize; 5] = [0, 1, 2, 3, 4];
/// Defensive cap for a single recorded ClickUp session.
const MAX_SESSION_DURATION_SECS: i64 = 24 * 60 * 60;

/// Daily activity record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyActivity {
    pub date: String,
    pub active_seconds: i64,
    pub idle_seconds: i64,
    pub session_count: i64,
    pub session_seconds: i64,
}

/// Idle event record.
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

/// Complete productivity stats returned to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductivityStats {
    pub active_seconds_today: i64,
    pub idle_seconds_today: i64,
    pub current_streak: i64,
    pub best_streak: i64,
    pub current_xp: i64,
    pub current_level: i64,
    pub xp_for_next_level: i64,
    pub xp_progress_percent: f64,
    pub sessions_today: i64,
    pub sessions_week: i64,
    pub session_seconds_today: i64,
    pub session_seconds_week: i64,
    pub avg_session_minutes: f64,
    pub active_seconds_week: i64,
    pub active_seconds_last_week: i64,
    pub week_delta_seconds: i64,
    pub last_7_days: Vec<DailyActivity>,
    pub recent_events: Vec<IdleEvent>,
}

/// Lightweight work-progress totals for the Focus view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkProgressStats {
    pub session_seconds_today: i64,
    pub session_seconds_week: i64,
}

#[derive(Debug, Default, Clone, Copy)]
struct DayRow {
    active_seconds: i64,
    idle_seconds: i64,
    session_count: i64,
    session_seconds: i64,
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

fn open_and_configure_connection() -> Result<Connection> {
    let path = get_db_path();
    let conn = Connection::open(path)?;
    // Cap SQLite memory cache at 1 MB and enable WAL for low-overhead heartbeats.
    let _ = conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -1000;
         PRAGMA temp_store = MEMORY;
         PRAGMA busy_timeout = 3000;",
    );
    Ok(conn)
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

    conn.execute(
        "CREATE TABLE IF NOT EXISTS activity_heartbeats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recorded_at INTEGER NOT NULL,
            is_idle BOOLEAN NOT NULL,
            duration_secs INTEGER NOT NULL DEFAULT 30
        )",
        (),
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS pending_backdates (
            timer_id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            backdate_start_ms INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )",
        (),
    )?;

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

/// Run a closure against the single persistent SQLite connection.
fn with_connection<T>(f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    static DB: OnceLock<Mutex<Option<Connection>>> = OnceLock::new();
    let slot = DB.get_or_init(|| Mutex::new(None));
    let mut guard = slot.lock().unwrap_or_else(|e| e.into_inner());

    if guard.is_none() {
        let conn = open_and_configure_connection()?;
        initialize_schema(&conn)?;
        *guard = Some(conn);
    }

    f(guard.as_ref().expect("SQLite connection initialized"))
}

/// In-memory cache of `pending_backdates` so runtime polls never hit SQLite.
struct PendingBackdateCache {
    hydrated: bool,
    entries: HashMap<String, (String, i64)>,
}

fn pending_backdate_cache() -> &'static Mutex<PendingBackdateCache> {
    static CACHE: OnceLock<Mutex<PendingBackdateCache>> = OnceLock::new();
    CACHE.get_or_init(|| {
        Mutex::new(PendingBackdateCache {
            hydrated: false,
            entries: HashMap::new(),
        })
    })
}

fn ensure_backdate_cache_hydrated(cache: &mut PendingBackdateCache) {
    if cache.hydrated {
        return;
    }
    cache.hydrated = true;

    let loaded = with_connection(|conn| {
        let mut stmt = conn.prepare(
            "SELECT timer_id, team_id, backdate_start_ms FROM pending_backdates",
        )?;
        let rows = stmt
            .query_map((), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        Ok(rows)
    });

    if let Ok(rows) = loaded {
        for (timer_id, team_id, backdate_start_ms) in rows {
            cache.entries.insert(timer_id, (team_id, backdate_start_ms));
        }
    }
}

/// Initialize the database (called at app startup).
pub fn init_database() {
    let _ = with_connection(|conn| {
        let _ = conn.execute("DROP TABLE IF EXISTS daily_stats", ());
        cleanup_old_data(conn);
        Ok(())
    });

    if let Ok(mut cache) = pending_backdate_cache().lock() {
        ensure_backdate_cache_hydrated(&mut cache);
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
    let stale_backdate_cutoff = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::hours(48))
        .map(|dt| dt.timestamp())
        .unwrap_or(0);
    let _ = conn.execute(
        "DELETE FROM pending_backdates WHERE created_at < ?",
        (stale_backdate_cutoff,),
    );
}

/// Persist a pending backdate start timestamp for a running ClickUp time entry.
pub fn save_pending_backdate(timer_id: &str, team_id: &str, backdate_start_ms: i64) {
    if let Ok(mut cache) = pending_backdate_cache().lock() {
        ensure_backdate_cache_hydrated(&mut cache);
        cache
            .entries
            .insert(timer_id.to_string(), (team_id.to_string(), backdate_start_ms));
    }

    let _ = with_connection(|conn| {
        let now_ts = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO pending_backdates (timer_id, team_id, backdate_start_ms, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(timer_id) DO UPDATE SET
                team_id = excluded.team_id,
                backdate_start_ms = excluded.backdate_start_ms,
                created_at = excluded.created_at",
            params![timer_id, team_id, backdate_start_ms, now_ts],
        )?;
        Ok(())
    });
}

/// Look up a pending backdate start timestamp (zero SQLite overhead via in-memory mirror).
pub fn get_pending_backdate(timer_id: &str, team_id: &str) -> Option<i64> {
    let mut cache = pending_backdate_cache().lock().ok()?;
    ensure_backdate_cache_hydrated(&mut cache);
    cache
        .entries
        .get(timer_id)
        .filter(|(stored_team, _)| stored_team == team_id)
        .map(|(_, start_ms)| *start_ms)
}

/// Remove a pending backdate once applied or discarded.
pub fn clear_pending_backdate(timer_id: &str) {
    if let Ok(mut cache) = pending_backdate_cache().lock() {
        cache.entries.remove(timer_id);
    }

    let _ = with_connection(|conn| {
        conn.execute(
            "DELETE FROM pending_backdates WHERE timer_id = ?1",
            params![timer_id],
        )?;
        Ok(())
    });
}

/// Record a heartbeat from the runtime scheduler.
pub fn record_heartbeat(is_idle: bool, duration_secs: i64) {
    if duration_secs <= 0 {
        return;
    }

    let _ = with_connection(|conn| {
        let now = chrono::Local::now();
        let now_ts = now.timestamp();
        let today = now.date_naive().to_string();

        conn.execute(
            "INSERT OR IGNORE INTO activity_days (date) VALUES (?)",
            (&today,),
        )?;

        conn.execute(
            "INSERT INTO activity_heartbeats (recorded_at, is_idle, duration_secs) VALUES (?, ?, ?)",
            (now_ts, is_idle, duration_secs),
        )?;

        if is_idle {
            conn.execute(
                "UPDATE activity_days SET idle_seconds = idle_seconds + ? WHERE date = ?",
                (duration_secs, &today),
            )?;
        } else {
            conn.execute(
                "UPDATE activity_days SET active_seconds = active_seconds + ? WHERE date = ?",
                (duration_secs, &today),
            )?;
        }
        Ok(())
    });
}

/// Record a ClickUp timer session when stopped.
pub fn record_timer_session(duration_secs: i64) {
    let Some(duration_secs) = sanitize_session_duration_secs(duration_secs) else {
        return;
    };

    let _ = with_connection(|conn| {
        let today = chrono::Local::now().date_naive().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO activity_days (date) VALUES (?)",
            (&today,),
        )?;
        conn.execute(
            "UPDATE activity_days SET
                session_count = session_count + 1,
                session_seconds = session_seconds + ?
             WHERE date = ?",
            (duration_secs, &today),
        )?;
        Ok(())
    });
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
    let _ = with_connection(|conn| {
        let safe_session_duration_secs =
            sanitize_session_duration_secs(session_duration_secs).unwrap_or_default();

        conn.execute(
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
        )?;

        cleanup_old_data(conn);
        Ok(())
    });
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

/// Resolve active/idle seconds for a single date using pre-loaded grouped maps.
fn resolve_day_activity(
    date: NaiveDate,
    date_str: &str,
    heartbeats_by_date: &HashMap<String, (i64, i64)>,
    days_by_date: &HashMap<String, DayRow>,
    work_days: &[bool; 7],
) -> (i64, i64) {
    if !is_work_day(date, work_days) {
        return (0, 0);
    }

    if let Some(&(active, idle)) = heartbeats_by_date.get(date_str) {
        return (active, idle);
    }

    days_by_date
        .get(date_str)
        .map(|row| (row.active_seconds, row.idle_seconds))
        .unwrap_or((0, 0))
}

fn calculate_streaks_from_days(
    days_by_date: &HashMap<String, DayRow>,
    today: NaiveDate,
) -> (i64, i64) {
    let mut dates: Vec<NaiveDate> = days_by_date
        .iter()
        .filter(|(_, row)| row.active_seconds > 0 || row.session_count > 0)
        .filter_map(|(date_str, _)| NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok())
        .collect();

    if dates.is_empty() {
        return (0, 0);
    }

    dates.sort_unstable_by(|a, b| b.cmp(a));

    let mut current_streak: i64 = 0;
    let mut best_streak: i64 = 0;
    let mut temp_streak: i64 = 0;
    let mut previous_date: Option<NaiveDate> = None;
    let mut is_current_streak_active = false;

    for date in dates {
        if let Some(prev) = previous_date {
            if (prev - date).num_days() == 1 {
                temp_streak += 1;
            } else {
                best_streak = best_streak.max(temp_streak);
                if is_current_streak_active {
                    current_streak = temp_streak;
                    is_current_streak_active = false;
                }
                temp_streak = 1;
            }
        } else {
            let days_since_today = (today - date).num_days();
            temp_streak = 1;
            if days_since_today <= 1 {
                is_current_streak_active = true;
            }
        }
        previous_date = Some(date);
    }

    best_streak = best_streak.max(temp_streak);
    if is_current_streak_active {
        current_streak = temp_streak;
    }

    (current_streak, best_streak)
}

fn compute_productivity_stats_from_conn(
    conn: &Connection,
    today: NaiveDate,
    work_start_minutes: i64,
    work_end_minutes: i64,
    work_days: &[bool; 7],
) -> Result<ProductivityStats> {
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

    // Query 1: Single grouped aggregation across all heartbeat rows (replaces ~110 per-day queries).
    let work_hours_condition = build_work_hours_condition_sql(work_start_minutes, work_end_minutes);
    let hb_sql = format!(
        "SELECT
            date(datetime(recorded_at, 'unixepoch', 'localtime')) AS d,
            COALESCE(SUM(CASE WHEN is_idle = 0 AND ({work_hours_condition}) THEN duration_secs ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN is_idle = 1 AND ({work_hours_condition}) THEN duration_secs ELSE 0 END), 0)
         FROM activity_heartbeats
         GROUP BY d"
    );

    let mut heartbeats_by_date: HashMap<String, (i64, i64)> = HashMap::new();
    {
        let mut stmt = conn.prepare(&hb_sql)?;
        let rows = stmt.query_map((), |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows.flatten() {
            if let Some(date) = row.0 {
                heartbeats_by_date.insert(date, (row.1, row.2));
            }
        }
    }

    // Query 2: All daily summary rows (at most ~90 rows due to retention window).
    let mut days_by_date: HashMap<String, DayRow> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT date, COALESCE(active_seconds, 0), COALESCE(idle_seconds, 0),
                    COALESCE(session_count, 0), COALESCE(session_seconds, 0)
             FROM activity_days",
        )?;
        let rows = stmt.query_map((), |row| {
            Ok((
                row.get::<_, String>(0)?,
                DayRow {
                    active_seconds: row.get(1)?,
                    idle_seconds: row.get(2)?,
                    session_count: row.get(3)?,
                    session_seconds: row.get(4)?,
                },
            ))
        })?;
        for (date, day_row) in rows.flatten() {
            days_by_date.insert(date, day_row);
        }
    }

    // Query 3: Recent 10 idle events.
    let recent_events: Vec<IdleEvent> = {
        let mut stmt = conn.prepare(
            "SELECT id, started_at, duration_secs, timer_stopped, task_name, task_id, session_duration_secs
             FROM idle_events ORDER BY started_at DESC LIMIT 10",
        )?;
        let events = stmt
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
        events
    };

    // In-memory aggregation from the 2 small maps.
    let today_str = today.to_string();
    let (active_today, idle_today) = resolve_day_activity(
        today,
        &today_str,
        &heartbeats_by_date,
        &days_by_date,
        work_days,
    );

    let today_day_row = days_by_date.get(&today_str).copied().unwrap_or_default();
    let sessions_today = today_day_row.session_count;
    let session_seconds_today = today_day_row.session_seconds;

    let mut sessions_week: i64 = 0;
    let mut session_seconds_week: i64 = 0;
    let mut total_sessions: i64 = 0;
    let mut total_session_seconds: i64 = 0;

    for (date_str, row) in &days_by_date {
        total_sessions += row.session_count;
        total_session_seconds += row.session_seconds;
        if let Ok(parsed) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            if parsed >= week_start && parsed <= today {
                sessions_week += row.session_count;
                session_seconds_week += row.session_seconds;
            }
        }
    }

    let mut all_dates: HashSet<&str> = HashSet::new();
    for date in heartbeats_by_date.keys() {
        all_dates.insert(date.as_str());
    }
    for date in days_by_date.keys() {
        all_dates.insert(date.as_str());
    }

    let mut total_active_seconds: i64 = 0;
    let mut active_week: i64 = 0;
    let mut active_last_week: i64 = 0;

    for date_str in all_dates {
        let Ok(parsed) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
            continue;
        };
        let (day_active, _) = resolve_day_activity(
            parsed,
            date_str,
            &heartbeats_by_date,
            &days_by_date,
            work_days,
        );
        total_active_seconds += day_active;
        if parsed >= week_start && parsed <= today {
            active_week += day_active;
        } else if parsed >= last_week_start && parsed <= last_week_end {
            active_last_week += day_active;
        }
    }

    let avg_session_minutes = if total_sessions > 0 {
        (total_session_seconds as f64 / total_sessions as f64) / 60.0
    } else {
        0.0
    };

    let total_xp = total_active_seconds / 60;
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

    let (current_streak, best_streak) = calculate_streaks_from_days(&days_by_date, today);

    let mut last_7_days = Vec::with_capacity(7);
    for i in (0..7).rev() {
        let date = today
            .checked_sub_signed(chrono::Duration::days(i))
            .unwrap_or(today);
        let date_str = date.to_string();
        let (day_active, day_idle) = resolve_day_activity(
            date,
            &date_str,
            &heartbeats_by_date,
            &days_by_date,
            work_days,
        );
        let day_row = days_by_date.get(&date_str).copied().unwrap_or_default();
        last_7_days.push(DailyActivity {
            date: date_str,
            active_seconds: day_active,
            idle_seconds: day_idle,
            session_count: day_row.session_count,
            session_seconds: day_row.session_seconds,
        });
    }

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

/// Get complete productivity stats.
pub fn get_productivity_stats(
    work_start_minutes: Option<i64>,
    work_end_minutes: Option<i64>,
    work_days: Option<Vec<i64>>,
) -> Result<ProductivityStats> {
    let today = chrono::Local::now().date_naive();
    let work_start_minutes = clamp_work_minutes(work_start_minutes, 8 * 60);
    let work_end_minutes = clamp_work_minutes(work_end_minutes, 17 * 60);
    let work_days = normalize_work_days(work_days);

    with_connection(|conn| {
        compute_productivity_stats_from_conn(
            conn,
            today,
            work_start_minutes,
            work_end_minutes,
            &work_days,
        )
    })
}

/// Get lightweight Focus-view work progress totals without heavier stats aggregation.
pub fn get_work_progress_summary() -> Result<WorkProgressStats> {
    let today = chrono::Local::now().date_naive();
    let days_since_monday = today.weekday().num_days_from_monday() as i64;
    let week_start = today
        .checked_sub_signed(chrono::Duration::days(days_since_monday))
        .unwrap_or(today);

    with_connection(|conn| {
        let (session_seconds_today, session_seconds_week): (i64, i64) = conn.query_row(
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

    #[test]
    fn test_pending_backdates_schema_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO pending_backdates (timer_id, team_id, backdate_start_ms, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params!["entry_1", "team_1", 1_700_000_000_000_i64, 1_700_000_100_i64],
        )
        .unwrap();

        let fetched: i64 = conn
            .query_row(
                "SELECT backdate_start_ms FROM pending_backdates WHERE timer_id = ?1 AND team_id = ?2",
                params!["entry_1", "team_1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fetched, 1_700_000_000_000_i64);

        conn.execute(
            "DELETE FROM pending_backdates WHERE timer_id = ?1",
            params!["entry_1"],
        )
        .unwrap();
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM pending_backdates", (), |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn test_grouped_productivity_stats_aggregates_accurately() {
        let conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();

        let wednesday = NaiveDate::from_ymd_opt(2026, 11, 25).unwrap();
        let tuesday = NaiveDate::from_ymd_opt(2026, 11, 24).unwrap();
        let last_monday = NaiveDate::from_ymd_opt(2026, 11, 16).unwrap();

        conn.execute(
            "INSERT INTO activity_days (date, active_seconds, idle_seconds, session_count, session_seconds)
             VALUES (?1, 3600, 600, 2, 3000), (?2, 7200, 300, 3, 5400), (?3, 1800, 0, 1, 1200)",
            params![
                wednesday.to_string(),
                tuesday.to_string(),
                last_monday.to_string()
            ],
        )
        .unwrap();

        let work_days = normalize_work_days(None);
        let stats = compute_productivity_stats_from_conn(&conn, wednesday, 8 * 60, 17 * 60, &work_days)
            .unwrap();

        assert_eq!(stats.active_seconds_today, 3600);
        assert_eq!(stats.idle_seconds_today, 600);
        assert_eq!(stats.sessions_today, 2);
        assert_eq!(stats.sessions_week, 5);
        assert_eq!(stats.session_seconds_week, 8400);
        assert_eq!(stats.active_seconds_week, 10800);
        assert_eq!(stats.active_seconds_last_week, 1800);
        assert_eq!(stats.week_delta_seconds, 9000);
        assert_eq!(stats.current_streak, 2);
        assert_eq!(stats.best_streak, 2);
        assert_eq!(stats.last_7_days.len(), 7);
    }
}
