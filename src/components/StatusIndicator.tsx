/**
 * Timer hero display component.
 *
 * Brutalist design with large timer display as the hero element.
 * Shows elapsed time prominently when running, with compact status indicators.
 */

import { useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { IdleStatus, useIdleTime } from "../hooks/useIdleChecker";
import { Badge } from "@/components/ui/badge";
import { Copy, Check } from "lucide-react";

interface StatusIndicatorProps {
  status: IdleStatus;
}

/**
 * Format seconds into a human-readable string.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format milliseconds into a timer display string (HH:MM:SS or MM:SS).
 */
function formatTimerDisplay(startTimeMs: number): string {
  const now = Date.now();
  const elapsedMs = now - startTimeMs;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format a date into a relative time string.
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);

  if (diffSecs < 60) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  return date.toLocaleDateString();
}

/**
 * Generate a git-safe branch name from a task title and task ID.
 * Format: {sanitized-title}-CU-{taskId} (all lowercase)
 */
function generateBranchName(taskName: string, taskId: string): string {
  // Remove all characters except alphanumeric and spaces, then replace spaces with hyphens
  const sanitized = taskName
    .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special characters
    .trim()
    .replace(/\s+/g, "-"); // Replace spaces with hyphens

  return `${sanitized}-CU-${taskId}`.toLowerCase();
}

/**
 * Hook to get live elapsed time from a start timestamp.
 */
function useTimerDisplay(startTimeMs: number | null): string {
  const [display, setDisplay] = useState<string>("--:--");

  useEffect(() => {
    if (startTimeMs === null || startTimeMs === 0) {
      setDisplay("--:--");
      return;
    }

    // Update immediately
    setDisplay(formatTimerDisplay(startTimeMs));

    // Update every second
    const interval = setInterval(() => {
      setDisplay(formatTimerDisplay(startTimeMs));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTimeMs]);

  return display;
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  // Get real-time idle updates
  const { idleSeconds } = useIdleTime();
  // Get live elapsed time for running timer
  const timerDisplay = useTimerDisplay(status.runningTaskStartMs);
  // Track copy feedback state
  const [copied, setCopied] = useState(false);

  const isRunning = !!status.runningTaskName;
  const canCopyBranch = isRunning && status.runningTaskId && !status.runningTimerIsManual;

  const handleCopyBranch = async () => {
    if (!status.runningTaskName || !status.runningTaskId) return;

    const branchName = generateBranchName(status.runningTaskName, status.runningTaskId);
    try {
      await writeText(branchName);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy branch name:", error);
    }
  };

  return (
    <div className="space-y-3">
      {/* Hero Timer Display */}
      <div className="brutalist-border bg-card p-6">
        {/* Large Timer */}
        <div className="text-center py-4">
          <div
            className={`text-timer tabular-nums ${
              isRunning ? "timer-glow" : "timer-idle"
            }`}
          >
            {timerDisplay}
          </div>

          {/* Task Name or Placeholder */}
          <div className="mt-3">
            {isRunning ? (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium truncate max-w-[250px]">
                    {status.runningTaskName}
                  </span>
                  {canCopyBranch && (
                    <button
                      onClick={handleCopyBranch}
                      className="p-1 hover:bg-muted rounded transition-colors"
                      title="Copy git branch name"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                      )}
                    </button>
                  )}
                </div>
                {/* Timer metadata */}
                {(status.runningTimerIsManual ||
                  status.runningTimerBillable ||
                  status.runningTimerTags.length > 0) && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {status.runningTimerIsManual && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        MANUAL
                      </Badge>
                    )}
                    {status.runningTimerBillable && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-emerald-600 text-emerald-500"
                      >
                        BILLABLE
                      </Badge>
                    )}
                    {status.runningTimerTags.map((tag) => (
                      <span
                        key={tag.name}
                        className="inline-flex items-center px-1.5 py-0 text-[10px] font-medium uppercase tracking-wider"
                        style={{
                          backgroundColor: tag.tag_bg || "#555",
                          color: "#fff",
                        }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground uppercase tracking-wider">
                No timer running
              </span>
            )}
          </div>
        </div>

        {/* Status Bar */}
        <div className="brutalist-divider mt-4 pt-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="brutalist-label">Idle</span>
              <span className="font-mono-display font-semibold tabular-nums">
                {formatDuration(idleSeconds)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="brutalist-label">Monitor</span>
              <span
                className={`font-mono-display font-semibold ${
                  status.isRunning ? "text-emerald-500" : "text-muted-foreground"
                }`}
              >
                {status.isRunning ? "ON" : "OFF"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Last Stopped - Compact One-liner */}
      {status.lastStoppedAt && status.lastStoppedTaskName && (
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span className="truncate max-w-[200px]">
            Last: "{status.lastStoppedTaskName}"
          </span>
          <span className="shrink-0 ml-2">
            {formatRelativeTime(status.lastStoppedAt)}
          </span>
        </div>
      )}

      {/* Error Display */}
      {status.error && (
        <div className="brutalist-border border-destructive bg-destructive/10 p-3">
          <p className="text-sm text-destructive font-mono-display">
            {status.error}
          </p>
        </div>
      )}
    </div>
  );
}
