/**
 * Compact GitHub PR counts displayed above the timer.
 *
 * Shows review requests, open PRs, and PRs needing reviewers.
 * Renders nothing if GitHub is not configured.
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "@/lib/store";
import { GitPullRequest } from "lucide-react";

interface PrCounts {
  review_requests: number;
  my_open_prs: number;
  needs_reviewers: number;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function GitHubPrStatus() {
  const [counts, setCounts] = useState<PrCounts | null>(null);
  const [configured, setConfigured] = useState(false);

  const fetchCounts = useCallback(async () => {
    try {
      const settings = await getSettings();
      const token = settings?.githubToken?.trim();
      const username = settings?.githubUsername?.trim();

      if (!token || !username) {
        setConfigured(false);
        setCounts(null);
        return;
      }

      setConfigured(true);
      const result = await invoke<PrCounts>("get_github_pr_counts", {
        token,
        username,
      });
      setCounts(result);
    } catch (error) {
      console.error("[GitHubPrStatus] Failed to fetch PR counts:", error);
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  if (!configured || !counts) return null;

  return (
    <div className="flex items-center justify-center gap-3 px-2 py-1.5 text-[11px] text-muted-foreground">
      <GitPullRequest className="h-3 w-3 shrink-0" />
      <span>
        <span className="font-medium text-foreground">{counts.review_requests}</span>{" "}
        to review
      </span>
      <span className="text-border">|</span>
      <span>
        <span className="font-medium text-foreground">{counts.my_open_prs}</span>{" "}
        open
      </span>
      <span className="text-border">|</span>
      <span>
        <span className="font-medium text-foreground">{counts.needs_reviewers}</span>{" "}
        unassigned
      </span>
    </div>
  );
}
