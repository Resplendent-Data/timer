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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
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
      <Card className="gap-0 py-0">
        <CardContent className="px-2 py-1">
          <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <GitPullRequest className="h-3 w-3 shrink-0" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => toggleCategory("review")}
              className={`h-7 px-2 text-[11px] normal-case tracking-normal ${
                expandedCategory === "review" ? "text-foreground" : ""
              }`}
            >
              <Badge variant="secondary">{counts.review_requests}</Badge>
              to review
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => toggleCategory("open")}
              className={`h-7 px-2 text-[11px] normal-case tracking-normal ${
                expandedCategory === "open" ? "text-foreground" : ""
              }`}
            >
              <Badge variant="secondary">{counts.my_open_prs}</Badge>
              open
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => toggleCategory("no_reviewers")}
              className={`h-7 px-2 text-[11px] normal-case tracking-normal ${
                expandedCategory === "no_reviewers" ? "text-foreground" : ""
              }`}
            >
              <Badge variant="secondary">{counts.needs_reviewers}</Badge>
              no reviewers
            </Button>
          </div>
        </CardContent>
      </Card>

      {expandedCategory && (
        <Card className="absolute left-2 right-2 top-full z-50 mt-1 gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b px-3 py-1.5">
            <span className="text-xs font-medium">{label}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setExpandedCategory(null)}
              className="h-7 w-7"
              aria-label="Close PR list"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              None
            </div>
          ) : (
            <ScrollArea className="max-h-48">
              {items.map((pr) => (
                <Button
                  key={pr.html_url}
                  type="button"
                  variant="ghost"
                  onClick={() => openUrl(pr.html_url)}
                  className="h-auto w-full justify-start rounded-none border-b px-3 py-2 text-left text-xs normal-case tracking-normal last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{pr.title}</div>
                    <div className="text-muted-foreground text-[10px]">
                      {pr.repo}#{pr.number}
                    </div>
                  </div>
                  <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                </Button>
              ))}
            </ScrollArea>
          )}
        </Card>
      )}
    </div>
  );
}
