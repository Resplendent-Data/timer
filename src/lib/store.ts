/**
 * Secure storage wrapper using Tauri's plugin-store.
 *
 * Provides type-safe access to application settings stored in an
 * encrypted JSON file managed by Tauri.
 */

import { LazyStore } from "@tauri-apps/plugin-store";

// Use LazyStore which handles initialization on first access
const store = new LazyStore("settings.json");
export const DEFAULT_WORK_DAYS: number[] = [0, 1, 2, 3, 4];

function normalizeWorkdays(days: number[] | null | undefined): number[] {
  if (!Array.isArray(days)) return [...DEFAULT_WORK_DAYS];
  const normalized = Array.from(
    new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
  ).sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [...DEFAULT_WORK_DAYS];
}

/**
 * Widget position for the always-on-top timer widget.
 */
export interface WidgetPosition {
  x: number;
  y: number;
}

/**
 * Application settings stored securely.
 */
export interface AppSettings {
  /** ClickUp API key (pk_...) */
  clickupApiKey: string;
  /** ClickUp team/workspace ID */
  clickupTeamId: string;
  /** Minutes of inactivity before stopping timer */
  idleThresholdMinutes: number;
  /** Whether to warn when no timer is running */
  noTimerWarningEnabled: boolean;
  /** Minutes of activity without a timer before warning */
  noTimerWarningMinutes: number;
  /** Whether to repeat the warning at intervals (vs once per session) */
  noTimerWarningRepeat: boolean;
  /** Whether to detect meetings and prompt for meeting-mode timer */
  meetingDetectionEnabled: boolean;
  /** Whether to show the always-on-top timer widget */
  widgetEnabled: boolean;
  /** Workday start in 24h format (HH:MM), local time */
  workdayStart: string;
  /** Workday end in 24h format (HH:MM), local time */
  workdayEnd: string;
  /** Workdays as 0-6 (Mon-Sun) */
  workdays: number[];
}

/**
 * A recent task for quick access.
 */
export interface RecentTask {
  id: string;
  name: string;
  /** Optional project path for display */
  projectPath?: string;
  /** Timestamp when this task was last started */
  lastUsedAt: number;
}

const MAX_RECENT_TASKS = 5;

/**
 * Get all application settings.
 *
 * @returns The current settings, or null if not configured
 */
export async function getSettings(): Promise<AppSettings | null> {
  const apiKey = await store.get<string>("clickupApiKey");
  const teamId = await store.get<string>("clickupTeamId");
  const threshold = await store.get<number>("idleThresholdMinutes");
  const noTimerWarningEnabled = await store.get<boolean>("noTimerWarningEnabled");
  const noTimerWarningMinutes = await store.get<number>("noTimerWarningMinutes");
  const noTimerWarningRepeat = await store.get<boolean>("noTimerWarningRepeat");
  const meetingDetectionEnabled = await store.get<boolean>("meetingDetectionEnabled");
  const workdayStart = await store.get<string>("workdayStart");
  const workdayEnd = await store.get<string>("workdayEnd");
  const workdays = await store.get<number[]>("workdays");

  // Return null if required fields are not set
  if (!apiKey || !teamId) {
    return null;
  }

  const widgetEnabled = await store.get<boolean>("widgetEnabled");

  return {
    clickupApiKey: apiKey,
    clickupTeamId: teamId,
    idleThresholdMinutes: threshold ?? 10,
    noTimerWarningEnabled: noTimerWarningEnabled ?? true,
    noTimerWarningMinutes: noTimerWarningMinutes ?? 10,
    noTimerWarningRepeat: noTimerWarningRepeat ?? false,
    meetingDetectionEnabled: meetingDetectionEnabled ?? false,
    widgetEnabled: widgetEnabled ?? false,
    workdayStart: workdayStart ?? "08:00",
    workdayEnd: workdayEnd ?? "17:00",
    workdays: normalizeWorkdays(workdays),
  };
}

/**
 * Save application settings.
 *
 * @param settings - The settings to save
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  await store.set("clickupApiKey", settings.clickupApiKey);
  await store.set("clickupTeamId", settings.clickupTeamId);
  await store.set("idleThresholdMinutes", settings.idleThresholdMinutes);
  await store.set("noTimerWarningEnabled", settings.noTimerWarningEnabled);
  await store.set("noTimerWarningMinutes", settings.noTimerWarningMinutes);
  await store.set("noTimerWarningRepeat", settings.noTimerWarningRepeat);
  await store.set("meetingDetectionEnabled", settings.meetingDetectionEnabled);
  await store.set("widgetEnabled", settings.widgetEnabled);
  await store.set("workdayStart", settings.workdayStart);
  await store.set("workdayEnd", settings.workdayEnd);
  await store.set("workdays", normalizeWorkdays(settings.workdays));
  await store.save();
}

/**
 * Check if the application has been configured with required settings.
 *
 * @returns true if all required settings are present
 */
export async function isConfigured(): Promise<boolean> {
  const settings = await getSettings();
  return settings !== null;
}

/**
 * Clear all stored settings.
 */
export async function clearSettings(): Promise<void> {
  await store.clear();
  await store.save();
}

/**
 * Get the list of recent tasks.
 *
 * @returns Array of recent tasks, sorted by most recently used first
 */
export async function getRecentTasks(): Promise<RecentTask[]> {
  try {
    const tasks = await store.get<RecentTask[]>("recentTasks");
    console.log("[store] getRecentTasks:", tasks);
    return tasks ?? [];
  } catch (err) {
    console.error("[store] Error getting recent tasks:", err);
    return [];
  }
}

/**
 * Add a task to the recent tasks list.
 * If the task already exists, it will be moved to the front.
 * Maintains a maximum of MAX_RECENT_TASKS entries.
 *
 * @param task - The task to add
 */
export async function addRecentTask(task: Omit<RecentTask, "lastUsedAt">): Promise<void> {
  console.log("[store] addRecentTask:", task);
  try {
    const existing = await getRecentTasks();

    // Remove if already exists (we'll add it to the front)
    const filtered = existing.filter((t) => t.id !== task.id);

    // Add new task at the front
    const updated: RecentTask[] = [
      {
        id: task.id,
        name: task.name,
        projectPath: task.projectPath,
        lastUsedAt: Date.now(),
      },
      ...filtered,
    ].slice(0, MAX_RECENT_TASKS);

    console.log("[store] Saving recent tasks:", updated);
    await store.set("recentTasks", updated);
    await store.save();
    console.log("[store] Recent tasks saved successfully");
  } catch (err) {
    console.error("[store] Error adding recent task:", err);
  }
}

/**
 * Remove a task from the recent tasks list.
 *
 * @param taskId - The ID of the task to remove
 */
export async function removeRecentTask(taskId: string): Promise<void> {
  const existing = await getRecentTasks();
  const filtered = existing.filter((t) => t.id !== taskId);
  await store.set("recentTasks", filtered);
  await store.save();
}

/**
 * Get the saved widget position.
 *
 * @returns The widget position, or null if not saved
 */
export async function getWidgetPosition(): Promise<WidgetPosition | null> {
  try {
    const position = await store.get<WidgetPosition>("widgetPosition");
    return position ?? null;
  } catch (err) {
    console.error("[store] Error getting widget position:", err);
    return null;
  }
}

/**
 * Save the widget position.
 *
 * @param position - The position to save
 */
export async function saveWidgetPosition(position: WidgetPosition): Promise<void> {
  try {
    // Only save if position is reasonable (on screen)
    if (position.x >= 0 && position.x < 5000 && position.y >= 0 && position.y < 2000) {
      await store.set("widgetPosition", position);
      await store.save();
    }
  } catch (err) {
    console.error("[store] Error saving widget position:", err);
  }
}

/**
 * Clear the saved widget position.
 */
export async function clearWidgetPosition(): Promise<void> {
  try {
    await store.delete("widgetPosition");
    await store.save();
  } catch (err) {
    console.error("[store] Error clearing widget position:", err);
  }
}

/**
 * Get just the widget enabled setting without requiring full config.
 * This is used during app startup to determine if we should show the widget.
 *
 * @returns Whether the widget is enabled
 */
export async function isWidgetEnabled(): Promise<boolean> {
  try {
    const enabled = await store.get<boolean>("widgetEnabled");
    return enabled ?? false;
  } catch {
    return false;
  }
}
