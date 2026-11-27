//! Linux idle time detection with cached D-Bus connections and backend pinning.
//!
//! Attempts detection in order and pins the first working backend:
//! 1. GNOME Mutter IdleMonitor (DBus) - Wayland & X11
//! 2. KDE ScreenSaver (DBus) - Wayland & X11
//! 3. systemd-logind (DBus) - COSMIC, Sway, Hyprland, and other Wayland compositors
//! 4. X11 XScreenSaver fallback - X11 sessions

use std::env;
use std::sync::OnceLock;

use tokio::sync::OnceCell;
use zbus::Connection;

#[derive(Debug, Clone, Copy)]
enum LinuxIdleBackend {
    Gnome,
    Kde,
    Logind,
    X11,
}

static WORKING_BACKEND: OnceLock<LinuxIdleBackend> = OnceLock::new();
static SESSION_BUS: OnceCell<Connection> = OnceCell::const_new();
static SYSTEM_BUS: OnceCell<Connection> = OnceCell::const_new();

async fn session_bus() -> Result<&'static Connection, String> {
    SESSION_BUS
        .get_or_try_init(|| async {
            Connection::session()
                .await
                .map_err(|e| format!("DBus session connection failed: {}", e))
        })
        .await
}

async fn system_bus() -> Result<&'static Connection, String> {
    SYSTEM_BUS
        .get_or_try_init(|| async {
            Connection::system()
                .await
                .map_err(|e| format!("DBus system connection failed: {}", e))
        })
        .await
}

async fn query_backend(backend: LinuxIdleBackend) -> Result<u64, String> {
    match backend {
        LinuxIdleBackend::Gnome => get_gnome_idle_time().await,
        LinuxIdleBackend::Kde => get_kde_idle_time().await,
        LinuxIdleBackend::Logind => get_logind_idle_time().await,
        LinuxIdleBackend::X11 => get_x11_idle_time(),
    }
}

/// Get the idle time in seconds on Linux.
pub async fn get_idle_time_secs() -> Result<u64, String> {
    if let Some(&backend) = WORKING_BACKEND.get() {
        if let Ok(idle) = query_backend(backend).await {
            return Ok(idle);
        }
    }

    if let Ok(idle) = get_gnome_idle_time().await {
        let _ = WORKING_BACKEND.set(LinuxIdleBackend::Gnome);
        return Ok(idle);
    }

    if let Ok(idle) = get_kde_idle_time().await {
        let _ = WORKING_BACKEND.set(LinuxIdleBackend::Kde);
        return Ok(idle);
    }

    if let Ok(idle) = get_logind_idle_time().await {
        let _ = WORKING_BACKEND.set(LinuxIdleBackend::Logind);
        return Ok(idle);
    }

    if is_x11_session() {
        if let Ok(idle) = get_x11_idle_time() {
            let _ = WORKING_BACKEND.set(LinuxIdleBackend::X11);
            return Ok(idle);
        }
    }

    Err("No idle detection method available. Tried: GNOME DBus, KDE DBus, systemd-logind, X11 XScreenSaver".to_string())
}

fn is_x11_session() -> bool {
    if let Ok(session_type) = env::var("XDG_SESSION_TYPE") {
        return session_type == "x11";
    }
    env::var("DISPLAY").is_ok()
}

async fn get_gnome_idle_time() -> Result<u64, String> {
    let connection = session_bus().await?;

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

    let idle_ms: u64 = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Failed to deserialize GNOME response: {}", e))?;

    Ok(idle_ms / 1000)
}

async fn get_kde_idle_time() -> Result<u64, String> {
    let connection = session_bus().await?;

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

    let idle_ms: u32 = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Failed to deserialize KDE response: {}", e))?;

    Ok(idle_ms as u64 / 1000)
}

async fn get_logind_idle_time() -> Result<u64, String> {
    use zbus::zvariant::Value;

    let connection = system_bus().await?;

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

    let idle_hint_body = idle_hint_reply.body();
    let idle_hint_variant: Value = idle_hint_body
        .deserialize()
        .map_err(|e| format!("Failed to deserialize IdleHint: {}", e))?;

    let is_idle: bool = match idle_hint_variant {
        Value::Bool(b) => b,
        _ => return Err("IdleHint is not a boolean".to_string()),
    };

    if !is_idle {
        return Ok(0);
    }

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

    let idle_since_body = idle_since_reply.body();
    let idle_since_variant: Value = idle_since_body
        .deserialize()
        .map_err(|e| format!("Failed to deserialize IdleSinceHint: {}", e))?;

    let idle_since_usec: u64 = match idle_since_variant {
        Value::U64(t) => t,
        _ => return Err("IdleSinceHint is not a u64".to_string()),
    };

    if idle_since_usec == 0 {
        return Err("IdleSinceHint is 0 despite IdleHint being true".to_string());
    }

    let now_usec = get_monotonic_time_usec()?;
    let idle_usec = now_usec.saturating_sub(idle_since_usec);
    Ok(idle_usec / 1_000_000)
}

fn get_monotonic_time_usec() -> Result<u64, String> {
    use std::mem::MaybeUninit;

    let mut ts = MaybeUninit::<libc::timespec>::uninit();
    let ret = unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, ts.as_mut_ptr()) };

    if ret != 0 {
        return Err("clock_gettime failed".to_string());
    }

    let ts = unsafe { ts.assume_init() };
    let usec = (ts.tv_sec as u64) * 1_000_000 + (ts.tv_nsec as u64) / 1_000;
    Ok(usec)
}

fn get_x11_idle_time() -> Result<u64, String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::screensaver;
    use x11rb::rust_connection::RustConnection;

    let (conn, screen_num) =
        RustConnection::connect(None).map_err(|e| format!("X11 connection failed: {}", e))?;
    let screen = &conn.setup().roots[screen_num];
    let root = screen.root;

    let reply = screensaver::query_info(&conn, root)
        .map_err(|e| format!("XScreenSaver query failed: {}", e))?
        .reply()
        .map_err(|e| format!("XScreenSaver reply failed: {}", e))?;

    Ok(reply.ms_since_user_input as u64 / 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_is_x11_session() {
        let _ = is_x11_session();
    }

    #[tokio::test]
    async fn test_get_idle_time() {
        let result = get_idle_time_secs().await;
        if let Ok(idle) = result {
            assert!(idle < 86400);
        }
    }
}
