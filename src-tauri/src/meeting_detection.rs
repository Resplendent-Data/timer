//! Meeting presence detection.
//!
//! v1 detection rules:
//! - macOS only
//! - Built-in app/title matching (Zoom, Teams, Slack Huddles, Meet/Teams/Zoom browser tabs)

#[cfg(target_os = "macos")]
use std::process::Command;

use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
use objc2_app_kit::NSWorkspace;

/// Current meeting presence signal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingPresence {
    /// Whether this platform supports meeting detection.
    pub supported: bool,
    /// Whether the current foreground context appears to be a meeting.
    pub in_meeting: bool,
    /// Frontmost app display name.
    pub app_name: Option<String>,
    /// Frontmost app bundle identifier.
    pub bundle_id: Option<String>,
    /// Best-effort active window/tab title.
    pub window_title: Option<String>,
    /// Human-readable reason for a positive match.
    pub reason: Option<String>,
}

fn meeting_reason(
    app_name: Option<&str>,
    bundle_id: Option<&str>,
    window_title: Option<&str>,
) -> Option<String> {
    let app_lower = app_name.unwrap_or_default().to_lowercase();
    let bundle_lower = bundle_id.unwrap_or_default().to_lowercase();
    let title_lower = window_title.unwrap_or_default().to_lowercase();

    let is_zoom = app_lower.contains("zoom") || bundle_lower.contains("us.zoom.xos");
    if is_zoom {
        return Some("zoom-app".to_string());
    }

    let is_teams = app_lower.contains("teams") || bundle_lower.contains("com.microsoft.teams");
    if is_teams {
        return Some("teams-app".to_string());
    }

    let is_slack = app_lower.contains("slack")
        || bundle_lower.contains("com.tinyspeck.slackmacgap")
        || bundle_lower.contains("com.slack");
    if is_slack && title_lower.contains("huddle") {
        return Some("slack-huddle".to_string());
    }

    let is_browser = app_lower.contains("chrome")
        || app_lower.contains("safari")
        || app_lower.contains("edge")
        || app_lower == "arc"
        || bundle_lower.contains("com.google.chrome")
        || bundle_lower.contains("com.apple.safari")
        || bundle_lower.contains("com.microsoft.edgemac")
        || bundle_lower.contains("company.thebrowser.browser");

    if is_browser
        && (title_lower.contains("google meet")
            || title_lower.contains("meet.google.com")
            || title_lower.contains("microsoft teams")
            || title_lower.contains("zoom meeting"))
    {
        return Some("browser-meeting-tab".to_string());
    }

    None
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Option<String> {
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if title.is_empty() || title.eq_ignore_ascii_case("missing value") {
        return None;
    }

    Some(title)
}

#[cfg(target_os = "macos")]
fn fetch_window_title(app_name: &str, bundle_id: Option<&str>) -> Option<String> {
    let app_lower = app_name.to_lowercase();
    let bundle_lower = bundle_id.unwrap_or_default().to_lowercase();

    if app_lower.contains("slack")
        || bundle_lower.contains("com.tinyspeck.slackmacgap")
        || bundle_lower.contains("com.slack")
    {
        return run_osascript(
            "tell application \"System Events\" to tell process \"Slack\" to get name of front window",
        );
    }

    if app_lower.contains("chrome") || bundle_lower.contains("com.google.chrome") {
        return run_osascript("tell application \"Google Chrome\" to get title of active tab of front window");
    }

    if app_lower.contains("safari") || bundle_lower.contains("com.apple.safari") {
        return run_osascript("tell application \"Safari\" to get name of current tab of front window");
    }

    if app_lower.contains("edge") || bundle_lower.contains("com.microsoft.edgemac") {
        return run_osascript("tell application \"Microsoft Edge\" to get title of active tab of front window");
    }

    if app_lower == "arc" || bundle_lower.contains("company.thebrowser.browser") {
        return run_osascript("tell application \"Arc\" to get title of active tab of front window");
    }

    None
}

/// Get current meeting presence.
#[cfg(target_os = "macos")]
pub fn get_meeting_presence() -> Result<MeetingPresence, String> {
    let workspace = NSWorkspace::sharedWorkspace();
    let frontmost = workspace.frontmostApplication();

    let Some(frontmost_app) = frontmost else {
        return Ok(MeetingPresence {
            supported: true,
            in_meeting: false,
            app_name: None,
            bundle_id: None,
            window_title: None,
            reason: None,
        });
    };

    let app_name = frontmost_app.localizedName().map(|name| name.to_string());
    let bundle_id = frontmost_app
        .bundleIdentifier()
        .map(|bundle| bundle.to_string());

    let window_title = app_name
        .as_deref()
        .and_then(|name| fetch_window_title(name, bundle_id.as_deref()));

    let reason = meeting_reason(
        app_name.as_deref(),
        bundle_id.as_deref(),
        window_title.as_deref(),
    );
    let in_meeting = reason.is_some();

    Ok(MeetingPresence {
        supported: true,
        in_meeting,
        app_name,
        bundle_id,
        window_title,
        reason,
    })
}

/// Meeting detection is currently only supported on macOS.
#[cfg(not(target_os = "macos"))]
pub fn get_meeting_presence() -> Result<MeetingPresence, String> {
    Ok(MeetingPresence {
        supported: false,
        in_meeting: false,
        app_name: None,
        bundle_id: None,
        window_title: None,
        reason: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_zoom_app() {
        let reason = meeting_reason(Some("zoom.us"), Some("us.zoom.xos"), None);
        assert_eq!(reason.as_deref(), Some("zoom-app"));
    }

    #[test]
    fn detects_teams_app() {
        let reason = meeting_reason(
            Some("Microsoft Teams"),
            Some("com.microsoft.teams2"),
            Some("Sprint Planning"),
        );
        assert_eq!(reason.as_deref(), Some("teams-app"));
    }

    #[test]
    fn detects_slack_huddle_from_title() {
        let reason = meeting_reason(
            Some("Slack"),
            Some("com.tinyspeck.slackmacgap"),
            Some("engineering huddle"),
        );
        assert_eq!(reason.as_deref(), Some("slack-huddle"));
    }

    #[test]
    fn detects_browser_meeting_tab() {
        let reason = meeting_reason(
            Some("Google Chrome"),
            Some("com.google.Chrome"),
            Some("meet.google.com - Daily Standup"),
        );
        assert_eq!(reason.as_deref(), Some("browser-meeting-tab"));
    }

    #[test]
    fn does_not_detect_non_meeting_context() {
        let reason = meeting_reason(
            Some("Visual Studio Code"),
            Some("com.microsoft.VSCode"),
            Some("src-tauri/src/lib.rs"),
        );
        assert!(reason.is_none());
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn non_macos_returns_unsupported() {
        let presence = get_meeting_presence().unwrap();
        assert!(!presence.supported);
        assert!(!presence.in_meeting);
    }
}
