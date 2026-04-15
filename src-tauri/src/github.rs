//! GitHub API client for fetching pull request counts and details.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

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

// --- GraphQL types for "no reviewers" query ---

#[derive(Debug, Deserialize)]
struct GqlResponse {
    data: Option<GqlData>,
}

#[derive(Debug, Deserialize)]
struct GqlData {
    search: GqlSearch,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlSearch {
    nodes: Vec<GqlPrNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlPrNode {
    title: String,
    url: String,
    number: u32,
    repository: GqlRepo,
    review_requests: GqlConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlRepo {
    name_with_owner: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlConnection {
    total_count: u32,
}

#[derive(Debug, Serialize)]
struct GqlQuery {
    query: String,
}

/// Extract "owner/repo" from a GitHub API repository URL.
fn extract_repo_name(repository_url: &str) -> String {
    repository_url
        .strip_prefix("https://api.github.com/repos/")
        .unwrap_or(repository_url)
        .to_string()
}

/// Build the standard reqwest client with GitHub headers.
fn github_headers(token: &str) -> Vec<(&'static str, String)> {
    vec![
        ("Authorization", format!("Bearer {}", token)),
        ("Accept", "application/vnd.github+json".to_string()),
        ("User-Agent", "resplendent-timer".to_string()),
        ("X-GitHub-Api-Version", "2022-11-28".to_string()),
    ]
}

fn github_client() -> &'static reqwest::Client {
    static GITHUB_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    GITHUB_CLIENT.get_or_init(reqwest::Client::new)
}

/// Fetch PR counts and details for the given GitHub user.
///
/// Makes two GitHub Search API calls (review requests + open PRs) and one
/// GraphQL call to find PRs with zero requested reviewers.
pub async fn get_pr_counts(token: String, username: String) -> Result<PrCounts, String> {
    let client = github_client();

    // --- REST search queries for review requests and open PRs ---
    let queries = [
        format!("is:pr is:open review-requested:{}", username),
        format!("is:pr is:open author:{}", username),
    ];

    let mut counts = [0u32; 2];
    let mut rest_items: [Vec<PrItem>; 2] = [vec![], vec![]];

    for (i, query) in queries.iter().enumerate() {
        let mut req = client
            .get("https://api.github.com/search/issues")
            .query(&[("q", query.as_str()), ("per_page", "25")]);

        for (k, v) in github_headers(&token) {
            req = req.header(k, v);
        }

        let resp = req
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
        rest_items[i] = search
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

    // --- GraphQL query: open PRs by user, then filter for zero reviewRequests ---
    let gql_query = format!(
        r#"{{
  search(query: "is:pr is:open author:{}", type: ISSUE, first: 50) {{
    issueCount
    nodes {{
      ... on PullRequest {{
        title
        url
        number
        repository {{ nameWithOwner }}
        reviewRequests(first: 0) {{ totalCount }}
      }}
    }}
  }}
}}"#,
        username
    );

    let gql_resp = client
        .post("https://api.github.com/graphql")
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "resplendent-timer")
        .json(&GqlQuery { query: gql_query })
        .send()
        .await
        .map_err(|e| format!("GitHub GraphQL request failed: {}", e))?;

    if !gql_resp.status().is_success() {
        let status = gql_resp.status();
        let body = gql_resp.text().await.unwrap_or_default();
        return Err(format!("GitHub GraphQL returned {}: {}", status, body));
    }

    let gql: GqlResponse = gql_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GraphQL response: {}", e))?;

    let gql_data = gql.data.ok_or("GraphQL response missing data field")?;

    // Filter to only PRs with zero requested reviewers
    let no_reviewer_items: Vec<PrItem> = gql_data
        .search
        .nodes
        .into_iter()
        .filter(|pr| pr.review_requests.total_count == 0)
        .map(|pr| PrItem {
            title: pr.title,
            html_url: pr.url,
            number: pr.number,
            repo: pr.repository.name_with_owner,
        })
        .collect();

    let needs_reviewers_count = no_reviewer_items.len() as u32;

    Ok(PrCounts {
        review_requests: counts[0],
        my_open_prs: counts[1],
        needs_reviewers: needs_reviewers_count,
        review_requests_items: rest_items[0].clone(),
        my_open_prs_items: rest_items[1].clone(),
        needs_reviewers_items: no_reviewer_items,
    })
}
