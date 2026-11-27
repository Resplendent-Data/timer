import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, GitPullRequest, X } from "lucide-react";
import { useTimer } from "@/context/TimerProvider";
import { cn } from "@/lib/utils";
import type { PrCounts, PrItem } from "@/types/timer";

type PrCategory = "review" | "open" | "no_reviewers";

const POLL_INTERVAL_MS = 15 * 60 * 1000;

export function GitHubPrPopover() {
  const { settings, isWindowVisible } = useTimer();
  const [counts, setCounts] = useState<PrCounts | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<PrCategory>("review");
  const containerRef = useRef<HTMLDivElement>(null);

  const token = settings?.githubToken?.trim() ?? "";
  const username = settings?.githubUsername?.trim() ?? "";
  const configured = Boolean(token && username);

  const fetchCounts = useCallback(async () => {
    if (!configured) {
      setCounts(null);
      return;
    }

    try {
      const result = await invoke<PrCounts>("get_github_pr_counts", {
        token,
        username,
      });
      setCounts(result);
    } catch (err) {
      console.debug("[GitHubPrPopover] Failed to fetch PR counts:", err);
    }
  }, [configured, token, username]);

  useEffect(() => {
    if (!isWindowVisible || !configured) return;
    void fetchCounts();
    const interval = window.setInterval(fetchCounts, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fetchCounts, isWindowVisible, configured]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!configured || !counts) return null;

  const totalAttention = counts.review_requests + counts.needs_reviewers;

  const tabs: { id: PrCategory; label: string; count: number; items: PrItem[] }[] = [
    {
      id: "review",
      label: "To Review",
      count: counts.review_requests,
      items: counts.review_requests_items,
    },
    {
      id: "open",
      label: "Open",
      count: counts.my_open_prs,
      items: counts.my_open_prs_items,
    },
    {
      id: "no_reviewers",
      label: "Unassigned",
      count: counts.needs_reviewers,
      items: counts.needs_reviewers_items,
    },
  ];

  const activeItems = tabs.find((t) => t.id === category)?.items ?? [];

  return (
    <div ref={containerRef} className="relative" data-no-drag>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
          open
            ? "border-primary/50 bg-primary/20 text-foreground"
            : totalAttention > 0
            ? "border-accent/30 bg-accent/10 text-accent hover:bg-accent/18"
            : "border-white/10 bg-white/[0.04] text-muted-foreground hover:text-foreground"
        )}
        title="GitHub Pull Requests"
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        <span className="font-mono-display font-semibold">
          {counts.review_requests}
        </span>
      </button>

      {open && (
        <div className="surface-elevated animate-sheet-enter absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2">
            <span className="text-xs font-semibold text-foreground">
              Pull Requests
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
              aria-label="Close pull requests"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 border-b border-white/[0.07] bg-black/20 p-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                className={cn(
                  "flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
                  category === tab.id
                    ? "bg-white/[0.1] text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{tab.label}</span>
                <span className="font-mono-display text-[10px] opacity-80">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="max-h-56 divide-y divide-white/[0.06] overflow-y-auto">
            {activeItems.length === 0 ? (
              <p className="py-5 text-center text-xs text-muted-foreground">
                All clear here
              </p>
            ) : (
              activeItems.map((pr) => (
                <button
                  key={pr.html_url}
                  type="button"
                  onClick={() => void openUrl(pr.html_url)}
                  className="group flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {pr.title}
                    </p>
                    <p className="mt-0.5 font-mono-display text-[10px] text-muted-foreground">
                      {pr.repo}#{pr.number}
                    </p>
                  </div>
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
