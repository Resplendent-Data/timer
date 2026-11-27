/**
 * Unified formatting helpers for durations, clocks, timestamps, and git branches.
 */

import type { TaskSearchResult } from "@/types/timer";

/** Format milliseconds elapsed into a live chronometer readout (HH:MM:SS or MM:SS). */
export function formatClock(elapsedMs: number): string {
  const safeMs = Math.max(0, elapsedMs);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

/** Format seconds into human-readable duration (e.g. "1h 24m", "12m", "42s"). */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/** Format seconds into compact duration showing "0m" for sub-minute totals (for charts). */
export function formatChartDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return "0m";
  return formatDuration(safe);
}

/** Format seconds into idle readout with seconds precision under 1h (e.g. "2m 15s"). */
export function formatIdleDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const remSeconds = safe % 60;
  if (minutes < 60) {
    return remSeconds > 0 ? `${minutes}m ${remSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

/** Format minutes (float) into human-readable string (e.g. "38m", "1h 15m", or "--"). */
export function formatMinutes(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "--";
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = Math.floor(mins / 60);
  const minutes = Math.round(mins % 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Format fractional hours cleanly (e.g. "8h" or "3.4h"). */
export function formatHours(hours: number): string {
  const rounded = Math.round(Math.max(0, hours) * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}h` : `${rounded.toFixed(1)}h`;
}

/** Format epoch milliseconds into local wall-clock time (e.g. "1:42 PM"). */
export function formatTimeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Convert epoch ms to HH:MM 24h value for <input type="time">. */
export function toTimeInputValue(ms: number): string {
  const d = new Date(ms);
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Apply an HH:MM time input value onto the same calendar day as `baseMs`. */
export function applyTimeInputToMs(baseMs: number, hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!match) return null;
  const next = new Date(baseMs);
  next.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
  return next.getTime();
}

/** Format relative time from an epoch ms timestamp. */
export function formatRelativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const diffSecs = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSecs < 60) return "just now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffHours < 48) return "yesterday";
  return new Date(timestampMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Generate a git-safe branch name from a ClickUp task title and ID. */
export function generateGitBranchName(taskName: string, taskId: string): string {
  const sanitized = taskName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${sanitized}-CU-${taskId}`;
}

/** Build a compact Space / Folder / List breadcrumb for a ClickUp task. */
export function buildProjectPath(task: TaskSearchResult): string {
  const parts: string[] = [];
  if (task.space_name) parts.push(task.space_name);
  if (task.folder_name) parts.push(task.folder_name);
  if (task.list_name) parts.push(task.list_name);
  return parts.join(" / ");
}

/** Return local start of today in epoch ms. */
export function getStartOfTodayMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Return local start of ISO week (Monday 00:00) in epoch ms. */
export function getStartOfWeekMs(nowMs: number): number {
  const d = new Date(nowMs);
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
