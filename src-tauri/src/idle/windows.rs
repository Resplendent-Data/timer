//! Windows idle time detection using Win32 GetLastInputInfo API.

use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

/// Get the idle time in seconds on Windows.
///
/// Uses the Win32 GetLastInputInfo API to determine how long since
/// the last keyboard or mouse input event.
pub fn get_idle_time_secs() -> Result<u64, String> {
    unsafe {
        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };

        if GetLastInputInfo(&mut lii).is_ok() {
            let current_tick = GetTickCount();
            // Handle tick count wraparound (happens every ~49 days)
            let idle_ms = current_tick.wrapping_sub(lii.dwTime);
            Ok((idle_ms / 1000) as u64)
        } else {
            Err("Failed to get last input info from Windows API".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_idle_time() {
        // Should return a valid result
        let result = get_idle_time_secs();
        assert!(result.is_ok());
        // Idle time should be reasonable (less than a day for testing)
        assert!(result.unwrap() < 86400);
    }
}
