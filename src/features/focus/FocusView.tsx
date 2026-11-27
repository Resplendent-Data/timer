import {
  AlertCircle,
  PencilLine,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimer } from "@/context/TimerProvider";
import { useNow } from "@/hooks/useNow";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import { RecentWorkDock } from "./RecentWorkDock";
import { TimerHero } from "./TimerHero";
import { WorkPaceBar } from "./WorkPaceBar";

export function FocusView() {
  const {
    settingsLoaded,
    isConfigured,
    setActiveTab,
    isWindowVisible,
    error,
    clearError,
    pendingNoteEntry,
    openWrapUp,
    dismissPendingNote,
    meetingResumePayload,
    resumeAfterMeeting,
    dismissMeetingResume,
    isProcessing,
  } = useTimer();

  const nowMs = useNow(isWindowVisible && pendingNoteEntry !== null, 60_000);

  return (
    <div className="space-y-3 pb-4">
      {/* Unconfigured ClickUp onboarding banner */}
      {settingsLoaded && !isConfigured && (
        <div className="surface-card flex items-center justify-between gap-3 rounded-2xl border-primary/30 bg-primary/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              Connect your ClickUp workspace
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Add your API key & Team ID to enable 1-click timers and backdating.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setActiveTab("settings")}
            className="shrink-0"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Setup
          </Button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-destructive/35 bg-destructive/12 px-3.5 py-2.5 text-xs text-destructive">
          <div className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 rounded p-0.5 hover:bg-white/10"
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Meeting resume banner */}
      {meetingResumePayload && (
        <div className="surface-card flex items-center justify-between gap-2.5 rounded-xl border-primary/35 bg-primary/10 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              Meeting ended — pick up previous work?
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {meetingResumePayload.task_name ||
                meetingResumePayload.description ||
                "Previous session"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              onClick={() => void resumeAfterMeeting()}
              disabled={isProcessing}
            >
              <RotateCcw className="h-3 w-3" />
              Pick up
            </Button>
            <button
              type="button"
              onClick={dismissMeetingResume}
              className="rounded-lg p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              aria-label="Dismiss meeting resume"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Non-blocking "Add note" prompt for skipped, switched, or auto-stopped sessions */}
      {pendingNoteEntry && (
        <div className="flex items-center justify-between gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2.5">
          <button
            type="button"
            onClick={() => openWrapUp(pendingNoteEntry)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <PencilLine className="h-3.5 w-3.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">
                Add what you worked on ({formatDuration(pendingNoteEntry.duration_secs)})
              </p>
              <p className="text-[11px] text-muted-foreground">
                Ended {formatRelativeTime(pendingNoteEntry.end_time_ms, nowMs)}
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={dismissPendingNote}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
            aria-label="Dismiss note reminder"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <WorkPaceBar />
      <TimerHero />
      <RecentWorkDock />
    </div>
  );
}
