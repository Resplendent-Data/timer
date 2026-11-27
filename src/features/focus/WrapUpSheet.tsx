import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  Clock,
  DollarSign,
  FolderKanban,
  History,
  RotateCcw,
  Search,
  Tag,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTimer } from "@/context/TimerProvider";
import {
  applyTimeInputToMs,
  buildProjectPath,
  formatDuration,
  formatTimeOfDay,
  toTimeInputValue,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  TaskSearchResult,
  TimeEntryTag,
  UpdateTimeEntryPayload,
} from "@/types/timer";

export function WrapUpSheet() {
  const {
    wrapUpEntry,
    closeWrapUp,
    saveWrapUpEntry,
    settings,
    workspaceTags,
    isLoadingTags,
    ensureWorkspaceTags,
    recentTasks,
  } = useTimer();

  const [description, setDescription] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [billable, setBillable] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(0);
  const [timesEdited, setTimesEdited] = useState(false);

  const [showTimeEditor, setShowTimeEditor] = useState(false);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskResults, setTaskResults] = useState<TaskSearchResult[]>([]);
  const [isSearchingTasks, setIsSearchingTasks] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync form state whenever a new entry opens
  useEffect(() => {
    if (!wrapUpEntry) return;

    setDescription(wrapUpEntry.description);
    setSelectedTaskId(wrapUpEntry.task_id);
    setSelectedTaskName(wrapUpEntry.task_name);
    setSelectedTags(
      wrapUpEntry.tags
        .map((t) => t.name)
        .filter((name) => name.toLowerCase() !== "rt")
    );
    setBillable(wrapUpEntry.billable);
    setStartMs(wrapUpEntry.start_time_ms);
    setEndMs(wrapUpEntry.end_time_ms);
    setTimesEdited(false);
    setShowTimeEditor(false);
    setShowTaskPicker(false);
    setTaskQuery("");
    setTaskResults([]);
    setError(null);

    void ensureWorkspaceTags();

    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 30);
  }, [wrapUpEntry, ensureWorkspaceTags]);

  // Debounced ClickUp task search inside the optional task linker
  useEffect(() => {
    if (!showTaskPicker || !taskQuery.trim()) {
      setTaskResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      if (!settings?.clickupApiKey || !settings?.clickupTeamId) return;
      setIsSearchingTasks(true);
      try {
        const results = await invoke<TaskSearchResult[]>("search_tasks", {
          apiKey: settings.clickupApiKey,
          teamId: settings.clickupTeamId,
          query: taskQuery.trim(),
        });
        setTaskResults(results.slice(0, 8));
      } catch (err) {
        console.debug("[WrapUpSheet] Task search failed:", err);
      } finally {
        setIsSearchingTasks(false);
      }
    }, 260);

    return () => window.clearTimeout(timer);
  }, [showTaskPicker, taskQuery, settings]);

  // Close on Escape
  useEffect(() => {
    if (!wrapUpEntry) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        event.preventDefault();
        closeWrapUp(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [wrapUpEntry, isSaving, closeWrapUp]);

  // Merge workspace tags with any tag already on the entry (excluding internal "rt")
  const selectableTags = useMemo<TimeEntryTag[]>(() => {
    const map = new Map<string, TimeEntryTag>();
    for (const tag of workspaceTags) {
      if (tag.name.toLowerCase() === "rt") continue;
      map.set(tag.name.toLowerCase(), tag);
    }
    for (const tag of wrapUpEntry?.tags ?? []) {
      if (tag.name.toLowerCase() === "rt") continue;
      if (!map.has(tag.name.toLowerCase())) {
        map.set(tag.name.toLowerCase(), tag);
      }
    }
    return Array.from(map.values());
  }, [workspaceTags, wrapUpEntry?.tags]);

  if (!wrapUpEntry) return null;

  const durationSecs = Math.max(0, Math.floor((endMs - startMs) / 1000));

  const toggleTag = (tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName)
        ? prev.filter((name) => name !== tagName)
        : [...prev, tagName]
    );
  };

  const nudgeStartMinutes = (deltaMinutes: number) => {
    const nextStart = startMs + deltaMinutes * 60_000;
    if (nextStart < endMs - 60_000) {
      setStartMs(nextStart);
      setTimesEdited(true);
    }
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (endMs <= startMs) {
      setError("End time must be after start time.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const payload: UpdateTimeEntryPayload = {
        description: description.trim(),
        billable,
        tags: selectedTags,
      };

      if (selectedTaskId !== wrapUpEntry.task_id) {
        if (selectedTaskId) {
          payload.task_id = selectedTaskId;
        } else {
          payload.clear_task = true;
        }
      }

      if (timesEdited) {
        payload.start_time_ms = startMs;
        payload.end_time_ms = endMs;
      }

      await saveWrapUpEntry(wrapUpEntry.id, payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const headingLabel =
    wrapUpEntry.source === "edit"
      ? "Edit session"
      : wrapUpEntry.source === "auto-stop"
      ? "Add note to auto-stopped session"
      : "Session complete";

  const showReuseSuggestion = Boolean(
    wrapUpEntry.suggested_description &&
      !description.trim()
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={headingLabel}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSaving) {
          closeWrapUp(true);
        }
      }}
    >
      <div className="surface-elevated animate-sheet-enter flex max-h-[90vh] w-full max-w-[428px] flex-col overflow-hidden rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">{headingLabel}</h2>
              {wrapUpEntry.is_backdated && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                  <History className="h-2.5 w-2.5" />
                  Backdated
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowTimeEditor((prev) => !prev)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground"
              title="Click to adjust start or end time"
            >
              <Clock className="h-3 w-3 text-accent" />
              <span className="font-mono-display font-semibold text-foreground">
                {formatDuration(durationSecs)}
              </span>
              <span className="text-white/20">·</span>
              <span className="font-mono-display">
                {formatTimeOfDay(startMs)} → {formatTimeOfDay(endMs)}
              </span>
              <span className="text-[10px] text-primary">
                {showTimeEditor ? "Done" : "Adjust"}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => closeWrapUp(true)}
            disabled={isSaving}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
            aria-label="Close wrap-up"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {/* Optional inline time adjuster */}
          {showTimeEditor && (
            <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Quick start nudge
                </span>
                <div className="flex items-center gap-1">
                  {[-15, -5, 5].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => nudgeStartMinutes(delta)}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono-display text-[11px] text-foreground/85 transition-colors hover:bg-white/[0.1]"
                    >
                      {delta > 0 ? `+${delta}m` : `${delta}m`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Start</span>
                  <Input
                    type="time"
                    value={toTimeInputValue(startMs)}
                    onChange={(e) => {
                      const next = applyTimeInputToMs(startMs, e.target.value);
                      if (next !== null) {
                        setStartMs(next);
                        setTimesEdited(true);
                      }
                    }}
                    className="h-8 font-mono-display text-xs"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>End</span>
                  <Input
                    type="time"
                    value={toTimeInputValue(endMs)}
                    onChange={(e) => {
                      const next = applyTimeInputToMs(endMs, e.target.value);
                      if (next !== null) {
                        setEndMs(next);
                        setTimesEdited(true);
                      }
                    }}
                    className="h-8 font-mono-display text-xs"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 1. Primary autofocused description */}
          <div className="space-y-1.5">
            <label
              htmlFor="wrapup-description"
              className="block text-xs font-semibold text-foreground/95"
            >
              What did you work on?
            </label>
            <textarea
              id="wrapup-description"
              ref={textareaRef}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              placeholder="Summarize what you worked on during this session..."
              className="w-full resize-none rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/65 outline-none transition-colors focus:border-primary/65 focus:bg-white/[0.06] focus:ring-[3px] focus:ring-ring/25"
            />

            {/* 1-click reuse previous note chip when picking up a past workstream */}
            {showReuseSuggestion && wrapUpEntry.suggested_description && (
              <button
                type="button"
                onClick={() => {
                  setDescription(wrapUpEntry.suggested_description ?? "");
                  textareaRef.current?.focus();
                }}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1 text-left text-[11px] text-foreground/90 transition-colors hover:bg-primary/20"
              >
                <RotateCcw className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate">
                  Reuse previous: &ldquo;{wrapUpEntry.suggested_description}&rdquo;
                </span>
              </button>
            )}
          </div>

          {/* 2. Tags & Billable — immediately visible inline (first-class!) */}
          <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/90">
                <Tag className="h-3.5 w-3.5 text-primary" />
                Tags
              </span>

              <button
                type="button"
                onClick={() => setBillable((prev) => !prev)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all",
                  billable
                    ? "border-success/50 bg-success/15 text-success shadow-[0_0_12px_-3px_rgba(45,212,150,0.45)]"
                    : "border-white/12 bg-white/[0.04] text-muted-foreground hover:border-white/25 hover:text-foreground"
                )}
              >
                <DollarSign className="h-3 w-3" />
                {billable ? "Billable" : "Non-billable"}
              </button>
            </div>

            {isLoadingTags && selectableTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">Loading tags...</p>
            ) : selectableTags.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No workspace time-entry tags found in ClickUp.
              </p>
            ) : (
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pt-0.5">
                {selectableTags.map((tag) => {
                  const active = selectedTags.includes(tag.name);
                  return (
                    <button
                      key={tag.name}
                      type="button"
                      onClick={() => toggleTag(tag.name)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                        active
                          ? "border-primary/65 bg-primary/20 text-foreground"
                          : "border-white/10 bg-white/[0.035] text-muted-foreground hover:border-white/20 hover:text-foreground"
                      )}
                      style={
                        active && tag.tag_bg
                          ? {
                              backgroundColor: `${tag.tag_bg}30`,
                              borderColor: `${tag.tag_bg}99`,
                            }
                          : undefined
                      }
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: tag.tag_bg || "#9d74ff" }}
                      />
                      <span>{tag.name}</span>
                      {active && <Check className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Optional ClickUp Task linker (secondary, tucked cleanly) */}
          <div className="space-y-2">
            {selectedTaskId ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <FolderKanban className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate font-medium text-foreground">
                    {selectedTaskName || `Task ${selectedTaskId}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTaskId(null);
                    setSelectedTaskName(null);
                  }}
                  className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  aria-label="Unlink ClickUp task"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowTaskPicker((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <FolderKanban className="h-3.5 w-3.5" />
                <span>
                  {showTaskPicker
                    ? "Hide ClickUp task picker"
                    : "+ Link to a ClickUp task (optional)"}
                </span>
              </button>
            )}

            {showTaskPicker && !selectedTaskId && (
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.025] p-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={taskQuery}
                    onChange={(e) => setTaskQuery(e.target.value)}
                    placeholder="Search ClickUp task..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>

                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {taskQuery.trim() ? (
                    isSearchingTasks ? (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        Searching...
                      </p>
                    ) : taskResults.length === 0 ? (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        No matching tasks
                      </p>
                    ) : (
                      taskResults.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => {
                            setSelectedTaskId(task.id);
                            setSelectedTaskName(task.name);
                            setShowTaskPicker(false);
                            setTaskQuery("");
                          }}
                          className="flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.07]"
                        >
                          <span className="truncate text-xs font-medium text-foreground">
                            {task.name}
                          </span>
                          {buildProjectPath(task) && (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {buildProjectPath(task)}
                            </span>
                          )}
                        </button>
                      ))
                    )
                  ) : recentTasks.length > 0 ? (
                    recentTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => {
                          setSelectedTaskId(task.id);
                          setSelectedTaskName(task.name);
                          setShowTaskPicker(false);
                        }}
                        className="flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.07]"
                      >
                        <span className="truncate text-xs font-medium text-foreground">
                          {task.name}
                        </span>
                        {task.projectPath && (
                          <span className="truncate text-[10px] text-muted-foreground">
                            {task.projectPath}
                          </span>
                        )}
                      </button>
                    ))
                  ) : (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      Type to search ClickUp tasks
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-destructive/35 bg-destructive/12 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] bg-black/20 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => closeWrapUp(true)}
            disabled={isSaving}
          >
            {wrapUpEntry.source === "edit" ? "Cancel" : "Skip"}
          </Button>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              ↵ Save
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="px-4"
            >
              <Check className="h-3.5 w-3.5" />
              {isSaving ? "Saving..." : "Save Entry"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
