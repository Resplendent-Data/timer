import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Check,
  Clock,
  Copy,
  DollarSign,
  History,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimer } from "@/context/TimerProvider";
import { useNow } from "@/hooks/useNow";
import {
  formatClock,
  formatDuration,
  formatIdleDuration,
  formatTimeOfDay,
  generateGitBranchName,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export function TimerHero() {
  const {
    runningTimer,
    resumedFromNote,
    isWindowVisible,
    isMonitoring,
    isProcessing,
    isConfigured,
    settings,
    sampledIdleSeconds,
    lastIdleSampledAtMs,
    activeUntrackedSinceMs,
    isBackdateEligible,
    includeBackdate,
    setIncludeBackdate,
    lastStoppedEntry,
    startQuickTimer,
    stopAndWrapUp,
    resumeLastTimer,
    dismissUntrackedTime,
  } = useTimer();

  const [copiedBranch, setCopiedBranch] = useState(false);

  const isRunning = runningTimer !== null;
  const needsLiveSecondTick =
    isRunning ||
    Boolean(isBackdateEligible && includeBackdate && settings?.autoBackdateEnabled);
  // 1 Hz only while actively showing a live chronometer or backdate preview; 15s coarse tick otherwise.
  const nowMs = useNow(isWindowVisible, needsLiveSecondTick ? 1000 : 15_000);

  const liveIdleSeconds =
    lastIdleSampledAtMs === null
      ? sampledIdleSeconds
      : sampledIdleSeconds +
        Math.max(0, Math.floor((nowMs - lastIdleSampledAtMs) / 1000));

  const liveUntrackedSecs =
    !isRunning && activeUntrackedSinceMs !== null
      ? Math.max(0, Math.floor((nowMs - activeUntrackedSinceMs) / 1000))
      : 0;

  const maxBackdateMs = (settings?.maxBackdateMinutes ?? 120) * 60 * 1000;
  const effectiveBackdateStartMs =
    !isRunning &&
    isBackdateEligible &&
    includeBackdate &&
    activeUntrackedSinceMs !== null
      ? Math.max(activeUntrackedSinceMs, nowMs - maxBackdateMs)
      : null;

  const elapsedMs =
    runningTimer && runningTimer.start_time_ms > 0
      ? Math.max(0, nowMs - runningTimer.start_time_ms)
      : 0;

  const canCopyBranch = Boolean(
    runningTimer && !runningTimer.is_manual && runningTimer.task_id
  );

  const visibleTags = (runningTimer?.tags ?? []).filter(
    (tag) => tag.name.toLowerCase() !== "rt"
  );

  const lastVisibleTags = (lastStoppedEntry?.tags ?? []).filter(
    (tag) => tag.name.toLowerCase() !== "rt"
  );

  const handleCopyBranch = async () => {
    if (!runningTimer?.task_id) return;
    const branch = generateGitBranchName(runningTimer.name, runningTimer.task_id);
    try {
      await writeText(branch);
      setCopiedBranch(true);
      window.setTimeout(() => setCopiedBranch(false), 1800);
    } catch (err) {
      console.error("[TimerHero] Failed to copy git branch:", err);
    }
  };

  const heroStageClass = isRunning
    ? "hero-stage-running"
    : isBackdateEligible && includeBackdate && settings?.autoBackdateEnabled
    ? "hero-stage-untracked"
    : "hero-stage-idle";

  const untrackedPreviewMs =
    effectiveBackdateStartMs !== null ? Math.max(0, nowMs - effectiveBackdateStartMs) : 0;

  const backdateActive = Boolean(
    !isRunning &&
      isBackdateEligible &&
      settings?.autoBackdateEnabled &&
      includeBackdate &&
      effectiveBackdateStartMs !== null
  );

  return (
    <section
      className={cn("surface-card hero-stage rounded-2xl", heroStageClass)}
    >
      <div className="relative px-5 pb-4 pt-5">
        {/* Top contextual status pill */}
        <div className="mb-3 flex min-h-7 items-center justify-center">
          {isRunning ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-success/25 bg-success/10 px-3 py-1 text-[11px] font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              <span>Started {formatTimeOfDay(runningTimer.start_time_ms)}</span>
              {runningTimer.is_backdated && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  <History className="h-2.5 w-2.5" />
                  Backdated
                </span>
              )}
            </div>
          ) : isBackdateEligible && settings?.autoBackdateEnabled ? (
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 py-1 pl-2.5 pr-1.5 text-[11px]">
              <Sparkles className="h-3 w-3 shrink-0 text-accent" />
              <span className="truncate font-medium text-accent">
                Active {formatDuration(liveUntrackedSecs)}
              </span>
              <span className="hidden text-muted-foreground sm:inline">
                since{" "}
                {formatTimeOfDay(
                  effectiveBackdateStartMs ?? nowMs - liveUntrackedSecs * 1000
                )}
              </span>
              <button
                type="button"
                onClick={() => setIncludeBackdate(!includeBackdate)}
                className={cn(
                  "ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors",
                  includeBackdate
                    ? "bg-accent text-accent-foreground"
                    : "bg-white/10 text-muted-foreground hover:text-foreground"
                )}
                title={
                  includeBackdate
                    ? "Click to start from now instead"
                    : "Click to include untracked active time"
                }
              >
                {includeBackdate ? "Included" : "Start now"}
              </button>
              <button
                type="button"
                onClick={() => void dismissUntrackedTime()}
                className="rounded-full p-0.5 text-muted-foreground/80 transition-colors hover:bg-white/10 hover:text-foreground"
                title="Reset untracked active clock"
                aria-label="Reset untracked active clock"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-muted-foreground">
              <Clock className="h-3 w-3 text-primary/80" />
              {isConfigured ? "Ready to focus" : "Connect ClickUp to start"}
            </span>
          )}
        </div>

        {/* Chronometer digits */}
        <div className="text-center">
          <div
            className={cn(
              "text-chronometer select-none transition-colors duration-300",
              isRunning
                ? "timer-digit-running"
                : backdateActive
                ? "timer-digit-untracked"
                : "timer-digit-idle"
            )}
          >
            {isRunning
              ? formatClock(elapsedMs)
              : backdateActive
              ? `+${formatClock(untrackedPreviewMs)}`
              : "00:00"}
          </div>

          {/* Active session context: tags, billable, and subtitle */}
          <div className="mt-3 min-h-[2.25rem]">
            {isRunning ? (
              <div className="space-y-2">
                {/* Active tags & billable pills */}
                {(runningTimer.billable || visibleTags.length > 0) && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {visibleTags.map((tag) => (
                      <span
                        key={tag.name}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] font-medium"
                        style={{
                          backgroundColor: tag.tag_bg
                            ? `${tag.tag_bg}30`
                            : "rgba(255,255,255,0.08)",
                          borderColor: tag.tag_bg
                            ? `${tag.tag_bg}66`
                            : "rgba(255,255,255,0.12)",
                          color: "#f4f4fa",
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: tag.tag_bg || "#9d74ff" }}
                        />
                        {tag.name}
                      </span>
                    ))}
                    {runningTimer.billable && (
                      <span className="inline-flex items-center gap-0.5 rounded-full border border-success/35 bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success">
                        <DollarSign className="h-2.5 w-2.5" />
                        Billable
                      </span>
                    )}
                  </div>
                )}

                <div className="mx-auto flex max-w-full items-center justify-center gap-1.5">
                  <span
                    className={cn(
                      "min-w-0 max-w-[270px] truncate text-xs",
                      runningTimer.is_manual && !runningTimer.description
                        ? "text-muted-foreground"
                        : "text-sm font-semibold text-foreground"
                    )}
                  >
                    {runningTimer.is_manual && !runningTimer.description
                      ? resumedFromNote
                        ? `Picking up: ${resumedFromNote}`
                        : "Enter what you worked on when you finish"
                      : runningTimer.name}
                  </span>

                  {canCopyBranch && (
                    <button
                      type="button"
                      onClick={() => void handleCopyBranch()}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                      title="Copy git branch name"
                    >
                      {copiedBranch ? (
                        <>
                          <Check className="h-3 w-3 text-success" />
                          <span className="text-success">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Branch</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {backdateActive && effectiveBackdateStartMs
                  ? `Starts immediately from ${formatTimeOfDay(effectiveBackdateStartMs)} — add tags & notes when you finish.`
                  : "1 click to start now. Add tags, billable & notes when you finish."}
              </p>
            )}
          </div>
        </div>

        {/* Primary 1-click CTA */}
        <div className="mt-4 space-y-2">
          {isRunning ? (
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="w-full font-semibold"
              onClick={() => void stopAndWrapUp()}
              disabled={isProcessing}
            >
              <Square className="h-4 w-4 fill-current" />
              {isProcessing ? "Stopping..." : "End Session"}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                size="lg"
                className={cn(
                  "w-full font-semibold",
                  backdateActive &&
                    "bg-gradient-to-r from-primary via-[#b07dff] to-accent text-[#0f0c1a] shadow-[0_10px_28px_-8px_rgba(246,196,83,0.45)]"
                )}
                onClick={() => void startQuickTimer()}
                disabled={isProcessing || !isConfigured}
              >
                <Play className="h-4 w-4 fill-current" />
                {isProcessing
                  ? "Starting..."
                  : backdateActive && effectiveBackdateStartMs
                  ? `Start Timer · from ${formatTimeOfDay(effectiveBackdateStartMs)}`
                  : "Start Timer"}
              </Button>

              {/* Quick 1-click Pick Up Last Session (inherits tags & billable, asks new note on stop) */}
              {lastStoppedEntry && (
                <button
                  type="button"
                  onClick={() => void resumeLastTimer()}
                  disabled={isProcessing || !isConfigured}
                  className="group flex w-full items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-left text-xs transition-colors hover:border-primary/35 hover:bg-white/[0.055] disabled:opacity-45"
                  title="Pick up last workstream (keeps tags & billable, asks what you worked on when you stop)"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <RotateCcw className="h-3.5 w-3.5 shrink-0 text-primary transition-transform group-hover:-rotate-45" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          Pick up
                        </span>
                        <span className="min-w-0 truncate font-medium text-foreground">
                          {lastStoppedEntry.description?.trim() ||
                            lastStoppedEntry.task_name ||
                            (lastVisibleTags.length > 0
                              ? lastVisibleTags.map((t) => t.name).join(", ")
                              : "Last session")}
                        </span>
                      </div>
                      {(lastVisibleTags.length > 0 || lastStoppedEntry.billable) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {lastVisibleTags.map((tag) => (
                            <span
                              key={tag.name}
                              className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-foreground/90"
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: tag.tag_bg || "#9d74ff" }}
                              />
                              {tag.name}
                            </span>
                          ))}
                          {lastStoppedEntry.billable && (
                            <span className="inline-flex items-center rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                              $
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono-display text-[11px] text-muted-foreground">
                    {formatDuration(lastStoppedEntry.duration_secs)}
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Subtle status footer */}
      <div className="flex items-center justify-between border-t border-white/[0.07] bg-black/20 px-4 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>
            Idle{" "}
            <strong className="font-mono-display font-medium text-foreground/85">
              {formatIdleDuration(liveIdleSeconds)}
            </strong>
          </span>
          <span className="text-white/15">·</span>
          <span>Auto-stop {settings?.idleThresholdMinutes ?? 10}m</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isMonitoring ? "bg-success" : "bg-muted-foreground/40"
            )}
          />
          <span
            className={isMonitoring ? "text-foreground/80" : "text-muted-foreground"}
          >
            {isMonitoring ? "Monitoring" : "Starting..."}
          </span>
        </div>
      </div>
    </section>
  );
}
