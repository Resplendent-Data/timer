//! Resplendent Timer - A Tauri application for time tracking with ClickUp integration.
//!
//! This application monitors user idle time and automatically stops ClickUp timers
//! when the user has been inactive for a configurable period.

mod clickup;
mod idle;
mod idle_monitor;
mod stats;

use std::sync::Mutex;

use clickup::{IdleCheckResult, RunningTimerInfo, TaskSearchResult};
use stats::ProductivityStats;
use tauri::{
    include_image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

/// State to hold reference to the timer display menu item for dynamic updates.
struct TrayMenuState {
    timer_display: Mutex<MenuItem<tauri::Wry>>,
}

/// Tauri command to search for tasks.
#[tauri::command]
async fn search_tasks(
    api_key: String,
    team_id: String,
    query: String,
) -> Result<Vec<TaskSearchResult>, String> {
    clickup::search_tasks(api_key, team_id, query).await
}

/// Tauri command to start a timer for a task.
#[tauri::command]
async fn start_timer(
    api_key: String,
    team_id: String,
    task_id: String,
) -> Result<(), String> {
    clickup::start_timer(api_key, team_id, task_id).await
}

/// Tauri command to stop the current timer.
#[tauri::command]
async fn stop_timer(api_key: String, team_id: String) -> Result<(), String> {
    clickup::stop_timer(api_key, team_id).await
}

/// Tauri command to check idle time and stop ClickUp timer if needed.
///
/// # Arguments
///
/// * `api_key` - ClickUp API key
/// * `team_id` - ClickUp team/workspace ID
/// * `idle_threshold_secs` - Seconds of inactivity before stopping timer (default: 600)
#[tauri::command]
async fn check_and_stop_timer(
    api_key: String,
    team_id: String,
    idle_threshold_secs: Option<u64>,
) -> Result<IdleCheckResult, String> {
    let threshold = idle_threshold_secs.unwrap_or(600); // Default 10 minutes
    clickup::check_and_stop_timer_impl(api_key, team_id, threshold).await
}

/// Tauri command to get the current idle time in seconds.
#[tauri::command]
async fn get_idle_time() -> Result<u64, String> {
    idle_monitor::get_idle_time_secs().await
}

/// Tauri command to get the currently running ClickUp timer.
///
/// # Arguments
///
/// * `api_key` - ClickUp API key
/// * `team_id` - ClickUp team/workspace ID
///
/// # Returns
///
/// The name of the currently running task, or null if no timer is running.
#[tauri::command]
async fn get_running_timer(api_key: String, team_id: String) -> Result<Option<String>, String> {
    clickup::get_running_timer(api_key, team_id).await
}

/// Debug command to test the ClickUp API and return raw response
#[tauri::command]
async fn debug_clickup_api(api_key: String, team_id: String) -> Result<String, String> {
    clickup::debug_api_call(api_key, team_id).await
}

/// Tauri command to get detailed info about the running timer including start time.
///
/// # Arguments
///
/// * `api_key` - ClickUp API key
/// * `team_id` - ClickUp team/workspace ID
///
/// # Returns
///
/// Info about the running timer (name and start time), or null if no timer is running.
#[tauri::command]
async fn get_running_timer_info(
    api_key: String,
    team_id: String,
) -> Result<Option<RunningTimerInfo>, String> {
    clickup::get_running_timer_info(api_key, team_id).await
}

/// Tauri command to update the tray menu timer display text.
///
/// # Arguments
///
/// * `text` - The text to display (e.g., "Task Name - 1:23:45" or "No timer running")
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

/// Send a notification using notify-send (Linux only).
///
/// This is a workaround for GNOME 46+ where the Tauri notification plugin
/// doesn't work due to DBus connection lifecycle issues.
///
/// # Arguments
///
/// * `title` - Notification title
/// * `body` - Notification body text
#[cfg(target_os = "linux")]
#[tauri::command]
async fn send_notification_linux(title: String, body: String) -> Result<(), String> {
    use std::process::Command;

    Command::new("notify-send")
        .arg("--app-name=Resplendent Timer")
        .arg(&title)
        .arg(&body)
        .spawn()
        .map_err(|e| format!("Failed to send notification: {}", e))?;

    Ok(())
}

/// No-op on non-Linux platforms (they use the Tauri plugin).
#[cfg(not(target_os = "linux"))]
#[tauri::command]
async fn send_notification_linux(_title: String, _body: String) -> Result<(), String> {
    // On non-Linux, this command should not be called - use the Tauri plugin instead
    Err("send_notification_linux is only available on Linux".to_string())
}

#[tauri::command]
async fn get_productivity_stats() -> Result<ProductivityStats, String> {
    stats::get_productivity_stats().map_err(|e| e.to_string())
}

#[tauri::command]
fn record_idle_event(
    started_at: i64,
    duration_secs: i64,
    timer_stopped: bool,
    task_name: Option<String>,
    task_id: Option<String>,
) {
    stats::record_idle_event(started_at, duration_secs, timer_stopped, task_name, task_id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Initialize the updater plugin (desktop only)
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            stats::init_database();

            // Create system tray menu items
            let timer_display =
                MenuItem::with_id(app, "timer_display", "No timer running", false, None::<&str>)?;
            let start_item =
                MenuItem::with_id(app, "start_timer", "Start Timer...", true, None::<&str>)?;
            let stop_item =
                MenuItem::with_id(app, "stop_timer", "Stop Timer", true, None::<&str>)?;
            let show_item =
                MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            // Build menu with separators
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

            // Store timer_display reference for dynamic updates
            app.manage(TrayMenuState {
                timer_display: Mutex::new(timer_display),
            });

            // Load the transparent tray icon (embedded at compile time)
            let tray_icon = include_image!("icons/tray-icon.png");

            // Build the system tray
            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "start_timer" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("menu-start-timer", ());
                    }
                    "stop_timer" => {
                        let _ = app.emit("menu-stop-timer", ());
                    }
                    _ => {}
                })
                .build(app)?;

            // Handle window close - minimize to tray instead of quitting
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Prevent the window from closing
                        api.prevent_close();
                        // Hide the window instead
                        let _ = window_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_and_stop_timer,
            get_idle_time,
            get_running_timer,
            get_running_timer_info,
            debug_clickup_api,
            search_tasks,
            start_timer,
            stop_timer,
            update_tray_timer_display,
            send_notification_linux,
            get_productivity_stats,
            record_idle_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
