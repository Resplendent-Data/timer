//! Linux sleep/wake and shutdown detection using systemd-logind D-Bus.
//!
//! This module subscribes to systemd-logind's PrepareForSleep and
//! PrepareForShutdown signals to detect when the system is about to
//! sleep or shut down. This covers:
//! - Suspend (laptop lid close, manual suspend)
//! - Hibernate
//! - Hybrid sleep
//! - Shutdown / reboot
//!
//! When these events are detected, it emits Tauri events to the frontend,
//! matching the behavior of the macOS detection module.

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use zbus::Connection;

/// Event name emitted when the system is about to sleep (same as macOS).
pub const SYSTEM_SLEEP_EVENT: &str = "system-sleep";

/// Event name emitted when the system is about to shut down or reboot.
pub const SYSTEM_SHUTDOWN_EVENT: &str = "system-shutdown";

/// Start observing Linux sleep and shutdown events via systemd-logind D-Bus.
///
/// Connects to the system bus and subscribes to the PrepareForSleep and
/// PrepareForShutdown signals from org.freedesktop.login1.Manager.
/// - PrepareForSleep(true) emits `"system-sleep"` to the frontend
/// - PrepareForShutdown(true) emits `"system-shutdown"` to the frontend
///
/// # Arguments
///
/// * `app_handle` - The Tauri app handle used to emit events
///
/// # Note
///
/// This function spawns a background tokio task that listens for signals
/// indefinitely. The task will run for the lifetime of the application.
///
/// # Requirements
///
/// Requires systemd-logind to be running (standard on most modern Linux
/// distributions including Ubuntu, Fedora, Arch, etc.).
pub async fn start_sleep_observer(app_handle: AppHandle) -> Result<(), String> {
    // Connect to system bus (logind is on system bus, not session bus)
    let connection = Connection::system()
        .await
        .map_err(|e| format!("Failed to connect to system D-Bus: {}", e))?;

    // Add match rule for PrepareForSleep signal from logind
    // Signal: org.freedesktop.login1.Manager.PrepareForSleep(bool)
    // true = about to sleep, false = waking up
    let sleep_match_rule = "type='signal',\
sender='org.freedesktop.login1',\
interface='org.freedesktop.login1.Manager',\
member='PrepareForSleep'";

    connection
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus"),
            "AddMatch",
            &(sleep_match_rule,),
        )
        .await
        .map_err(|e| format!("Failed to add sleep signal match rule: {}", e))?;

    // Add match rule for PrepareForShutdown signal from logind
    // Signal: org.freedesktop.login1.Manager.PrepareForShutdown(bool)
    // true = about to shut down, false = shutdown cancelled
    let shutdown_match_rule = "type='signal',\
sender='org.freedesktop.login1',\
interface='org.freedesktop.login1.Manager',\
member='PrepareForShutdown'";

    connection
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus"),
            "AddMatch",
            &(shutdown_match_rule,),
        )
        .await
        .map_err(|e| format!("Failed to add shutdown signal match rule: {}", e))?;

    // Spawn background task to listen for signals
    tokio::spawn(async move {
        let mut stream = zbus::MessageStream::from(&connection);

        while let Some(msg_result) = stream.next().await {
            if let Ok(msg) = msg_result {
                // In zbus 5.x, we need to get the header to access member name
                let member_name = msg.header().member().map(|m| m.as_str().to_string());

                match member_name.as_deref() {
                    Some("PrepareForSleep") => {
                        if let Ok(body) = msg.body().deserialize::<(bool,)>() {
                            if body.0 {
                                println!(
                                    "[resplendent] Linux system preparing for sleep - emitting system-sleep event"
                                );
                                if let Err(e) = app_handle.emit(SYSTEM_SLEEP_EVENT, ()) {
                                    eprintln!(
                                        "[resplendent] Failed to emit system-sleep event: {}",
                                        e
                                    );
                                }
                            } else {
                                println!("[resplendent] Linux system waking from sleep");
                            }
                        }
                    }
                    Some("PrepareForShutdown") => {
                        if let Ok(body) = msg.body().deserialize::<(bool,)>() {
                            if body.0 {
                                println!(
                                    "[resplendent] Linux system preparing for shutdown - emitting system-shutdown event"
                                );
                                if let Err(e) = app_handle.emit(SYSTEM_SHUTDOWN_EVENT, ()) {
                                    eprintln!(
                                        "[resplendent] Failed to emit system-shutdown event: {}",
                                        e
                                    );
                                }
                            } else {
                                println!("[resplendent] Linux system shutdown cancelled");
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    });

    println!("[resplendent] Linux sleep/shutdown observer started successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_name_matches_macos() {
        // Ensure the event name is consistent with macOS
        assert_eq!(SYSTEM_SLEEP_EVENT, "system-sleep");
    }

    #[test]
    fn test_shutdown_event_name_matches_macos() {
        assert_eq!(SYSTEM_SHUTDOWN_EVENT, "system-shutdown");
    }
}
