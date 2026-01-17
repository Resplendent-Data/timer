//! Resplendent Timer - A Tauri application for time tracking with ClickUp integration.
//!
//! This application monitors user idle time and automatically stops ClickUp timers
//! when the user has been inactive for a configurable period.

mod clickup;
mod idle;
mod idle_monitor;

use clickup::{IdleCheckResult, RunningTimerInfo};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Create system tray menu
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // Build the system tray
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
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
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
