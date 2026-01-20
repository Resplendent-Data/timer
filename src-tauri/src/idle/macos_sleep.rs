//! macOS sleep/wake detection using NSWorkspace notifications.
//!
//! This module subscribes to macOS power events to detect when the system
//! or display goes to sleep (lid close, display sleep, system sleep).
//! When sleep is detected, it emits a Tauri event to the frontend.

use block2::RcBlock;
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceScreensDidSleepNotification, NSWorkspaceWillSleepNotification,
};
use objc2_foundation::NSNotification;
use std::ptr::NonNull;
use tauri::{AppHandle, Emitter};

/// Event name emitted when the system is about to sleep.
pub const SYSTEM_SLEEP_EVENT: &str = "system-sleep";

/// Start observing macOS sleep notifications.
///
/// This function subscribes to:
/// - `NSWorkspaceScreensDidSleepNotification`: Fires when displays sleep (includes lid close)
/// - `NSWorkspaceWillSleepNotification`: Fires when the system is about to sleep
///
/// When either notification is received, a `"system-sleep"` event is emitted
/// to the Tauri frontend.
///
/// # Arguments
///
/// * `app_handle` - The Tauri app handle used to emit events
///
/// # Note
///
/// The observer tokens are intentionally leaked (via `std::mem::forget`) to keep
/// them alive for the lifetime of the application. This is the standard pattern
/// for app-lifetime observers in macOS.
///
/// # Safety
///
/// This function uses unsafe Objective-C runtime calls but is safe to call
/// from Rust as long as it's called from the main thread (which Tauri's
/// setup hook guarantees).
pub fn start_sleep_observer(app_handle: AppHandle) -> Result<(), String> {
    // Get the shared workspace and its notification center
    let workspace = NSWorkspace::sharedWorkspace();
    let notification_center = workspace.notificationCenter();

    // Clone app_handle for each closure
    let app_handle_screens = app_handle.clone();
    let app_handle_system = app_handle;

    // Create block for screen sleep (lid close, display sleep)
    let screen_sleep_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        println!("[resplendent] macOS screens did sleep - emitting system-sleep event");
        if let Err(e) = app_handle_screens.emit(SYSTEM_SLEEP_EVENT, ()) {
            eprintln!("[resplendent] Failed to emit system-sleep event: {}", e);
        }
    });

    // Create block for system sleep
    let system_sleep_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        println!("[resplendent] macOS system will sleep - emitting system-sleep event");
        if let Err(e) = app_handle_system.emit(SYSTEM_SLEEP_EVENT, ()) {
            eprintln!("[resplendent] Failed to emit system-sleep event: {}", e);
        }
    });

    // Subscribe to screen sleep notification
    let screen_observer = unsafe {
        notification_center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceScreensDidSleepNotification),
            None,
            None,
            &screen_sleep_block,
        )
    };

    // Subscribe to system sleep notification
    let system_observer = unsafe {
        notification_center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceWillSleepNotification),
            None,
            None,
            &system_sleep_block,
        )
    };

    // Leak the observers to keep them alive for the app lifetime.
    // This is intentional - we want these observers to persist.
    std::mem::forget(screen_observer);
    std::mem::forget(system_observer);

    println!("[resplendent] macOS sleep observer started successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    // Note: These tests are limited because they require a running app
    // and macOS notification system. Integration testing is manual.

    #[test]
    fn test_event_name() {
        assert_eq!(super::SYSTEM_SLEEP_EVENT, "system-sleep");
    }
}
