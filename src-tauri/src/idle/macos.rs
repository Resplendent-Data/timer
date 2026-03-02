//! macOS idle time detection using IOKit HIDIdleTime property.

use std::ffi::c_void;
use std::ptr;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use core_foundation::base::{CFType, TCFType};
use core_foundation::data::CFData;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_foundation_sys::base::{CFRelease, CFTypeRef};
use core_foundation_sys::dictionary::CFMutableDictionaryRef;

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

// Quartz fallback for cases where IOKit idle query fails.
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: u32, event_type: u32) -> f64;
    fn CGEventCreate(source: *const c_void) -> CFTypeRef;
    fn CGEventGetLocation(event: CFTypeRef) -> CGPoint;
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

struct MouseTrackerState {
    last_position: CGPoint,
    last_moved_at: Instant,
}

static MOUSE_TRACKER: OnceLock<Mutex<MouseTrackerState>> = OnceLock::new();

const KCG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: u32 = 1;
const KCG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
const KCG_EVENT_LEFT_MOUSE_UP: u32 = 2;
const KCG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
const KCG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
const KCG_EVENT_KEY_DOWN: u32 = 10;
const KCG_EVENT_KEY_UP: u32 = 11;
const KCG_EVENT_FLAGS_CHANGED: u32 = 12;
const KCG_EVENT_SCROLL_WHEEL: u32 = 22;
const KCG_EVENT_OTHER_MOUSE_DOWN: u32 = 25;
const KCG_EVENT_OTHER_MOUSE_UP: u32 = 26;

/// Get the idle time in seconds on macOS.
///
/// Uses IOKit to query the HIDIdleTime property from IOHIDSystem,
/// which tracks time since last keyboard/mouse/trackpad input.
pub fn get_idle_time_secs() -> Result<u64, String> {
    match get_idle_time_secs_quartz() {
        Ok(secs) => Ok(secs),
        Err(quartz_err) => {
            let iokit_secs = get_idle_time_secs_iokit().map_err(|iokit_err| {
                format!(
                    "Idle detection failed via Quartz and IOKit. Quartz: {}. IOKit: {}",
                    quartz_err, iokit_err
                )
            })?;
            Ok(iokit_secs)
        }
    }
}

/// Get idle time via IOKit's IOHIDSystem HIDIdleTime property.
fn get_idle_time_secs_iokit() -> Result<u64, String> {
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
            return Err(
                "Failed to get IOHIDSystem service. This may require accessibility permissions."
                    .to_string(),
            );
        }

        // Create the key for HIDIdleTime property
        let key = CFString::new("HIDIdleTime");

        // Get the HIDIdleTime property
        let property =
            IORegistryEntryCreateCFProperty(service, key.as_concrete_TypeRef(), ptr::null(), 0);

        // Release the service object
        IOObjectRelease(service);

        if property.is_null() {
            return Err(
                "Failed to get HIDIdleTime property. The system may be in a locked state."
                    .to_string(),
            );
        }

        // Parse HIDIdleTime from its Core Foundation representation.
        let cf_type: CFType = CFType::wrap_under_create_rule(property);
        let idle_ns = parse_idle_time_ns(&cf_type)?;

        Ok(idle_ns / 1_000_000_000)
    }
}

/// Parse HIDIdleTime as nanoseconds from known Core Foundation types.
///
/// On some macOS versions this value is a CFNumber, and on others it may be a CFData
/// containing a native-endian 64-bit integer.
fn parse_idle_time_ns(cf_type: &CFType) -> Result<u64, String> {
    if let Some(cf_number) = cf_type.downcast::<CFNumber>() {
        let idle_ns: i64 = cf_number
            .to_i64()
            .ok_or("Failed to convert HIDIdleTime CFNumber to i64")?;

        if idle_ns < 0 {
            return Err(format!("HIDIdleTime CFNumber was negative: {}", idle_ns));
        }

        return Ok(idle_ns as u64);
    }

    if let Some(cf_data) = cf_type.downcast::<CFData>() {
        let bytes = cf_data.bytes();
        if bytes.len() < std::mem::size_of::<u64>() {
            return Err(format!(
                "HIDIdleTime CFData too short: expected at least {} bytes, got {}",
                std::mem::size_of::<u64>(),
                bytes.len()
            ));
        }

        let mut idle_bytes = [0u8; std::mem::size_of::<u64>()];
        idle_bytes.copy_from_slice(&bytes[..std::mem::size_of::<u64>()]);
        return Ok(u64::from_ne_bytes(idle_bytes));
    }

    Err(format!(
        "Unsupported HIDIdleTime Core Foundation type id: {}",
        cf_type.type_of()
    ))
}

/// Get idle time via Quartz event timings as the primary source.
///
/// This avoids `kCGAnyInputEventType`, which can be noisy on newer macOS builds.
/// Instead, it combines:
/// - keyboard signals (key down/up/modifier changes),
/// - click/scroll signals,
/// - and cursor-position movement.
fn get_idle_time_secs_quartz() -> Result<u64, String> {
    let key_down_secs = seconds_since_event_type(KCG_EVENT_KEY_DOWN)?;
    let key_up_secs = seconds_since_event_type(KCG_EVENT_KEY_UP)?;
    let flags_changed_secs = seconds_since_event_type(KCG_EVENT_FLAGS_CHANGED)?;
    let keyboard_secs = median_of_three(key_down_secs, key_up_secs, flags_changed_secs);

    let click_secs = min_of_slice(&[
        seconds_since_event_type(KCG_EVENT_LEFT_MOUSE_DOWN)?,
        seconds_since_event_type(KCG_EVENT_LEFT_MOUSE_UP)?,
        seconds_since_event_type(KCG_EVENT_RIGHT_MOUSE_DOWN)?,
        seconds_since_event_type(KCG_EVENT_RIGHT_MOUSE_UP)?,
        seconds_since_event_type(KCG_EVENT_OTHER_MOUSE_DOWN)?,
        seconds_since_event_type(KCG_EVENT_OTHER_MOUSE_UP)?,
    ]);

    let scroll_secs = seconds_since_event_type(KCG_EVENT_SCROLL_WHEEL)?;
    let cursor_move_secs = seconds_since_cursor_move()?;

    let idle_secs = min_of_slice(&[keyboard_secs, click_secs, scroll_secs, cursor_move_secs]);

    if !idle_secs.is_finite() {
        return Err(format!(
            "Quartz returned non-finite idle time: {}",
            idle_secs
        ));
    }

    if idle_secs < 0.0 {
        return Err(format!("Quartz returned negative idle time: {}", idle_secs));
    }

    Ok(idle_secs.floor() as u64)
}

fn seconds_since_event_type(event_type: u32) -> Result<f64, String> {
    let secs = unsafe {
        CGEventSourceSecondsSinceLastEventType(KCG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE, event_type)
    };

    if !secs.is_finite() {
        return Err(format!(
            "Quartz returned non-finite idle time for event type {}: {}",
            event_type, secs
        ));
    }

    if secs < 0.0 {
        return Err(format!(
            "Quartz returned negative idle time for event type {}: {}",
            event_type, secs
        ));
    }

    Ok(secs)
}

fn seconds_since_cursor_move() -> Result<f64, String> {
    let position = current_cursor_position()?;
    let now = Instant::now();

    let tracker = MOUSE_TRACKER.get_or_init(|| {
        Mutex::new(MouseTrackerState {
            last_position: position,
            last_moved_at: now,
        })
    });

    let mut state = tracker
        .lock()
        .map_err(|e| format!("Failed to lock mouse tracker: {}", e))?;

    if cursor_position_changed(state.last_position, position) {
        state.last_position = position;
        state.last_moved_at = now;
    }

    Ok(now.duration_since(state.last_moved_at).as_secs_f64())
}

fn current_cursor_position() -> Result<CGPoint, String> {
    unsafe {
        let event = CGEventCreate(ptr::null());
        if event.is_null() {
            return Err("CGEventCreate returned null while reading cursor position".to_string());
        }

        let point = CGEventGetLocation(event);
        CFRelease(event);
        Ok(point)
    }
}

fn cursor_position_changed(previous: CGPoint, current: CGPoint) -> bool {
    const CURSOR_POSITION_EPSILON: f64 = 0.5;

    (previous.x - current.x).abs() > CURSOR_POSITION_EPSILON
        || (previous.y - current.y).abs() > CURSOR_POSITION_EPSILON
}

fn min_of_slice(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::INFINITY, f64::min)
}

fn median_of_three(a: f64, b: f64, c: f64) -> f64 {
    let mut values = [a, b, c];
    values.sort_by(f64::total_cmp);
    values[1]
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

    #[test]
    fn test_parse_idle_time_ns_from_cfnumber() {
        let cf_number = CFNumber::from(1_500_000_000_i64);
        let cf_type = cf_number.as_CFType();
        let idle_ns = parse_idle_time_ns(&cf_type).expect("CFNumber parsing should succeed");
        assert_eq!(idle_ns, 1_500_000_000);
    }

    #[test]
    fn test_parse_idle_time_ns_from_cfdata() {
        let expected_idle_ns = 2_500_000_000_u64;
        let cf_data = CFData::from_buffer(&expected_idle_ns.to_ne_bytes());
        let cf_type = cf_data.as_CFType();
        let idle_ns = parse_idle_time_ns(&cf_type).expect("CFData parsing should succeed");
        assert_eq!(idle_ns, expected_idle_ns);
    }

    #[test]
    fn test_median_of_three() {
        assert_eq!(median_of_three(1.0, 3.0, 2.0), 2.0);
        assert_eq!(median_of_three(9.0, 5.0, 7.0), 7.0);
    }

    #[test]
    fn test_min_of_slice() {
        assert_eq!(min_of_slice(&[5.0, 3.0, 8.0, 4.0]), 3.0);
    }
}
