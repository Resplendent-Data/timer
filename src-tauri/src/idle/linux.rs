//! Linux idle time detection with waterfall strategy.
//!
//! Attempts detection in order:
//! 1. GNOME Mutter IdleMonitor (DBus) - works on Wayland & X11
//! 2. KDE ScreenSaver (DBus) - works on Wayland & X11
//! 3. systemd-logind (DBus) - works on COSMIC, Sway, Hyprland, and other Wayland compositors
//! 4. X11 XScreenSaver fallback - only works on X11 sessions

use std::env;

/// Get the idle time in seconds on Linux.
///
/// Uses a waterfall strategy to try multiple methods:
/// 1. GNOME Mutter IdleMonitor via DBus
/// 2. KDE ScreenSaver via DBus
/// 3. systemd-logind via DBus (works on COSMIC, Sway, Hyprland, etc.)
/// 4. X11 XScreenSaver as fallback
pub async fn get_idle_time_secs() -> Result<u64, String> {
    // Try GNOME first (works on both Wayland and X11)
    if let Ok(idle) = get_gnome_idle_time().await {
        return Ok(idle);
    }

    // Try KDE (works on both Wayland and X11)
    if let Ok(idle) = get_kde_idle_time().await {
        return Ok(idle);
    }

    // Try systemd-logind (works on COSMIC, Sway, Hyprland, and other Wayland compositors)
    if let Ok(idle) = get_logind_idle_time().await {
        return Ok(idle);
    }

    // Check if we're on X11 for XScreenSaver fallback
    if is_x11_session() {
        if let Ok(idle) = get_x11_idle_time() {
            return Ok(idle);
        }
    }

    Err("No idle detection method available. Tried: GNOME DBus, KDE DBus, systemd-logind, X11 XScreenSaver".to_string())
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

/// Query systemd-logind via DBus for idle time.
///
/// Works on any systemd-based system where the desktop environment reports
/// idle status to logind. This includes COSMIC, Sway (with swayidle), Hyprland,
/// and other modern Wayland compositors that integrate with systemd.
///
/// Uses the session's IdleHint and IdleSinceHint properties.
///
/// # Note
///
/// This method only works if the desktop environment/compositor reports idle
/// status to logind. Some compositors (like vanilla Sway without swayidle)
/// may not report idle status, in which case this will always return 0.
async fn get_logind_idle_time() -> Result<u64, String> {
    use zbus::zvariant::Value;
    use zbus::Connection;

    let connection = Connection::system()
        .await
        .map_err(|e| format!("DBus system connection failed: {}", e))?;

    // First check if the session is idle (IdleHint)
    let idle_hint_reply = connection
        .call_method(
            Some("org.freedesktop.login1"),
            "/org/freedesktop/login1/session/self",
            Some("org.freedesktop.DBus.Properties"),
            "Get",
            &("org.freedesktop.login1.Session", "IdleHint"),
        )
        .await
        .map_err(|e| format!("logind IdleHint query failed: {}", e))?;

    let idle_hint_variant: Value = idle_hint_reply
        .body()
        .deserialize()
        .map_err(|e| format!("Failed to deserialize IdleHint: {}", e))?;

    let is_idle: bool = match idle_hint_variant {
        Value::Bool(b) => b,
        _ => return Err("IdleHint is not a boolean".to_string()),
    };

    // If not idle, return 0
    if !is_idle {
        return Ok(0);
    }

    // Get the timestamp when idle started (IdleSinceHint)
    // This is a monotonic timestamp in microseconds
    let idle_since_reply = connection
        .call_method(
            Some("org.freedesktop.login1"),
            "/org/freedesktop/login1/session/self",
            Some("org.freedesktop.DBus.Properties"),
            "Get",
            &("org.freedesktop.login1.Session", "IdleSinceHint"),
        )
        .await
        .map_err(|e| format!("logind IdleSinceHint query failed: {}", e))?;

    let idle_since_variant: Value = idle_since_reply
        .body()
        .deserialize()
        .map_err(|e| format!("Failed to deserialize IdleSinceHint: {}", e))?;

    let idle_since_usec: u64 = match idle_since_variant {
        Value::U64(t) => t,
        _ => return Err("IdleSinceHint is not a u64".to_string()),
    };

    // Edge case: if IdleSinceHint is 0 but IdleHint is true, something is wrong
    // with the session state. Return an error to fall through to X11.
    if idle_since_usec == 0 {
        return Err("IdleSinceHint is 0 despite IdleHint being true".to_string());
    }

    // IdleSinceHint is a monotonic timestamp. We need to get the current
    // monotonic time to calculate the idle duration.
    // We use libc::clock_gettime for CLOCK_MONOTONIC
    let now_usec = get_monotonic_time_usec()?;

    // Calculate idle duration in seconds
    let idle_usec = now_usec.saturating_sub(idle_since_usec);
    Ok(idle_usec / 1_000_000)
}

/// Get the current monotonic time in microseconds.
fn get_monotonic_time_usec() -> Result<u64, String> {
    use std::mem::MaybeUninit;

    let mut ts = MaybeUninit::<libc::timespec>::uninit();
    
    // SAFETY: We're passing a valid pointer to an uninitialized timespec,
    // and clock_gettime will initialize it if successful.
    let ret = unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, ts.as_mut_ptr()) };
    
    if ret != 0 {
        return Err("clock_gettime failed".to_string());
    }

    // SAFETY: clock_gettime succeeded, so ts is now initialized
    let ts = unsafe { ts.assume_init() };
    
    // Convert to microseconds
    let usec = (ts.tv_sec as u64) * 1_000_000 + (ts.tv_nsec as u64) / 1_000;
    Ok(usec)
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
