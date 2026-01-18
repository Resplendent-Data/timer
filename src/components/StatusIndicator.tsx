/**
 * Status indicator component showing current idle time and timer status.
 *
 * Displays:
 * - Current idle time (real-time)
 * - Currently running ClickUp timer (if any)
 * - Elapsed time on the running timer
 * - Last stopped timer information
 * - Any errors
 */

import { useEffect, useState } from "react";
import { IdleStatus, useIdleTime } from "../hooks/useIdleChecker";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
 * Format milliseconds into a human-readable elapsed time string.
 */
function formatElapsedTime(startTimeMs: number): string {
  const now = Date.now();
  const elapsedMs = now - startTimeMs;
  const elapsedSecs = Math.floor(elapsedMs / 1000);
  return formatDuration(elapsedSecs);
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
    return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  }
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  }
  return date.toLocaleDateString();
}

/**
 * Hook to get live elapsed time from a start timestamp.
 */
function useElapsedTime(startTimeMs: number | null): string | null {
  const [elapsed, setElapsed] = useState<string | null>(null);

  useEffect(() => {
    if (startTimeMs === null || startTimeMs === 0) {
      setElapsed(null);
      return;
    }

    // Update immediately
    setElapsed(formatElapsedTime(startTimeMs));

    // Update every second
    const interval = setInterval(() => {
      setElapsed(formatElapsedTime(startTimeMs));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTimeMs]);

  return elapsed;
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  // Get real-time idle updates
  const { idleSeconds } = useIdleTime();
  // Get live elapsed time for running timer
  const elapsedTime = useElapsedTime(status.runningTaskStartMs);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Status</h2>

      {/* Monitoring Status */}
      <Card>
        <CardContent className="flex items-center justify-between py-3">
          <span className="text-sm font-medium">Monitoring</span>
          <Badge variant={status.isRunning ? "default" : "secondary"}>
            {status.isRunning ? "Active" : "Inactive"}
          </Badge>
        </CardContent>
      </Card>

      {/* Current Idle Time */}
      <Card className="bg-primary text-primary-foreground">
        <CardContent className="flex items-center justify-between py-3">
          <span className="text-sm font-medium">Idle Time</span>
          <span className="text-2xl font-bold tabular-nums">
            {formatDuration(idleSeconds)}
          </span>
        </CardContent>
      </Card>

      {/* Running Timer */}
      <Card>
        <CardContent className="flex items-center justify-between py-3">
          <span className="text-sm font-medium">Running Timer</span>
          <span
            className={
              status.runningTaskName
                ? "text-sm font-medium text-primary"
                : "text-sm text-muted-foreground italic"
            }
          >
            {status.runningTaskName || "No timer running"}
          </span>
        </CardContent>
      </Card>

      {/* Elapsed Time (only show when timer is running) */}
      {status.runningTaskName && elapsedTime && (
        <Card className="bg-emerald-600 text-white dark:bg-emerald-700">
          <CardContent className="flex items-center justify-between py-3">
            <span className="text-sm font-medium">Elapsed</span>
            <span className="text-xl font-bold tabular-nums">{elapsedTime}</span>
          </CardContent>
        </Card>
      )}

      {/* Last Stopped */}
      {status.lastStoppedAt && status.lastStoppedTaskName && (
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Last Stopped</span>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(status.lastStoppedAt)}
              </span>
            </div>
            <p className="text-sm mt-1 text-muted-foreground">
              "{status.lastStoppedTaskName}"
            </p>
          </CardContent>
        </Card>
      )}

      {/* Error Display */}
      {status.error && (
        <Card className="bg-destructive/10 border-destructive">
          <CardContent className="py-3">
            <p className="text-sm text-destructive">
              <strong>Error:</strong> {status.error}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
