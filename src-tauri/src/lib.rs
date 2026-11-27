//! Resplendent Timer - A Tauri application for time tracking with ClickUp integration.
//!
//! Monitors user idle and active-untracked time, provides 1-click timer start with
//! automatic backdating, and supports post-stop session wrap-up notes.

mod clickup;
mod github;
mod idle;
mod idle_monitor;
mod meeting_detection;
mod stats;
mod tracker;

use std::sync::Mutex;

use clickup::{
    IdleCheckResult, RunningTimerInfo, RuntimeSnapshot, StoppedTimeEntry, TaskSearchResult,
    TeamLeaderboardResponse, TimeEntrySummary, TimeEntryTag, UpdateTimeEntryPayload,
    WorkspaceConnectionInfo,
};
use meeting_detection::MeetingPresence;
use serde::Serialize;
use stats::{ProductivityStats, WorkProgressStats};
use tauri::{
    include_image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    Emitter, Manager,
};
use tracker::ActiveUntrackedSnapshot;

/// State to hold reference to the timer display menu item for dynamic updates.
struct TrayMenuState {
    timer_display: Mutex<MenuItem<tauri::Wry>>,
}

#[derive(Debug, Clone, Serialize)]
struct AppVisibilityChange {
    visible: bool,
    focused: bool,
}

/// Search for ClickUp tasks in a workspace.
#[tauri::command]
async fn search_tasks(
    api_key: String,
    team_id: String,
    query: String,
) -> Result<Vec<TaskSearchResult>, String> {
    clickup::search_tasks(api_key, team_id, query).await
}

/// Unified 1-click timer start (manual or task-linked) with optional active-time backdating.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn start_quick_timer(
    api_key: String,
    team_id: String,
    task_id: Option<String>,
    description: Option<String>,
    billable: Option<bool>,
    tags: Option<Vec<String>>,
    backdate_start_ms: Option<i64>,
    max_backdate_secs: Option<u64>,
) -> Result<RunningTimerInfo, String> {
    clickup::start_quick_timer(
        api_key,
        team_id,
        task_id,
        description,
        billable.unwrap_or(false),
        tags,
        backdate_start_ms,
        max_backdate_secs,
    )
    .await
}

/// Stop the running ClickUp timer, finalize any pending backdate, and return the stopped entry
/// metadata for the post-stop Session Wrap-Up flow.
#[tauri::command]
async fn stop_and_capture_timer(
    api_key: String,
    team_id: String,
) -> Result<StoppedTimeEntry, String> {
    clickup::stop_and_capture_timer(api_key, team_id).await
}

/// Update an existing ClickUp time entry (post-stop Wrap-Up description, task, tags, billable, start/end).
#[tauri::command]
async fn update_time_entry(
    api_key: String,
    team_id: String,
    entry_id: String,
    payload: UpdateTimeEntryPayload,
) -> Result<TimeEntrySummary, String> {
    clickup::update_time_entry(api_key, team_id, entry_id, payload).await
}

/// Fetch recent ClickUp time entries (default last 14 days) for resumable work history.
#[tauri::command]
async fn get_recent_time_entries(
    api_key: String,
    team_id: String,
    days: Option<i64>,
) -> Result<Vec<TimeEntrySummary>, String> {
    clickup::get_recent_time_entries(api_key, team_id, days).await
}

/// Fetch today's ClickUp time entries for the authenticated user.
#[tauri::command]
async fn get_today_time_entries(
    api_key: String,
    team_id: String,
) -> Result<Vec<TimeEntrySummary>, String> {
    clickup::get_today_time_entries(api_key, team_id).await
}

/// Validate ClickUp API credentials and workspace access.
#[tauri::command]
async fn test_clickup_connection(
    api_key: String,
    team_id: String,
) -> Result<WorkspaceConnectionInfo, String> {
    clickup::test_clickup_connection(api_key, team_id).await
}

/// Return current untracked continuous active-session snapshot (zero network).
#[tauri::command]
async fn get_active_untracked_state() -> Result<ActiveUntrackedSnapshot, String> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    if let Ok(idle_secs) = idle_monitor::get_idle_time_secs().await {
        tracker::observe_sample(now_ms, idle_secs);
    }
    Ok(tracker::get_snapshot(now_ms))
}

/// Reset the untracked active anchor (e.g., when dismissing an untracked session).
#[tauri::command]
fn reset_untracked_session() {
    let now_ms = chrono::Utc::now().timestamp_millis();
    tracker::reset_untracked_session(now_ms);
}

/// Trigger a 1-click start or stop-to-wrapup from the floating widget pill.
#[tauri::command]
async fn widget_toggle_timer(app: tauri::AppHandle, is_running: bool) -> Result<(), String> {
    if is_running {
        let _ = show_and_focus_main_window(&app);
        app.emit("menu-stop-timer", ()).map_err(|e| e.to_string())?;
    } else {
        app.emit("menu-quick-start", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Start a timer for a task (compatibility command).
#[tauri::command]
async fn start_timer(
    api_key: String,
    team_id: String,
    task_id: String,
    billable: Option<bool>,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    clickup::start_timer(api_key, team_id, task_id, billable.unwrap_or(false), tags).await
}

/// Stop the current timer (compatibility command).
#[tauri::command]
async fn stop_timer(api_key: String, team_id: String) -> Result<(), String> {
    clickup::stop_timer(api_key, team_id).await
}

/// Get all time entry tags for a workspace.
#[tauri::command]
async fn get_time_entry_tags(
    api_key: String,
    team_id: String,
) -> Result<Vec<TimeEntryTag>, String> {
    clickup::get_time_entry_tags(api_key, team_id).await
}

/// Start a manual timer without a linked task (compatibility command).
#[tauri::command]
async fn start_manual_timer(
    api_key: String,
    team_id: String,
    description: Option<String>,
    billable: Option<bool>,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    clickup::start_manual_timer(
        api_key,
        team_id,
        description,
        billable.unwrap_or(false),
        tags,
    )
    .await
}

/// Check idle time and stop ClickUp timer if needed.
#[tauri::command]
async fn check_and_stop_timer(
    api_key: String,
    team_id: String,
    idle_threshold_secs: Option<u64>,
) -> Result<IdleCheckResult, String> {
    let threshold = idle_threshold_secs.unwrap_or(600);
    clickup::check_and_stop_timer_impl(api_key, team_id, threshold).await
}

/// Get the current idle time in seconds.
#[tauri::command]
async fn get_idle_time() -> Result<u64, String> {
    idle_monitor::get_idle_time_secs().await
}

/// Get the currently running ClickUp timer name.
#[tauri::command]
async fn get_running_timer(api_key: String, team_id: String) -> Result<Option<String>, String> {
    clickup::get_running_timer(api_key, team_id).await
}

/// Debug command to test the ClickUp API and return raw response.
#[tauri::command]
async fn debug_clickup_api(api_key: String, team_id: String) -> Result<String, String> {
    clickup::debug_api_call(api_key, team_id).await
}

/// Get detailed info about the running timer including start time.
#[tauri::command]
async fn get_running_timer_info(
    api_key: String,
    team_id: String,
) -> Result<Option<RunningTimerInfo>, String> {
    clickup::get_running_timer_info(api_key, team_id).await
}

/// Fetch a single runtime snapshot for the background scheduler.
#[tauri::command]
async fn poll_runtime(
    api_key: String,
    team_id: String,
    idle_threshold_secs: Option<u64>,
) -> Result<RuntimeSnapshot, String> {
    clickup::poll_runtime_impl(api_key, team_id, idle_threshold_secs.unwrap_or(600)).await
}

/// Ensure the "rt" tag exists in the workspace.
#[tauri::command]
async fn ensure_rt_tag(api_key: String, team_id: String) -> Result<bool, String> {
    clickup::ensure_rt_tag_exists(api_key, team_id).await
}

/// Ensure the "meeting" tag exists in the workspace.
#[tauri::command]
async fn ensure_meeting_tag(api_key: String, team_id: String) -> Result<bool, String> {
    clickup::ensure_meeting_tag_exists(api_key, team_id).await
}

/// Get current meeting presence signal.
#[tauri::command]
fn get_meeting_presence() -> Result<MeetingPresence, String> {
    meeting_detection::get_meeting_presence()
}

/// Add the "rt" tag to an externally started running time entry.
#[tauri::command]
async fn add_rt_tag_to_time_entry(
    api_key: String,
    team_id: String,
    time_entry_id: String,
    existing_tags: Vec<TimeEntryTag>,
) -> Result<bool, String> {
    clickup::add_rt_tag_to_time_entry(api_key, team_id, time_entry_id, existing_tags).await
}

/// Update the tray menu timer display text.
#[tauri::command]
fn update_tray_timer_display(
    text: String,
    state: tauri::State<TrayMenuState>,
) -> Result<(), String> {
    state
        .timer_display
        .lock()
        .map_err(|e| e.to_string())?
        .set_text(&text)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
async fn send_notification_via_dbus(title: &str, body: &str) -> Result<(), String> {
    use std::collections::HashMap;
    use zbus::{
        zvariant::{OwnedValue, Str},
        Connection,
    };

    let connection = Connection::session()
        .await
        .map_err(|e| format!("Failed to connect to session D-Bus: {}", e))?;

    let mut hints: HashMap<&str, OwnedValue> = HashMap::new();
    hints.insert(
        "desktop-entry",
        OwnedValue::from(Str::from("com.resplendent.timer")),
    );

    let actions: Vec<&str> = Vec::new();
    let reply = connection
        .call_method(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            Some("org.freedesktop.Notifications"),
            "Notify",
            &(
                "Resplendent Timer",
                0u32,
                "resplendent-timer",
                title,
                body,
                actions,
                hints,
                5000i32,
            ),
        )
        .await
        .map_err(|e| format!("D-Bus Notify call failed: {}", e))?;

    let _notification_id: u32 = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Failed to deserialize Notify response: {}", e))?;

    Ok(())
}

#[cfg(target_os = "linux")]
fn send_notification_with_notify_send(title: &str, body: &str) -> Result<(), String> {
    use std::process::Command;

    let candidates = ["/usr/bin/notify-send", "notify-send"];
    let mut last_error: Option<String> = None;

    for candidate in candidates {
        let output = Command::new(candidate)
            .arg("--app-name=Resplendent Timer")
            .arg("--expire-time=5000")
            .arg(title)
            .arg(body)
            .output();

        match output {
            Ok(result) if result.status.success() => return Ok(()),
            Ok(result) => {
                let stderr = String::from_utf8_lossy(&result.stderr);
                let stdout = String::from_utf8_lossy(&result.stdout);
                last_error = Some(format!(
                    "{} exited with status {} (stderr: {}, stdout: {})",
                    candidate,
                    result.status,
                    stderr.trim(),
                    stdout.trim()
                ));
            }
            Err(error) => {
                last_error = Some(format!("Failed to execute {}: {}", candidate, error));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Failed to execute notify-send".to_string()))
}

/// Send a notification on Linux via D-Bus with notify-send fallback.
#[cfg(target_os = "linux")]
#[tauri::command]
async fn send_notification_linux(title: String, body: String) -> Result<(), String> {
    if let Err(dbus_error) = send_notification_via_dbus(&title, &body).await {
        eprintln!(
            "[resplendent] D-Bus notification failed, falling back to notify-send: {}",
            dbus_error
        );

        send_notification_with_notify_send(&title, &body).map_err(|notify_send_error| {
            format!(
                "Linux notification failed via D-Bus ({}) and notify-send ({})",
                dbus_error, notify_send_error
            )
        })?;
    }

    Ok(())
}

/// No-op on non-Linux platforms (they use the Tauri plugin).
#[cfg(not(target_os = "linux"))]
#[tauri::command]
async fn send_notification_linux(_title: String, _body: String) -> Result<(), String> {
    Err("send_notification_linux is only available on Linux".to_string())
}

/// Get productivity stats for the Insights screen.
#[tauri::command]
async fn get_productivity_stats(
    work_start_minutes: Option<i64>,
    work_end_minutes: Option<i64>,
    work_days: Option<Vec<i64>>,
) -> Result<ProductivityStats, String> {
    stats::get_productivity_stats(work_start_minutes, work_end_minutes, work_days)
        .map_err(|e| e.to_string())
}

/// Get lightweight work-progress totals for the Focus view.
#[tauri::command]
async fn get_work_progress_summary() -> Result<WorkProgressStats, String> {
    stats::get_work_progress_summary().map_err(|e| e.to_string())
}

/// Get ClickUp team leaderboard data for the Insights screen.
#[tauri::command]
async fn get_clickup_team_leaderboard(
    api_key: String,
    team_id: String,
) -> Result<TeamLeaderboardResponse, String> {
    clickup::get_clickup_team_leaderboard(api_key, team_id).await
}

/// Get GitHub PR counts for the authenticated user.
#[tauri::command]
async fn get_github_pr_counts(
    token: String,
    username: String,
) -> Result<github::PrCounts, String> {
    github::get_pr_counts(token, username).await
}

/// Record an activity heartbeat.
#[tauri::command]
fn record_heartbeat(is_idle: bool, duration_secs: i64) {
    stats::record_heartbeat(is_idle, duration_secs);
}

/// Record a completed ClickUp timer session.
#[tauri::command]
fn record_timer_session(duration_secs: i64) {
    stats::record_timer_session(duration_secs);
}

/// Record an idle-threshold interruption event.
#[tauri::command]
fn record_idle_event(
    started_at: i64,
    duration_secs: i64,
    timer_stopped: bool,
    task_name: Option<String>,
    task_id: Option<String>,
    session_duration_secs: i64,
) {
    stats::record_idle_event(
        started_at,
        duration_secs,
        timer_stopped,
        task_name,
        task_id,
        session_duration_secs,
    );
}

/// Create the always-on-top floating pill widget window.
#[tauri::command]
async fn create_widget_window(
    app: tauri::AppHandle,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<(), String> {
    if app.get_webview_window("widget").is_some() {
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        "widget",
        tauri::WebviewUrl::App("/widget.html".into()),
    )
    .title("Timer Widget")
    .inner_size(168.0, 40.0)
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .visible(true);

    if let (Some(px), Some(py)) = (x, y) {
        if (0..5000).contains(&px) && (0..2000).contains(&py) {
            builder = builder.position(px as f64, py as f64);
        }
    }

    let widget_window = builder.build().map_err(|e| e.to_string())?;

    if let Some(main_window) = app.get_webview_window("main") {
        if main_window.is_focused().unwrap_or(false) {
            let _ = widget_window.hide();
        }
    }

    Ok(())
}

/// Close the widget window.
#[tauri::command]
async fn close_widget_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(widget) = app.get_webview_window("widget") {
        widget.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn emit_app_visibility(
    app: &tauri::AppHandle,
    visible: bool,
    focused: bool,
) -> Result<(), String> {
    app.emit(
        "app-visibility-changed",
        AppVisibilityChange { visible, focused },
    )
    .map_err(|e| e.to_string())
}

fn show_and_focus_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        emit_app_visibility(app, true, true)?;
    }
    Ok(())
}

/// Show the main window and bring it to focus.
#[tauri::command]
async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    show_and_focus_main_window(&app)
}

/// Save the widget position (emitted back to frontend store).
#[tauri::command]
async fn save_widget_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    app.emit("save-widget-position", (x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            stats::init_database();

            // Start lightweight native OS idle sampler for accurate untracked active-time tracking.
            tracker::start_idle_sampler();

            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();
                if let Err(e) = idle::macos_sleep::start_sleep_observer(app_handle) {
                    eprintln!("Failed to start sleep observer: {}", e);
                }
            }

            #[cfg(target_os = "linux")]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = idle::linux_sleep::start_sleep_observer(app_handle).await {
                        eprintln!("Failed to start Linux sleep observer: {}", e);
                    }
                });
            }

            let timer_display = MenuItem::with_id(
                app,
                "timer_display",
                "No timer running",
                false,
                None::<&str>,
            )?;
            let start_item =
                MenuItem::with_id(app, "start_timer", "Start Timer", true, None::<&str>)?;
            let stop_item =
                MenuItem::with_id(app, "stop_timer", "End Session...", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Open Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &timer_display,
                    &PredefinedMenuItem::separator(app)?,
                    &start_item,
                    &stop_item,
                    &PredefinedMenuItem::separator(app)?,
                    &show_item,
                    &quit_item,
                ],
            )?;

            app.manage(TrayMenuState {
                timer_display: Mutex::new(timer_display),
            });

            let tray_icon = include_image!("icons/tray-icon.png");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        let _ = app.emit("app-quit-requested", ());
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                            handle.exit(0);
                        });
                    }
                    "show" => {
                        let _ = show_and_focus_main_window(app);
                    }
                    "start_timer" => {
                        let _ = app.emit("menu-quick-start", ());
                    }
                    "stop_timer" => {
                        let _ = show_and_focus_main_window(app);
                        let _ = app.emit("menu-stop-timer", ());
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window_clone.hide();
                        let _ = emit_app_visibility(&app_handle, false, false);
                    }
                    tauri::WindowEvent::Focused(focused) => {
                        if let Some(widget) = app_handle.get_webview_window("widget") {
                            if *focused {
                                let _ = widget.hide();
                            } else {
                                let _ = widget.show();
                            }
                        }
                        let visible = window_clone.is_visible().unwrap_or(!*focused);
                        let _ = emit_app_visibility(&app_handle, visible, *focused);
                    }
                    _ => {}
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_and_stop_timer,
            get_idle_time,
            get_running_timer,
            get_running_timer_info,
            poll_runtime,
            debug_clickup_api,
            search_tasks,
            start_quick_timer,
            stop_and_capture_timer,
            update_time_entry,
            get_recent_time_entries,
            get_today_time_entries,
            test_clickup_connection,
            get_active_untracked_state,
            reset_untracked_session,
            widget_toggle_timer,
            start_timer,
            stop_timer,
            get_time_entry_tags,
            start_manual_timer,
            update_tray_timer_display,
            send_notification_linux,
            get_productivity_stats,
            get_work_progress_summary,
            get_clickup_team_leaderboard,
            get_github_pr_counts,
            record_heartbeat,
            record_timer_session,
            record_idle_event,
            create_widget_window,
            close_widget_window,
            show_main_window,
            save_widget_position,
            ensure_rt_tag,
            ensure_meeting_tag,
            add_rt_tag_to_time_entry,
            get_meeting_presence,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
