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
    /// Human-readable diagnostic when detection is negative or degraded.
    #[serde(default)]
    pub diagnostic: Option<String>,
}

fn is_browser_context(app_lower: &str, bundle_lower: &str) -> bool {
    app_lower.contains("chrome")
        || app_lower.contains("safari")
        || app_lower.contains("edge")
        || app_lower == "arc"
        || bundle_lower.contains("com.google.chrome")
        || bundle_lower.contains("com.apple.safari")
        || bundle_lower.contains("com.microsoft.edgemac")
        || bundle_lower.contains("company.thebrowser.browser")
}

fn is_teams_context(app_lower: &str, bundle_lower: &str) -> bool {
    app_lower.contains("teams") || bundle_lower.contains("com.microsoft.teams")
}

fn is_teams_meeting_title(title_lower: &str) -> bool {
    if title_lower.is_empty() {
        return false;
    }

    let primary_section = title_lower.split('|').next().unwrap_or_default().trim();
    if matches!(
        primary_section,
        "activity" | "chat" | "calendar" | "teams" | "calls" | "files" | "apps" | "home"
    ) {
        return false;
    }

    let has_call_signal = title_lower.contains(" in call")
        || title_lower.contains(" on call")
        || title_lower.contains("call with ")
        || title_lower.contains(" calling")
        || title_lower.starts_with("calling ")
        || title_lower.contains(" call ")
        || title_lower.ends_with(" call");

    title_lower.contains("meeting")
        || title_lower.contains("meet now")
        || has_call_signal
        || title_lower.contains("webinar")
        || title_lower.contains("town hall")
        || title_lower.contains("live event")
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

    let is_teams = is_teams_context(&app_lower, &bundle_lower);
    if is_teams && is_teams_meeting_title(&title_lower) {
        return Some("teams-app".to_string());
    }

    let is_slack = app_lower.contains("slack")
        || bundle_lower.contains("com.tinyspeck.slackmacgap")
        || bundle_lower.contains("com.slack");
    if is_slack && title_lower.contains("huddle") {
        return Some("slack-huddle".to_string());
    }

    if app_lower.contains("google meet") {
        return Some("google-meet-app".to_string());
    }

    let is_browser = is_browser_context(&app_lower, &bundle_lower);

    if is_browser
        && (title_lower.contains("google meet")
            || title_lower.contains("meet.google.com")
            || title_lower.contains("meet.google.")
            || title_lower.contains("microsoft teams")
            || title_lower.contains("zoom meeting"))
    {
        return Some("browser-meeting-tab".to_string());
    }

    None
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str, source: &str) -> Result<String, String> {
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("{}: osascript launch failed: {}", source, error))?;

    if !output.status.success() {
        let status = output
            .status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "signal".to_string());
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(format!("{}: osascript failed (exit {})", source, status));
        }
        return Err(format!(
            "{}: osascript failed (exit {}): {}",
            source, status, stderr
        ));
    }

    let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if title.is_empty() || title.eq_ignore_ascii_case("missing value") {
        return Err(format!("{}: title unavailable", source));
    }

    Ok(title)
}

#[cfg(target_os = "macos")]
#[derive(Debug, Default)]
struct WindowTitleFetch {
    title: Option<String>,
    diagnostic: Option<String>,
}

fn meeting_diagnostic(
    app_name: Option<&str>,
    bundle_id: Option<&str>,
    window_title: Option<&str>,
    title_fetch_diagnostic: Option<String>,
    reason: Option<&str>,
) -> Option<String> {
    if reason.is_some() {
        return None;
    }

    if let Some(diagnostic) = title_fetch_diagnostic {
        return Some(diagnostic);
    }

    let app_lower = app_name.unwrap_or_default().to_lowercase();
    let bundle_lower = bundle_id.unwrap_or_default().to_lowercase();
    let is_browser = is_browser_context(&app_lower, &bundle_lower);
    if is_browser && window_title.is_none() {
        return Some("browser-window-title-unavailable".to_string());
    }
    let is_teams = is_teams_context(&app_lower, &bundle_lower);
    if is_teams && window_title.is_none() {
        return Some("teams-window-title-unavailable".to_string());
    }

    None
}

#[cfg(target_os = "macos")]
fn fetch_window_title(app_name: &str, bundle_id: Option<&str>) -> WindowTitleFetch {
    let app_lower = app_name.to_lowercase();
    let bundle_lower = bundle_id.unwrap_or_default().to_lowercase();

    let script = if app_lower.contains("slack")
        || bundle_lower.contains("com.tinyspeck.slackmacgap")
        || bundle_lower.contains("com.slack")
    {
        Some((
            "slack-front-window",
            "tell application \"System Events\" to tell process \"Slack\" to get name of front window",
        ))
    } else if is_teams_context(&app_lower, &bundle_lower) {
        Some((
            "teams-front-window",
            "tell application \"System Events\" to tell (first application process whose frontmost is true) to get name of front window",
        ))
    } else if app_lower.contains("chrome") || bundle_lower.contains("com.google.chrome") {
        Some((
            "chrome-active-tab",
            "tell application \"Google Chrome\" to get title of active tab of front window",
        ))
    } else if app_lower.contains("safari") || bundle_lower.contains("com.apple.safari") {
        Some((
            "safari-active-tab",
            "tell application \"Safari\" to get name of current tab of front window",
        ))
    } else if app_lower.contains("edge") || bundle_lower.contains("com.microsoft.edgemac") {
        Some((
            "edge-active-tab",
            "tell application \"Microsoft Edge\" to get title of active tab of front window",
        ))
    } else if app_lower == "arc" || bundle_lower.contains("company.thebrowser.browser") {
        Some((
            "arc-active-tab",
            "tell application \"Arc\" to get title of active tab of front window",
        ))
    } else {
        None
    };

    let Some((source, script_text)) = script else {
        return WindowTitleFetch::default();
    };

    match run_osascript(script_text, source) {
        Ok(title) => WindowTitleFetch {
            title: Some(title),
            diagnostic: None,
        },
        Err(diagnostic) => WindowTitleFetch {
            title: None,
            diagnostic: Some(diagnostic),
        },
    }
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
            diagnostic: None,
        });
    };

    let app_name = frontmost_app.localizedName().map(|name| name.to_string());
    let bundle_id = frontmost_app
        .bundleIdentifier()
        .map(|bundle| bundle.to_string());

    let title_fetch = app_name
        .as_deref()
        .map(|name| fetch_window_title(name, bundle_id.as_deref()))
        .unwrap_or_default();
    let window_title = title_fetch.title;

    let reason = meeting_reason(
        app_name.as_deref(),
        bundle_id.as_deref(),
        window_title.as_deref(),
    );
    let in_meeting = reason.is_some();
    let diagnostic = meeting_diagnostic(
        app_name.as_deref(),
        bundle_id.as_deref(),
        window_title.as_deref(),
        title_fetch.diagnostic,
        reason.as_deref(),
    );

    Ok(MeetingPresence {
        supported: true,
        in_meeting,
        app_name,
        bundle_id,
        window_title,
        reason,
        diagnostic,
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
        diagnostic: None,
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
            Some("Daily Standup Meeting | Microsoft Teams"),
        );
        assert_eq!(reason.as_deref(), Some("teams-app"));
    }

    #[test]
    fn does_not_detect_teams_navigation_window() {
        let reason = meeting_reason(
            Some("Microsoft Teams"),
            Some("com.microsoft.teams2"),
            Some("Chat | Microsoft Teams"),
        );
        assert!(reason.is_none());
    }

    #[test]
    fn does_not_detect_teams_without_meeting_keyword() {
        let reason = meeting_reason(
            Some("Microsoft Teams"),
            Some("com.microsoft.teams2"),
            Some("Sprint Planning | Microsoft Teams"),
        );
        assert!(reason.is_none());
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
    fn detects_browser_meeting_google_domain_family() {
        let reason = meeting_reason(
            Some("Google Chrome"),
            Some("com.google.Chrome"),
            Some("meet.google.co.uk - Team Sync"),
        );
        assert_eq!(reason.as_deref(), Some("browser-meeting-tab"));
    }

    #[test]
    fn detects_google_meet_app_name() {
        let reason = meeting_reason(Some("Google Meet"), Some("com.google.meet"), None);
        assert_eq!(reason.as_deref(), Some("google-meet-app"));
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

    #[test]
    fn does_not_detect_generic_meet_without_google_signal() {
        let reason = meeting_reason(
            Some("Google Chrome"),
            Some("com.google.Chrome"),
            Some("Design meet notes"),
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
