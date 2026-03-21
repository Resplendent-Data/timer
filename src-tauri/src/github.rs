//! GitHub API client for fetching pull request counts.

use serde::{Deserialize, Serialize};

/// PR count summary returned to the frontend.
#[derive(Debug, Serialize, Deserialize)]
pub struct PrCounts {
    pub review_requests: u32,
    pub my_open_prs: u32,
    pub needs_reviewers: u32,
}

/// Minimal GitHub search response — we only need total_count.
#[derive(Debug, Deserialize)]
struct SearchResponse {
    total_count: u32,
}

/// Fetch PR counts for the given GitHub user.
///
/// Makes three GitHub Search API calls:
/// 1. PRs where the user is requested as reviewer
/// 2. Open PRs authored by the user
/// 3. Open PRs authored by the user with no reviewers assigned
pub async fn get_pr_counts(token: String, username: String) -> Result<PrCounts, String> {
    let client = reqwest::Client::new();

    let queries = [
        format!("is:pr is:open review-requested:{}", username),
        format!("is:pr is:open author:{}", username),
        format!("is:pr is:open author:{} review:none", username),
    ];

    let mut counts = [0u32; 3];

    for (i, query) in queries.iter().enumerate() {
        let resp = client
            .get("https://api.github.com/search/issues")
            .query(&[("q", query.as_str()), ("per_page", "1")])
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "resplendent-timer")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|e| format!("GitHub API request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API returned {}: {}", status, body));
        }

        let search: SearchResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse GitHub response: {}", e))?;

        counts[i] = search.total_count;
    }

    Ok(PrCounts {
        review_requests: counts[0],
        my_open_prs: counts[1],
        needs_reviewers: counts[2],
    })
}
