//! Linux sleep/wake detection using systemd-logind D-Bus.
//!
//! This module subscribes to systemd-logind's PrepareForSleep signal
//! to detect when the system is about to sleep. This covers:
//! - Suspend (laptop lid close, manual suspend)
//! - Hibernate
//! - Hybrid sleep
//!
//! When sleep is detected, it emits a Tauri event to the frontend,
//! matching the behavior of the macOS sleep detection module.

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use zbus::Connection;

/// Event name emitted when the system is about to sleep (same as macOS).
pub const SYSTEM_SLEEP_EVENT: &str = "system-sleep";

/// Start observing Linux sleep events via systemd-logind D-Bus.
///
/// Connects to the system bus and subscribes to the PrepareForSleep signal
/// from org.freedesktop.login1.Manager. When the signal fires with `true`
/// (about to sleep), emits a "system-sleep" event to the frontend.
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
    let match_rule = "type='signal',\
sender='org.freedesktop.login1',\
interface='org.freedesktop.login1.Manager',\
member='PrepareForSleep'";

    connection
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus"),
            "AddMatch",
            &(match_rule,),
        )
        .await
        .map_err(|e| format!("Failed to add signal match rule: {}", e))?;

    // Spawn background task to listen for signals
    tokio::spawn(async move {
        let mut stream = zbus::MessageStream::from(&connection);

        while let Some(msg_result) = stream.next().await {
            if let Ok(msg) = msg_result {
                // Check if this is the PrepareForSleep signal
                // In zbus 5.x, we need to get the header to access member name
                let is_prepare_for_sleep = msg
                    .header()
                    .member()
                    .map(|m| m.as_str() == "PrepareForSleep")
                    .unwrap_or(false);

                if is_prepare_for_sleep {
                    // Deserialize the boolean argument
                    if let Ok(body) = msg.body().deserialize::<(bool,)>() {
                        let going_to_sleep = body.0;
                        if going_to_sleep {
                            println!(
                                "[resplendent] Linux system preparing for sleep - emitting system-sleep event"
                            );
                            if let Err(e) = app_handle.emit(SYSTEM_SLEEP_EVENT, ()) {
                                eprintln!("[resplendent] Failed to emit system-sleep event: {}", e);
                            }
                        } else {
                            println!("[resplendent] Linux system waking from sleep");
                        }
                    }
                }
            }
        }
    });

    println!("[resplendent] Linux sleep observer started successfully");
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
}
