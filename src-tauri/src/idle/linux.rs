//! Linux idle time detection with waterfall strategy.
//!
//! Attempts detection in order:
//! 1. GNOME Mutter IdleMonitor (DBus) - works on Wayland & X11
//! 2. KDE ScreenSaver (DBus) - works on Wayland & X11
//! 3. X11 XScreenSaver fallback - only works on X11 sessions

use std::env;

/// Get the idle time in seconds on Linux.
///
/// Uses a waterfall strategy to try multiple methods:
/// 1. GNOME Mutter IdleMonitor via DBus
/// 2. KDE ScreenSaver via DBus
/// 3. X11 XScreenSaver as fallback
pub async fn get_idle_time_secs() -> Result<u64, String> {
    // Try GNOME first (works on both Wayland and X11)
    if let Ok(idle) = get_gnome_idle_time().await {
        return Ok(idle);
    }

    // Try KDE (works on both Wayland and X11)
    if let Ok(idle) = get_kde_idle_time().await {
        return Ok(idle);
    }

    // Check if we're on X11 for XScreenSaver fallback
    if is_x11_session() {
        if let Ok(idle) = get_x11_idle_time() {
            return Ok(idle);
        }
    }

    Err("No idle detection method available. Tried: GNOME DBus, KDE DBus, X11 XScreenSaver".to_string())
}

/// Check if we're running in an X11 session
fn is_x11_session() -> bool {
    // Check XDG_SESSION_TYPE first (most reliable on modern systems)
    if let Ok(session_type) = env::var("XDG_SESSION_TYPE") {
        return session_type == "x11";
    }
    
    // Fallback: check if DISPLAY is set (indicates X11 is available)
    env::var("DISPLAY").is_ok()
}

/// Query GNOME Mutter IdleMonitor via DBus.
///
/// Works on GNOME desktop environments (both Wayland and X11).
/// DBus path: org.gnome.Mutter.IdleMonitor at /org/gnome/Mutter/IdleMonitor/Core
async fn get_gnome_idle_time() -> Result<u64, String> {
    use zbus::Connection;

    let connection = Connection::session()
        .await
        .map_err(|e| format!("DBus session connection failed: {}", e))?;

    let reply = connection
        .call_method(
            Some("org.gnome.Mutter.IdleMonitor"),
            "/org/gnome/Mutter/IdleMonitor/Core",
            Some("org.gnome.Mutter.IdleMonitor"),
            "GetIdletime",
            &(),
        )
        .await
        .map_err(|e| format!("GNOME Mutter IdleMonitor call failed: {}", e))?;

    // GetIdletime returns milliseconds as u64
    let idle_ms: u64 = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Failed to deserialize GNOME response: {}", e))?;

    Ok(idle_ms / 1000)
}

/// Query KDE ScreenSaver via DBus.
///
/// Works on KDE Plasma desktop environments (both Wayland and X11).
/// DBus path: org.freedesktop.ScreenSaver at /org/freedesktop/ScreenSaver
async fn get_kde_idle_time() -> Result<u64, String> {
    use zbus::Connection;

    let connection = Connection::session()
        .await
        .map_err(|e| format!("DBus session connection failed: {}", e))?;

    let reply = connection
        .call_method(
            Some("org.freedesktop.ScreenSaver"),
            "/org/freedesktop/ScreenSaver",
            Some("org.freedesktop.ScreenSaver"),
            "GetSessionIdleTime",
            &(),
        )
        .await
        .map_err(|e| format!("KDE ScreenSaver call failed: {}", e))?;

    // GetSessionIdleTime returns milliseconds as u32
    let idle_ms: u32 = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Failed to deserialize KDE response: {}", e))?;

    Ok(idle_ms as u64 / 1000)
}

/// Query X11 XScreenSaver for idle time.
///
/// Only works on X11 sessions, will fail on pure Wayland.
/// Uses the XScreenSaver extension to query idle time.
fn get_x11_idle_time() -> Result<u64, String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::screensaver;
    use x11rb::rust_connection::RustConnection;

    // Connect to X11 display
    let (conn, screen_num) = RustConnection::connect(None)
        .map_err(|e| format!("X11 connection failed: {}", e))?;

    // Get the root window of the default screen
    let screen = &conn.setup().roots[screen_num];
    let root = screen.root;

    // Query XScreenSaver extension for idle info
    let reply = screensaver::query_info(&conn, root)
        .map_err(|e| format!("XScreenSaver query failed: {}", e))?
        .reply()
        .map_err(|e| format!("XScreenSaver reply failed: {}", e))?;

    // ms_since_user_input is in milliseconds
    Ok(reply.ms_since_user_input as u64 / 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_is_x11_session() {
        // This just tests that the function doesn't panic
        let _ = is_x11_session();
    }

    #[tokio::test]
    async fn test_get_idle_time() {
        // This may fail in CI environments without a display
        let result = get_idle_time_secs().await;
        if let Ok(idle) = result {
            // Idle time should be reasonable
            assert!(idle < 86400);
        }
    }
}
