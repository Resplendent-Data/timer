//! ClickUp 30-day workspace team leaderboard aggregation.

use std::collections::HashMap;

use reqwest::StatusCode;
use serde::Deserialize;

use super::types::{TeamLeaderboardResponse, TeamLeaderboardUser};
use super::{http_client, id_from_value, parse_i64_from_value, team_id_matches};

#[derive(Debug, Deserialize)]
struct AuthorizedTeamsResponse {
    #[serde(default)]
    teams: Vec<AuthorizedTeam>,
}

#[derive(Debug, Deserialize)]
struct AuthorizedTeam {
    id: serde_json::Value,
    #[serde(default)]
    members: Vec<AuthorizedTeamMember>,
}

#[derive(Debug, Deserialize)]
struct AuthorizedTeamMember {
    user: AuthorizedTeamUser,
}

#[derive(Debug, Deserialize)]
struct AuthorizedTeamUser {
    id: serde_json::Value,
    #[serde(default)]
    username: Option<String>,
    #[serde(default, alias = "profilePicture")]
    profile_picture: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TimeEntriesResponse {
    #[serde(default)]
    data: Vec<TimeEntryApiResult>,
}

#[derive(Debug, Deserialize)]
struct TimeEntryApiResult {
    #[serde(default)]
    user: Option<TimeEntryApiUser>,
    #[serde(default)]
    assignee: Option<TimeEntryApiUser>,
    #[serde(default)]
    uid: Option<serde_json::Value>,
    duration: serde_json::Value,
    #[serde(default)]
    start: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct TimeEntryApiUser {
    id: serde_json::Value,
    #[serde(default)]
    username: Option<String>,
    #[serde(default, alias = "profilePicture")]
    profile_picture: Option<String>,
}

#[derive(Debug, Clone)]
struct TeamMemberIdentity {
    username: String,
    profile_picture: Option<String>,
}

#[derive(Debug, Clone)]
struct TeamMemberRecord {
    user_id: String,
    username: String,
    profile_picture: Option<String>,
}

#[derive(Debug, Clone)]
struct LeaderboardEntryInput {
    user_id: String,
    username: Option<String>,
    profile_picture: Option<String>,
    duration_ms: i64,
    start_ms: Option<i64>,
}

#[derive(Debug, Default, Clone)]
struct LeaderboardUserAccum {
    username: String,
    profile_picture: Option<String>,
    active_seconds: i64,
    past_seconds: i64,
    running_entry_count: i64,
}

#[derive(Debug)]
struct ClickUpApiError {
    context: &'static str,
    status: Option<StatusCode>,
    body: String,
}

impl ClickUpApiError {
    fn network(context: &'static str, error: reqwest::Error) -> Self {
        Self {
            context,
            status: error.status(),
            body: error.to_string(),
        }
    }

    fn http(context: &'static str, status: StatusCode, body: String) -> Self {
        Self {
            context,
            status: Some(status),
            body,
        }
    }

    fn parse(context: &'static str, error: impl std::fmt::Display) -> Self {
        Self {
            context,
            status: None,
            body: error.to_string(),
        }
    }

    fn into_message(self) -> String {
        match self.status {
            Some(status) => format!("{} ({}): {}", self.context, status, self.body),
            None => format!("{}: {}", self.context, self.body),
        }
    }
}

impl TimeEntryApiResult {
    fn into_leaderboard_input(self) -> Option<LeaderboardEntryInput> {
        let identity = self.user.or(self.assignee);
        let user_id = identity
            .as_ref()
            .and_then(|user| id_from_value(&user.id))
            .or_else(|| self.uid.as_ref().and_then(id_from_value))?;

        let username = identity
            .as_ref()
            .and_then(|user| user.username.clone())
            .filter(|name| !name.trim().is_empty());
        let profile_picture = identity.and_then(|user| user.profile_picture);
        let duration_ms = parse_i64_from_value(&self.duration)?;
        let start_ms = self.start.as_ref().and_then(parse_i64_from_value);

        Some(LeaderboardEntryInput {
            user_id,
            username,
            profile_picture,
            duration_ms,
            start_ms,
        })
    }
}

fn millis_to_seconds(duration_ms: i64) -> i64 {
    (duration_ms / 1000).max(0)
}

fn running_seconds_from_entry(duration_ms: i64, start_ms: Option<i64>, now_ms: i64) -> i64 {
    if let Some(start_ms) = start_ms.filter(|start| *start > 0) {
        return ((now_ms - start_ms) / 1000).max(0);
    }

    millis_to_seconds(duration_ms.saturating_abs())
}

fn should_retry_without_assignee(status: Option<StatusCode>, body: &str) -> bool {
    if matches!(
        status,
        Some(StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
    ) {
        return true;
    }

    if status != Some(StatusCode::BAD_REQUEST) {
        return false;
    }

    let body = body.to_lowercase();
    body.contains("assignee")
        || body.contains("permission")
        || body.contains("forbidden")
        || body.contains("not authorized")
        || body.contains("not allowed")
}

fn aggregate_team_leaderboard_users(
    entries: Vec<LeaderboardEntryInput>,
    member_lookup: &HashMap<String, TeamMemberIdentity>,
    now_ms: i64,
) -> Vec<TeamLeaderboardUser> {
    let mut by_user: HashMap<String, LeaderboardUserAccum> = HashMap::new();

    for entry in entries {
        let fallback_username = entry
            .username
            .as_ref()
            .map(|name| name.trim())
            .filter(|name| !name.is_empty())
            .map(|name| name.to_string())
            .unwrap_or_else(|| format!("User {}", entry.user_id));

        let username = member_lookup
            .get(&entry.user_id)
            .map(|member| member.username.clone())
            .unwrap_or(fallback_username);
        let profile_picture = member_lookup
            .get(&entry.user_id)
            .and_then(|member| member.profile_picture.clone())
            .or(entry.profile_picture.clone());

        let user = by_user
            .entry(entry.user_id.clone())
            .or_insert_with(|| LeaderboardUserAccum {
                username: username.clone(),
                profile_picture: profile_picture.clone(),
                ..LeaderboardUserAccum::default()
            });

        if user.username.starts_with("User ") && !username.starts_with("User ") {
            user.username = username;
        }
        if user.profile_picture.is_none() {
            user.profile_picture = profile_picture;
        }

        if entry.duration_ms > 0 {
            let past_seconds = millis_to_seconds(entry.duration_ms);
            if past_seconds > 0 {
                user.past_seconds += past_seconds;
            }
            continue;
        }

        if entry.duration_ms < 0 {
            let active_seconds =
                running_seconds_from_entry(entry.duration_ms, entry.start_ms, now_ms);
            if active_seconds > 0 {
                user.active_seconds += active_seconds;
                user.running_entry_count += 1;
            }
        }
    }

    let mut users: Vec<TeamLeaderboardUser> = by_user
        .into_iter()
        .filter_map(|(user_id, user)| {
            let total_seconds = user.active_seconds + user.past_seconds;
            if total_seconds <= 0 {
                return None;
            }

            Some(TeamLeaderboardUser {
                user_id,
                username: user.username,
                profile_picture: user.profile_picture,
                active_seconds: user.active_seconds,
                past_seconds: user.past_seconds,
                total_seconds,
                running_entry_count: user.running_entry_count,
            })
        })
        .collect();

    users.sort_by(|left, right| {
        right
            .total_seconds
            .cmp(&left.total_seconds)
            .then_with(|| right.active_seconds.cmp(&left.active_seconds))
            .then_with(|| {
                left.username
                    .to_ascii_lowercase()
                    .cmp(&right.username.to_ascii_lowercase())
            })
    });

    users
}

async fn fetch_team_members(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
) -> Result<Vec<TeamMemberRecord>, ClickUpApiError> {
    const CONTEXT: &str = "Failed to fetch ClickUp workspaces";
    let response = client
        .get("https://api.clickup.com/api/v2/team")
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|error| ClickUpApiError::network(CONTEXT, error))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ClickUpApiError::http(CONTEXT, status, body));
    }

    let payload: AuthorizedTeamsResponse = response
        .json()
        .await
        .map_err(|error| ClickUpApiError::parse(CONTEXT, error))?;

    let selected_team = payload
        .teams
        .into_iter()
        .find(|team| team_id_matches(&team.id, team_id))
        .ok_or_else(|| ClickUpApiError {
            context: "ClickUp workspace is not accessible with this API key",
            status: None,
            body: team_id.to_string(),
        })?;

    let mut members: HashMap<String, TeamMemberRecord> = HashMap::new();
    for member in selected_team.members {
        let Some(user_id) = id_from_value(&member.user.id) else {
            continue;
        };

        let username = member
            .user
            .username
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("User {}", user_id));

        members.entry(user_id.clone()).or_insert(TeamMemberRecord {
            user_id,
            username,
            profile_picture: member.user.profile_picture,
        });
    }

    Ok(members.into_values().collect())
}

async fn fetch_team_time_entries(
    client: &reqwest::Client,
    api_key: &str,
    team_id: &str,
    start_date_ms: i64,
    end_date_ms: i64,
    assignees: Option<&[String]>,
) -> Result<Vec<TimeEntryApiResult>, ClickUpApiError> {
    const CONTEXT: &str = "Failed to fetch ClickUp team time entries";
    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries",
        team_id
    );

    let mut query: Vec<(String, String)> = vec![
        ("start_date".to_string(), start_date_ms.to_string()),
        ("end_date".to_string(), end_date_ms.to_string()),
    ];
    if let Some(assignees) = assignees {
        if !assignees.is_empty() {
            query.push(("assignee".to_string(), assignees.join(",")));
        }
    }

    let response = client
        .get(&url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .query(&query)
        .send()
        .await
        .map_err(|error| ClickUpApiError::network(CONTEXT, error))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ClickUpApiError::http(CONTEXT, status, body));
    }

    let payload: TimeEntriesResponse = response
        .json()
        .await
        .map_err(|error| ClickUpApiError::parse(CONTEXT, error))?;
    Ok(payload.data)
}

/// Get a 30-day workspace leaderboard split by active (running) and past (completed) time.
pub async fn get_clickup_team_leaderboard(
    api_key: String,
    team_id: String,
) -> Result<TeamLeaderboardResponse, String> {
    const WINDOW_DAYS: i64 = 30;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let start_date_ms = now_ms - chrono::Duration::days(WINDOW_DAYS).num_milliseconds();

    let client = http_client();
    let members = fetch_team_members(client, &api_key, &team_id)
        .await
        .map_err(ClickUpApiError::into_message)?;

    let mut member_lookup: HashMap<String, TeamMemberIdentity> = HashMap::new();
    let mut assignee_ids: Vec<String> = Vec::new();
    for member in members {
        assignee_ids.push(member.user_id.clone());
        member_lookup.insert(
            member.user_id,
            TeamMemberIdentity {
                username: member.username,
                profile_picture: member.profile_picture,
            },
        );
    }
    assignee_ids.sort_unstable();
    assignee_ids.dedup();

    let scoped_entries_result = if assignee_ids.is_empty() {
        fetch_team_time_entries(client, &api_key, &team_id, start_date_ms, now_ms, None).await
    } else {
        fetch_team_time_entries(
            client,
            &api_key,
            &team_id,
            start_date_ms,
            now_ms,
            Some(&assignee_ids),
        )
        .await
    };

    let mut is_partial = false;
    let mut warning = None;
    let mut debug_details = None;
    let raw_entries = match scoped_entries_result {
        Ok(entries) => entries,
        Err(error)
            if !assignee_ids.is_empty()
                && should_retry_without_assignee(error.status, &error.body) =>
        {
            let status_text = error
                .status
                .map(|status| status.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let context = error.context;
            let body = error.body.clone();

            is_partial = true;
            warning = Some(
                "Showing partial leaderboard because this API key cannot read all teammates' time entries."
                    .to_string(),
            );
            debug_details = Some(format!(
                "Context: {}\nStatus: {}\nBody: {}",
                context, status_text, body
            ));
            fetch_team_time_entries(client, &api_key, &team_id, start_date_ms, now_ms, None)
                .await
                .map_err(ClickUpApiError::into_message)?
        }
        Err(error) => return Err(error.into_message()),
    };

    let leaderboard_entries: Vec<LeaderboardEntryInput> = raw_entries
        .into_iter()
        .filter_map(TimeEntryApiResult::into_leaderboard_input)
        .collect();
    let users = aggregate_team_leaderboard_users(leaderboard_entries, &member_lookup, now_ms);

    Ok(TeamLeaderboardResponse {
        window_days: WINDOW_DAYS,
        generated_at_ms: now_ms,
        is_partial,
        warning,
        debug_details,
        users,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aggregate_team_leaderboard_splits_active_and_past() {
        let now_ms = 1_700_000_000_000_i64;
        let mut member_lookup = HashMap::new();
        member_lookup.insert(
            "101".to_string(),
            TeamMemberIdentity {
                username: "Alice".to_string(),
                profile_picture: Some("https://cdn.example.com/alice.png".to_string()),
            },
        );

        let users = aggregate_team_leaderboard_users(
            vec![
                LeaderboardEntryInput {
                    user_id: "101".to_string(),
                    username: Some("Alice".to_string()),
                    profile_picture: None,
                    duration_ms: 3_600_000,
                    start_ms: Some(now_ms - 3_600_000),
                },
                LeaderboardEntryInput {
                    user_id: "101".to_string(),
                    username: Some("Alice".to_string()),
                    profile_picture: None,
                    duration_ms: -1,
                    start_ms: Some(now_ms - 1_800_000),
                },
            ],
            &member_lookup,
            now_ms,
        );

        assert_eq!(users.len(), 1);
        assert_eq!(users[0].past_seconds, 3600);
        assert_eq!(users[0].active_seconds, 1800);
        assert_eq!(users[0].total_seconds, 5400);
        assert_eq!(users[0].running_entry_count, 1);
    }

    #[test]
    fn test_aggregate_team_leaderboard_filters_zero_totals() {
        let users = aggregate_team_leaderboard_users(
            vec![
                LeaderboardEntryInput {
                    user_id: "301".to_string(),
                    username: Some("Zero".to_string()),
                    profile_picture: None,
                    duration_ms: 0,
                    start_ms: None,
                },
                LeaderboardEntryInput {
                    user_id: "302".to_string(),
                    username: Some("Hero".to_string()),
                    profile_picture: None,
                    duration_ms: 1_000,
                    start_ms: None,
                },
            ],
            &HashMap::new(),
            1_700_000_000_000_i64,
        );

        assert_eq!(users.len(), 1);
        assert_eq!(users[0].user_id, "302");
    }

    #[test]
    fn test_aggregate_team_leaderboard_sorting_rules() {
        let now_ms = 1_700_000_000_000_i64;
        let mut member_lookup = HashMap::new();
        member_lookup.insert(
            "1".to_string(),
            TeamMemberIdentity {
                username: "Delta".to_string(),
                profile_picture: None,
            },
        );
        member_lookup.insert(
            "2".to_string(),
            TeamMemberIdentity {
                username: "Charlie".to_string(),
                profile_picture: None,
            },
        );
        member_lookup.insert(
            "3".to_string(),
            TeamMemberIdentity {
                username: "Bravo".to_string(),
                profile_picture: None,
            },
        );

        let users = aggregate_team_leaderboard_users(
            vec![
                LeaderboardEntryInput {
                    user_id: "1".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: 5_400_000,
                    start_ms: None,
                },
                LeaderboardEntryInput {
                    user_id: "2".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: 2_400_000,
                    start_ms: None,
                },
                LeaderboardEntryInput {
                    user_id: "2".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: -1,
                    start_ms: Some(now_ms - 1_200_000),
                },
                LeaderboardEntryInput {
                    user_id: "3".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: 2_400_000,
                    start_ms: None,
                },
                LeaderboardEntryInput {
                    user_id: "3".to_string(),
                    username: None,
                    profile_picture: None,
                    duration_ms: -1,
                    start_ms: Some(now_ms - 1_200_000),
                },
            ],
            &member_lookup,
            now_ms,
        );

        let sorted_names: Vec<&str> = users.iter().map(|u| u.username.as_str()).collect();
        assert_eq!(sorted_names, vec!["Delta", "Bravo", "Charlie"]);
    }
}
