//! Cross-platform idle time detection module.
//!
//! This module provides platform-specific implementations for detecting
//! user idle time (time since last keyboard/mouse input).
//!
//! ## Platform Support
//!
//! - **Windows**: Uses Win32 `GetLastInputInfo` API
//! - **macOS**: Uses IOKit `HIDIdleTime` property
//! - **Linux**: Uses a waterfall strategy:
//!   1. GNOME Mutter IdleMonitor (DBus) - Wayland & X11
//!   2. KDE ScreenSaver (DBus) - Wayland & X11
//!   3. X11 XScreenSaver fallback

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "linux")]
pub mod linux;

// Re-export the platform-specific implementation
#[cfg(target_os = "windows")]
pub use self::windows::get_idle_time_secs;

#[cfg(target_os = "macos")]
pub use self::macos::get_idle_time_secs;

#[cfg(target_os = "linux")]
pub use self::linux::get_idle_time_secs;
