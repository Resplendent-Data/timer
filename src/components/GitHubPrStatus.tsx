/**
 * Compact GitHub PR counts displayed above the timer.
 *
 * Shows review requests, open PRs, and PRs with no reviewers.
 * Each count is clickable to show a list of PRs with links to GitHub.
 * Renders nothing if GitHub is not configured.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitPullRequest, ExternalLink, X } from "lucide-react";
import { AppSettings } from "@/lib/store";

interface PrItem {
  title: string;
  html_url: string;
  number: number;
  repo: string;
}

interface PrCounts {
  review_requests: number;
  my_open_prs: number;
  needs_reviewers: number;
  review_requests_items: PrItem[];
  my_open_prs_items: PrItem[];
  needs_reviewers_items: PrItem[];
}

type PrCategory = "review" | "open" | "no_reviewers";

const POLL_INTERVAL_MS = 15 * 60 * 1000;

interface GitHubPrStatusProps {
  settings: AppSettings | null;
  isVisible: boolean;
}

export function GitHubPrStatus({ settings, isVisible }: GitHubPrStatusProps) {
  const [counts, setCounts] = useState<PrCounts | null>(null);
  const [configured, setConfigured] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<PrCategory | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchCounts = useCallback(async () => {
    try {
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
  }, [settings]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    fetchCounts();
    const interval = window.setInterval(fetchCounts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCounts, isVisible]);

  // Close panel when clicking outside
  useEffect(() => {
    if (!expandedCategory) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpandedCategory(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expandedCategory]);

  if (!configured || !counts) return null;

  const toggleCategory = (category: PrCategory) => {
    setExpandedCategory((prev) => (prev === category ? null : category));
  };

  const getItems = (): { label: string; items: PrItem[] } => {
    switch (expandedCategory) {
      case "review":
        return { label: "To Review", items: counts.review_requests_items };
      case "open":
        return { label: "Open PRs", items: counts.my_open_prs_items };
      case "no_reviewers":
        return { label: "No Reviewers", items: counts.needs_reviewers_items };
      default:
        return { label: "", items: [] };
    }
  };

  const { label, items } = expandedCategory ? getItems() : { label: "", items: [] };

  return (
    <div ref={panelRef} className="relative">
      <div className="flex items-center justify-center gap-3 px-2 py-1.5 text-[11px] text-muted-foreground">
        <GitPullRequest className="h-3 w-3 shrink-0" />
        <button
          onClick={() => toggleCategory("review")}
          className={`hover:text-foreground transition-colors cursor-pointer ${
            expandedCategory === "review" ? "text-foreground" : ""
          }`}
        >
          <span className="font-medium text-foreground">{counts.review_requests}</span>{" "}
          to review
        </button>
        <span className="text-border">|</span>
        <button
          onClick={() => toggleCategory("open")}
          className={`hover:text-foreground transition-colors cursor-pointer ${
            expandedCategory === "open" ? "text-foreground" : ""
          }`}
        >
          <span className="font-medium text-foreground">{counts.my_open_prs}</span>{" "}
          open
        </button>
        <span className="text-border">|</span>
        <button
          onClick={() => toggleCategory("no_reviewers")}
          className={`hover:text-foreground transition-colors cursor-pointer ${
            expandedCategory === "no_reviewers" ? "text-foreground" : ""
          }`}
        >
          <span className="font-medium text-foreground">{counts.needs_reviewers}</span>{" "}
          no reviewers
        </button>
      </div>

      {expandedCategory && (
        <div className="absolute left-2 right-2 top-full z-50 rounded-md border bg-card shadow-lg">
          <div className="flex items-center justify-between px-3 py-1.5 border-b">
            <span className="text-xs font-medium">{label}</span>
            <button
              onClick={() => setExpandedCategory(null)}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              None
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {items.map((pr) => (
                <button
                  key={pr.html_url}
                  onClick={() => openUrl(pr.html_url)}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors cursor-pointer border-b last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{pr.title}</div>
                    <div className="text-muted-foreground text-[10px]">
                      {pr.repo}#{pr.number}
                    </div>
                  </div>
                  <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
