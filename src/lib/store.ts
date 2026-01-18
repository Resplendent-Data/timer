/**
 * Secure storage wrapper using Tauri's plugin-store.
 *
 * Provides type-safe access to application settings stored in an
 * encrypted JSON file managed by Tauri.
 */

import { LazyStore } from "@tauri-apps/plugin-store";

// Use LazyStore which handles initialization on first access
const store = new LazyStore("settings.json");

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

  // Return null if required fields are not set
  if (!apiKey || !teamId) {
    return null;
  }

  return {
    clickupApiKey: apiKey,
    clickupTeamId: teamId,
    idleThresholdMinutes: threshold ?? 10,
    noTimerWarningEnabled: noTimerWarningEnabled ?? true,
    noTimerWarningMinutes: noTimerWarningMinutes ?? 10,
    noTimerWarningRepeat: noTimerWarningRepeat ?? false,
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
