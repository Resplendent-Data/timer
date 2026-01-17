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
    <div className="status-indicator">
      <h2>Status</h2>

      {/* Monitoring Status */}
      <div className="status-indicator__item">
        <span className="status-indicator__label">Monitoring</span>
        <span
          className={`status-indicator__value status-indicator__value--${
            status.isRunning ? "active" : "inactive"
          }`}
        >
          {status.isRunning ? "Active" : "Inactive"}
        </span>
      </div>

      {/* Current Idle Time */}
      <div className="status-indicator__item status-indicator__item--idle">
        <span className="status-indicator__label">Idle Time</span>
        <span className="status-indicator__value status-indicator__value--large">
          {formatDuration(idleSeconds)}
        </span>
      </div>

      {/* Running Timer */}
      <div className="status-indicator__item">
        <span className="status-indicator__label">Running Timer</span>
        <span
          className={`status-indicator__value ${
            status.runningTaskName
              ? "status-indicator__value--task"
              : "status-indicator__value--none"
          }`}
        >
          {status.runningTaskName || "No timer running"}
        </span>
      </div>

      {/* Elapsed Time (only show when timer is running) */}
      {status.runningTaskName && elapsedTime && (
        <div className="status-indicator__item status-indicator__item--elapsed">
          <span className="status-indicator__label">Elapsed</span>
          <span className="status-indicator__value status-indicator__value--elapsed">
            {elapsedTime}
          </span>
        </div>
      )}

      {/* Last Stopped */}
      {status.lastStoppedAt && status.lastStoppedTaskName && (
        <div className="status-indicator__item status-indicator__item--stopped">
          <span className="status-indicator__label">Last Stopped</span>
          <span className="status-indicator__value">
            "{status.lastStoppedTaskName}"
            <br />
            <small>{formatRelativeTime(status.lastStoppedAt)}</small>
          </span>
        </div>
      )}

      {/* Error Display */}
      {status.error && (
        <div className="status-indicator__error">
          <strong>Error:</strong> {status.error}
        </div>
      )}
    </div>
  );
}
