//! Unified idle monitor interface.
//!
//! Provides a cross-platform function to get idle time in seconds,
//! abstracting over the platform-specific implementations.

use crate::idle;

/// Get the idle time in seconds.
///
/// This function provides a unified interface across all platforms.
/// On Linux, this is async due to DBus communication requirements.
/// On Windows and macOS, the underlying call is synchronous but wrapped
/// in an async function for API consistency.
///
/// # Returns
///
/// - `Ok(u64)` - The number of seconds since the last user input
/// - `Err(String)` - An error message if idle detection failed
///
/// # Platform Behavior
///
/// - **Windows**: Uses GetLastInputInfo (immediate)
/// - **macOS**: Uses IOKit HIDIdleTime (immediate)
/// - **Linux**: Tries GNOME DBus -> KDE DBus -> X11 XScreenSaver
#[cfg(target_os = "linux")]
pub async fn get_idle_time_secs() -> Result<u64, String> {
    idle::get_idle_time_secs().await
}

#[cfg(not(target_os = "linux"))]
pub async fn get_idle_time_secs() -> Result<u64, String> {
    // Wrap synchronous call in async for API consistency
    idle::get_idle_time_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_idle_time_secs() {
        // This test verifies the function doesn't panic
        // Actual idle time may not be available in all environments
        let result = get_idle_time_secs().await;
        
        // In a test environment, we just check it returns something
        // (either Ok with a value or an error message)
        match result {
            Ok(secs) => {
                // Sanity check: idle time should be less than a week
                assert!(secs < 604800, "Idle time seems unreasonably high");
            }
            Err(e) => {
                // In CI/headless environments, this is expected
                println!("Idle detection not available: {}", e);
            }
        }
    }
}
