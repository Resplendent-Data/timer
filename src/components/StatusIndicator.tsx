/**
 * Timer hero display component.
 *
 * Brand-aligned timer hero display.
 * Shows elapsed time prominently when running, with compact status indicators.
 */

import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { IdleStatus } from "../hooks/useIdleChecker";

interface StatusIndicatorProps {
  status: IdleStatus;
  nowMs: number;
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
function formatTimerDisplay(startTimeMs: number, nowMs: number): string {
  const elapsedMs = nowMs - startTimeMs;
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
function formatRelativeTime(date: Date, nowMs: number): string {
  const diffMs = nowMs - date.getTime();
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
 * Format: {sanitized-title}-CU-{taskId} (title lowercase, CU uppercase)
 */
function generateBranchName(taskName: string, taskId: string): string {
  // Remove all characters except alphanumeric and spaces, then replace spaces with hyphens
  const sanitized = taskName
    .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special characters
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .toLowerCase();

  return `${sanitized}-CU-${taskId}`;
}

export function StatusIndicator({ status, nowMs }: StatusIndicatorProps) {
  const sampledIdleSeconds = status.currentIdleSeconds;
  const liveIdleSeconds =
    status.lastIdleSampledAtMs === null
      ? sampledIdleSeconds
      : sampledIdleSeconds +
        Math.max(0, Math.floor((nowMs - status.lastIdleSampledAtMs) / 1000));
  const timerDisplay =
    status.runningTaskStartMs && status.runningTaskStartMs > 0
      ? formatTimerDisplay(status.runningTaskStartMs, nowMs)
      : "--:--";
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
      <Card className="gap-0 py-0">
        {/* Large Timer */}
        <CardContent className="px-5 py-7 text-center">
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
                <div className="mx-auto flex max-w-full items-center justify-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--success)] animate-pulse" />
                  <span className="min-w-0 max-w-[250px] truncate text-sm font-medium">
                    {status.runningTaskName}
                  </span>
                  {canCopyBranch && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyBranch}
                      className="h-7 px-2 text-[10px]"
                      title="Copy git branch name"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-[var(--success)]" />
                          <span className="text-[var(--success)]">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy git branch</span>
                        </>
                      )}
                    </Button>
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
                        className="border-[var(--success)]/80 px-1.5 py-0 text-[10px] text-[var(--success)]"
                      >
                        BILLABLE
                      </Badge>
                    )}
                    {status.runningTimerTags.map((tag) => (
                      <Badge
                        key={tag.name}
                        variant="secondary"
                        className="inline-flex items-center px-1.5 py-0 text-[10px] font-medium uppercase tracking-wider"
                        style={{
                          backgroundColor: tag.tag_bg || "#555",
                          color: "#fff",
                        }}
                      >
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground tracking-wide">
                No timer running
              </span>
            )}
          </div>
        </CardContent>

        {/* Status Bar */}
        <Separator />
        <CardFooter className="justify-between px-5 py-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="brutalist-label">Idle</span>
            <span className="font-mono-display font-semibold tabular-nums">
              {formatDuration(liveIdleSeconds)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="brutalist-label">Monitor</span>
            <span
              className={`font-mono-display font-semibold ${
                status.isRunning ? "text-[var(--success)]" : "text-muted-foreground"
              }`}
            >
              {status.isRunning ? "ON" : "OFF"}
            </span>
          </div>
        </CardFooter>
      </Card>

      {/* Last Stopped - Compact One-liner */}
      {status.lastStoppedAt && status.lastStoppedTaskName && (
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span className="truncate max-w-[200px]">
            Last: "{status.lastStoppedTaskName}"
          </span>
          <span className="shrink-0 ml-2">
            {formatRelativeTime(status.lastStoppedAt, nowMs)}
          </span>
        </div>
      )}

      {/* Error Display */}
      {status.error && (
        <Alert variant="destructive">
          <AlertDescription className="font-mono-display">
            {status.error}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
