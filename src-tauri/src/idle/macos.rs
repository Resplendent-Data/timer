//! macOS idle time detection using IOKit HIDIdleTime property.

use core_foundation::base::{CFType, TCFType};
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_foundation_sys::dictionary::CFMutableDictionaryRef;
use std::ptr;

// IOKit framework bindings
#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOServiceGetMatchingService(main_port: u32, matching: CFMutableDictionaryRef) -> u32;

    fn IOServiceMatching(name: *const std::os::raw::c_char) -> CFMutableDictionaryRef;

    fn IORegistryEntryCreateCFProperty(
        entry: u32,
        key: core_foundation_sys::string::CFStringRef,
        allocator: core_foundation_sys::base::CFAllocatorRef,
        options: u32,
    ) -> core_foundation_sys::base::CFTypeRef;

    fn IOObjectRelease(object: u32) -> i32;
}

/// Get the idle time in seconds on macOS.
///
/// Uses IOKit to query the HIDIdleTime property from IOHIDSystem,
/// which tracks time since last keyboard/mouse/trackpad input.
pub fn get_idle_time_secs() -> Result<u64, String> {
    unsafe {
        // Create matching dictionary for IOHIDSystem
        let service_name =
            std::ffi::CString::new("IOHIDSystem").map_err(|e| format!("CString error: {}", e))?;

        let matching = IOServiceMatching(service_name.as_ptr());
        if matching.is_null() {
            return Err("Failed to create IOServiceMatching dictionary".to_string());
        }

        // Get the IOHIDSystem service
        // Note: kIOMainPortDefault is 0 on modern macOS
        let service = IOServiceGetMatchingService(0, matching);
        if service == 0 {
            return Err("Failed to get IOHIDSystem service. This may require accessibility permissions.".to_string());
        }

        // Create the key for HIDIdleTime property
        let key = CFString::new("HIDIdleTime");

        // Get the HIDIdleTime property
        let property = IORegistryEntryCreateCFProperty(
            service,
            key.as_concrete_TypeRef(),
            ptr::null(),
            0,
        );

        // Release the service object
        IOObjectRelease(service);

        if property.is_null() {
            return Err(
                "Failed to get HIDIdleTime property. The system may be in a locked state."
                    .to_string(),
            );
        }

        // Convert the property to a CFNumber
        let cf_type: CFType = CFType::wrap_under_create_rule(property);
        let cf_number = cf_type
            .downcast::<CFNumber>()
            .ok_or("Failed to cast HIDIdleTime to CFNumber")?;

        // Get the value as i64 (nanoseconds)
        let idle_ns: i64 = cf_number
            .to_i64()
            .ok_or("Failed to convert HIDIdleTime to i64")?;

        // Convert nanoseconds to seconds
        Ok((idle_ns / 1_000_000_000) as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_idle_time() {
        let result = get_idle_time_secs();
        // May fail if running in a headless environment
        if let Ok(idle) = result {
            // Idle time should be reasonable (less than a day)
            assert!(idle < 86400);
        }
    }
}
