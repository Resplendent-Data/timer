import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DollarSign,
  FolderKanban,
  History,
  Pencil,
  Play,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTimer } from "@/context/TimerProvider";
import {
  buildProjectPath,
  formatDuration,
  formatTimeOfDay,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { summaryToWrapUp } from "@/lib/wrapup";
import type {
  TaskSearchResult,
  TimeEntrySummary,
  TimeEntryTag,
} from "@/types/timer";

type DockMode = "history" | "tasks";

interface WorkstreamPreset {
  key: string;
  tags: TimeEntryTag[];
  billable: boolean;
  lastDescription: string | null;
  lastUsedMs: number;
}

interface DayGroup {
  key: string;
  label: string;
  totalSecs: number;
  entries: TimeEntrySummary[];
}

const SEARCH_DEBOUNCE_MS = 280;

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
    .getDate()
    .toString()
    .padStart(2, "0")}`;
}

function formatDayHeading(ms: number): string {
  const now = new Date();
  const todayKey = localDayKey(now.getTime());
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const yesterdayKey = localDayKey(yest.getTime());

  const key = localDayKey(ms);
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";

  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function userTags(tags: TimeEntryTag[]): TimeEntryTag[] {
  return tags.filter((t) => t.name.toLowerCase() !== "rt");
}

export function RecentWorkDock() {
  const {
    settings,
    isConfigured,
    isProcessing,
    recentEntries,
    isLoadingRecentEntries,
    refreshRecentEntries,
    recentTasks,
    startQuickTimer,
    resumeFromEntry,
    openWrapUp,
  } = useTimer();

  const [mode, setMode] = useState<DockMode>("history");
  const [historyFilter, setHistoryFilter] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(18);

  // Task search state (optional secondary tab)
  const [taskQuery, setTaskQuery] = useState("");
  const [taskResults, setTaskResults] = useState<TaskSearchResult[]>([]);
  const [selectedTaskIdx, setSelectedTaskIdx] = useState(-1);
  const [isSearchingTasks, setIsSearchingTasks] = useState(false);
  const [taskSearchError, setTaskSearchError] = useState<string | null>(null);
  const taskInputRef = useRef<HTMLInputElement>(null);

  const completedEntries = useMemo(
    () => recentEntries.filter((e) => !e.is_running),
    [recentEntries]
  );

  // Auto-derive quick 1-click Tag + Billable presets from recent history
  const quickPresets = useMemo<WorkstreamPreset[]>(() => {
    const seen = new Map<string, WorkstreamPreset>();
    for (const entry of completedEntries) {
      const tags = userTags(entry.tags);
      if (tags.length === 0 && !entry.billable) continue;

      const sortedTagKey = tags
        .map((t) => t.name.toLowerCase())
        .sort()
        .join("|");
      const key = `${sortedTagKey}::${entry.billable ? "1" : "0"}`;
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          tags,
          billable: entry.billable,
          lastDescription: entry.description?.trim() || null,
          lastUsedMs: entry.start_time_ms,
        });
      }
      if (seen.size >= 6) break;
    }
    return Array.from(seen.values());
  }, [completedEntries]);

  // Filter & group completed history by day
  const { dayGroups, totalFilteredCount } = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    const filtered = q
      ? completedEntries.filter((entry) => {
          const tagMatch = userTags(entry.tags).some((t) =>
            t.name.toLowerCase().includes(q)
          );
          const descMatch = (entry.description ?? "").toLowerCase().includes(q);
          const taskMatch = (entry.task_name ?? "").toLowerCase().includes(q);
          const billableMatch = q === "billable" && entry.billable;
          return tagMatch || descMatch || taskMatch || billableMatch;
        })
      : completedEntries;

    const sliced = filtered.slice(0, visibleLimit);
    const groupsMap = new Map<string, DayGroup>();

    for (const entry of sliced) {
      const key = localDayKey(entry.start_time_ms);
      let group = groupsMap.get(key);
      if (!group) {
        group = {
          key,
          label: formatDayHeading(entry.start_time_ms),
          totalSecs: 0,
          entries: [],
        };
        groupsMap.set(key, group);
      }
      group.entries.push(entry);
      group.totalSecs += entry.duration_secs;
    }

    return {
      dayGroups: Array.from(groupsMap.values()),
      totalFilteredCount: filtered.length,
    };
  }, [completedEntries, historyFilter, visibleLimit]);

  // Debounced ClickUp task search when Tasks tab is active
  useEffect(() => {
    if (mode !== "tasks" || !taskQuery.trim()) {
      setTaskResults([]);
      setSelectedTaskIdx(-1);
      setTaskSearchError(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      if (!settings?.clickupApiKey || !settings?.clickupTeamId) return;
      setIsSearchingTasks(true);
      setTaskSearchError(null);
      try {
        const fetched = await invoke<TaskSearchResult[]>("search_tasks", {
          apiKey: settings.clickupApiKey,
          teamId: settings.clickupTeamId,
          query: taskQuery.trim(),
        });
        setTaskResults(fetched);
        setSelectedTaskIdx(fetched.length > 0 ? 0 : -1);
      } catch (err) {
        setTaskSearchError(err instanceof Error ? err.message : String(err));
        setTaskResults([]);
      } finally {
        setIsSearchingTasks(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [mode, taskQuery, settings]);

  const handleStartPreset = useCallback(
    async (preset: WorkstreamPreset) => {
      await startQuickTimer({
        tags: preset.tags.map((t) => t.name),
        billable: preset.billable,
        description: null,
        resumedNote: preset.lastDescription,
      });
    },
    [startQuickTimer]
  );

  const handleStartTask = useCallback(
    async (taskId: string, taskName: string, projectPath?: string) => {
      setTaskQuery("");
      setTaskResults([]);
      setSelectedTaskIdx(-1);
      await startQuickTimer({ taskId, taskName, projectPath });
    },
    [startQuickTimer]
  );

  const handleTaskKeyDown = (e: React.KeyboardEvent) => {
    if (taskResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedTaskIdx((prev) =>
        prev < taskResults.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedTaskIdx((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === "Enter" && selectedTaskIdx >= 0) {
      e.preventDefault();
      const task = taskResults[selectedTaskIdx];
      void handleStartTask(task.id, task.name, buildProjectPath(task));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setTaskQuery("");
      setTaskResults([]);
      setSelectedTaskIdx(-1);
    }
  };

  if (!isConfigured) return null;

  return (
    <section className="surface-card rounded-2xl overflow-hidden">
      {/* Header with mode switch: Recent History (primary) vs ClickUp Tasks (optional) */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
        <div className="inline-flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-black/25 p-0.5">
          <button
            type="button"
            onClick={() => setMode("history")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
              mode === "history"
                ? "bg-white/[0.12] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <History className="h-3 w-3" />
            <span>Recent Work</span>
            {completedEntries.length > 0 && (
              <span className="font-mono-display text-[10px] opacity-70">
                {completedEntries.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMode("tasks")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
              mode === "tasks"
                ? "bg-white/[0.12] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FolderKanban className="h-3 w-3" />
            <span>Tasks</span>
          </button>
        </div>

        {mode === "history" && (
          <button
            type="button"
            onClick={() => void refreshRecentEntries()}
            disabled={isLoadingRecentEntries}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            title="Refresh 14-day history"
            aria-label="Refresh history"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                isLoadingRecentEntries && "animate-spin"
              )}
            />
          </button>
        )}
      </div>

      {mode === "history" ? (
        <div className="space-y-3 p-3.5">
          {/* Quick 1-click Tag + Billable presets derived from recent entries */}
          {quickPresets.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/85">
                Quick pick-up by tag
              </p>
              <div className="flex flex-wrap gap-1.5">
                {quickPresets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => void handleStartPreset(preset)}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] py-1 pl-2.5 pr-2 text-xs font-medium text-foreground/90 transition-all hover:border-primary/50 hover:bg-primary/15 disabled:opacity-45"
                    title={
                      preset.lastDescription
                        ? `Start with ${preset.tags.map((t) => t.name).join(", ") || "Billable"} (last: ${preset.lastDescription})`
                        : "Start timer with this tag & billable preset"
                    }
                  >
                    {preset.tags.length > 0 ? (
                      preset.tags.map((tag) => (
                        <span
                          key={tag.name}
                          className="inline-flex items-center gap-1"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: tag.tag_bg || "#9d74ff" }}
                          />
                          <span>{tag.name}</span>
                        </span>
                      ))
                    ) : (
                      <span>General</span>
                    )}

                    {preset.billable && (
                      <span className="inline-flex items-center rounded-full bg-success/15 px-1 py-0.5 text-[10px] font-semibold text-success">
                        <DollarSign className="h-2.5 w-2.5" />
                      </span>
                    )}

                    <Play className="h-2.5 w-2.5 fill-current text-muted-foreground transition-colors group-hover:text-primary" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filter history */}
          {completedEntries.length > 3 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
                placeholder="Filter history by note, tag, or 'billable'..."
                className="h-8 pl-8 pr-8 text-xs"
              />
              {historyFilter && (
                <button
                  type="button"
                  onClick={() => setHistoryFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Day-grouped 14-day history list */}
          {isLoadingRecentEntries && completedEntries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading recent work...
            </div>
          ) : dayGroups.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-black/20 py-6 text-center">
              <p className="text-xs font-medium text-foreground/80">
                {historyFilter.trim()
                  ? "No matching sessions"
                  : "No recent sessions in the last 14 days"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {historyFilter.trim()
                  ? "Try clearing your filter"
                  : "Hit Start Timer above to log your first session"}
              </p>
            </div>
          ) : (
            <div className="max-h-[340px] space-y-3 overflow-y-auto pr-0.5">
              {dayGroups.map((group) => (
                <div key={group.key} className="space-y-1.5">
                  <div className="sticky top-0 z-10 flex items-center justify-between bg-[#141624] px-1 py-0.5">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {group.label}
                    </span>
                    <span className="font-mono-display text-[11px] text-muted-foreground/80">
                      {formatDuration(group.totalSecs)}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {group.entries.map((entry) => {
                      const tags = userTags(entry.tags);
                      const hasNote = Boolean(entry.description?.trim());
                      const primaryText = hasNote
                        ? entry.description!.trim()
                        : entry.task_name || null;

                      return (
                        <div
                          key={entry.id}
                          className="group flex items-center justify-between gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-white/14 hover:bg-white/[0.045]"
                        >
                          <div className="min-w-0 flex-1">
                            {/* What was worked on */}
                            <p
                              className={cn(
                                "truncate text-xs font-medium",
                                primaryText
                                  ? "text-foreground/95"
                                  : "text-accent/85 italic"
                              )}
                            >
                              {primaryText || "No description — click edit to add"}
                            </p>

                            {/* Tags, billable, task & time metadata */}
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {tags.map((tag) => (
                                <span
                                  key={tag.name}
                                  className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-foreground/90"
                                  style={{
                                    backgroundColor: tag.tag_bg
                                      ? `${tag.tag_bg}26`
                                      : "rgba(255,255,255,0.06)",
                                    borderColor: tag.tag_bg
                                      ? `${tag.tag_bg}55`
                                      : "rgba(255,255,255,0.1)",
                                  }}
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{
                                      backgroundColor: tag.tag_bg || "#9d74ff",
                                    }}
                                  />
                                  {tag.name}
                                </span>
                              ))}

                              {entry.billable && (
                                <span className="inline-flex items-center rounded-full border border-success/30 bg-success/12 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                                  $
                                </span>
                              )}

                              {!entry.is_manual && entry.task_name && hasNote && (
                                <span className="inline-flex max-w-[110px] items-center gap-1 truncate rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  <FolderKanban className="h-2.5 w-2.5 shrink-0" />
                                  <span className="truncate">{entry.task_name}</span>
                                </span>
                              )}

                              <span className="font-mono-display text-[10px] text-muted-foreground/80">
                                {formatTimeOfDay(entry.start_time_ms)} ·{" "}
                                {formatDuration(entry.duration_secs)}
                              </span>
                            </div>
                          </div>

                          {/* 1-click Pick Up & Edit actions */}
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openWrapUp(summaryToWrapUp(entry))}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/75 transition-colors hover:bg-white/[0.08] hover:text-foreground"
                              title="Edit note, tags, billable, or times"
                              aria-label="Edit session"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() => void resumeFromEntry(entry)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary transition-all hover:bg-primary hover:text-primary-foreground disabled:opacity-45"
                              title="Pick up (keeps tags & billable, asks what you worked on when you stop)"
                              aria-label="Pick up session"
                            >
                              <Play className="h-3.5 w-3.5 fill-current translate-x-[0.5px]" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {totalFilteredCount > visibleLimit && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + 20)}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.025] py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  Show more ({totalFilteredCount - visibleLimit} remaining)
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Optional Secondary ClickUp Tasks tab */
        <div className="space-y-3 p-3.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={taskInputRef}
              type="text"
              value={taskQuery}
              onChange={(e) => setTaskQuery(e.target.value)}
              onKeyDown={handleTaskKeyDown}
              disabled={isProcessing}
              placeholder="Search ClickUp tasks · click or Enter to start"
              className="h-9 pl-9 pr-8 text-xs"
            />
            {isSearchingTasks && (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
            {taskQuery && !isSearchingTasks && (
              <button
                type="button"
                onClick={() => {
                  setTaskQuery("");
                  setTaskResults([]);
                  taskInputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label="Clear task search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {taskQuery.trim() ? (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {taskSearchError ? (
                <p className="px-2 py-2 text-xs text-destructive">
                  {taskSearchError}
                </p>
              ) : !isSearchingTasks && taskResults.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No tasks matching &ldquo;{taskQuery.trim()}&rdquo;
                </p>
              ) : (
                taskResults.map((task, idx) => {
                  const path = buildProjectPath(task);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      disabled={isProcessing}
                      onMouseEnter={() => setSelectedTaskIdx(idx)}
                      onClick={() =>
                        void handleStartTask(task.id, task.name, path)
                      }
                      className={cn(
                        "group flex w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                        idx === selectedTaskIdx
                          ? "bg-primary/15 text-foreground"
                          : "hover:bg-white/[0.05]"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {task.status_color && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: task.status_color }}
                            />
                          )}
                          <span className="truncate text-xs font-medium text-foreground">
                            {task.name}
                          </span>
                        </div>
                        {(path || task.custom_id) && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {path || task.custom_id}
                          </p>
                        )}
                      </div>
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary opacity-75 transition-opacity group-hover:opacity-100">
                        <Play className="h-3 w-3 fill-current" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : recentTasks.length > 0 ? (
            <div className="space-y-1">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/85">
                Recent tasks
              </p>
              {recentTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  disabled={isProcessing}
                  onClick={() =>
                    void handleStartTask(task.id, task.name, task.projectPath)
                  }
                  className="group flex w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.055] disabled:opacity-45"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground/95">
                      {task.name}
                    </p>
                    {task.projectPath && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {task.projectPath}
                      </p>
                    )}
                  </div>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-muted-foreground transition-colors group-hover:bg-primary/20 group-hover:text-primary">
                    <Play className="h-3 w-3 fill-current" />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Search above to start a timer linked to a ClickUp task
            </p>
          )}
        </div>
      )}
    </section>
  );
}
