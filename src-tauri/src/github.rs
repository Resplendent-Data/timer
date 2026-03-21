//! GitHub API client for fetching pull request counts and details.

use serde::{Deserialize, Serialize};

/// A single pull request item returned to the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PrItem {
    pub title: String,
    pub html_url: String,
    pub number: u32,
    pub repo: String,
}

/// PR count summary returned to the frontend.
#[derive(Debug, Serialize, Deserialize)]
pub struct PrCounts {
    pub review_requests: u32,
    pub my_open_prs: u32,
    pub needs_reviewers: u32,
    pub review_requests_items: Vec<PrItem>,
    pub my_open_prs_items: Vec<PrItem>,
    pub needs_reviewers_items: Vec<PrItem>,
}

/// Minimal GitHub search response item.
#[derive(Debug, Deserialize)]
struct SearchItem {
    title: String,
    html_url: String,
    number: u32,
    /// Full repo URL, e.g. "https://api.github.com/repos/owner/repo"
    repository_url: String,
}

/// GitHub search response with total_count and items.
#[derive(Debug, Deserialize)]
struct SearchResponse {
    total_count: u32,
    items: Vec<SearchItem>,
}

/// Extract "owner/repo" from a GitHub API repository URL.
fn extract_repo_name(repository_url: &str) -> String {
    // "https://api.github.com/repos/owner/repo" -> "owner/repo"
    repository_url
        .strip_prefix("https://api.github.com/repos/")
        .unwrap_or(repository_url)
        .to_string()
}

/// Fetch PR counts and details for the given GitHub user.
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
    let mut all_items: [Vec<PrItem>; 3] = [vec![], vec![], vec![]];

    for (i, query) in queries.iter().enumerate() {
        let resp = client
            .get("https://api.github.com/search/issues")
            .query(&[("q", query.as_str()), ("per_page", "25")])
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
        all_items[i] = search
            .items
            .into_iter()
            .map(|item| PrItem {
                title: item.title,
                html_url: item.html_url,
                number: item.number,
                repo: extract_repo_name(&item.repository_url),
            })
            .collect();
    }

    Ok(PrCounts {
        review_requests: counts[0],
        my_open_prs: counts[1],
        needs_reviewers: counts[2],
        review_requests_items: all_items[0].clone(),
        my_open_prs_items: all_items[1].clone(),
        needs_reviewers_items: all_items[2].clone(),
    })
}
