/**
 * Secure storage wrapper using Tauri's plugin-store.
 *
 * Preserves full backward compatibility with existing `settings.json` keys while
 * adding smart backdating and post-stop wrap-up preferences.
 */

import { emit } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { DEFAULT_WORK_DAYS, normalizeWorkdays } from "./workSchedule";

const store = new LazyStore("settings.json");

export { DEFAULT_WORK_DAYS };
export const DEFAULT_EXPECTED_HOURS_PER_DAY = 8;
export const DEFAULT_MIN_BACKDATE_MINUTES = 2;
export const DEFAULT_MAX_BACKDATE_MINUTES = 120;
export const SETTINGS_UPDATED_EVENT = "settings-updated";

export interface WidgetPosition {
  x: number;
  y: number;
}

export interface AppSettings {
  /** ClickUp API key (pk_...) */
  clickupApiKey: string;
  /** ClickUp team/workspace ID */
  clickupTeamId: string;
  /** Minutes of inactivity before auto-stopping timer */
  idleThresholdMinutes: number;
  /** Automatically backdate timer start to continuous untracked active time */
  autoBackdateEnabled: boolean;
  /** Minimum continuous active minutes before backdating activates */
  minBackdateMinutes: number;
  /** Maximum lookback window (minutes) for automatic backdating */
  maxBackdateMinutes: number;
  /** Open the Session Wrap-Up sheet after manually stopping a timer */
  promptDescriptionOnStop: boolean;
  /** Whether to warn when no timer is running */
  noTimerWarningEnabled: boolean;
  /** Minutes of activity without a timer before warning */
  noTimerWarningMinutes: number;
  /** Whether to repeat the warning at intervals (vs once per session) */
  noTimerWarningRepeat: boolean;
  /** Whether repeated no-timer warnings should only fire during work hours */
  noTimerWarningRepeatOnlyDuringWorkHours: boolean;
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
  /** Daily expected tracked hours used for progress targets */
  expectedHoursPerDay: number;
  /** GitHub Personal Access Token for PR counts (optional) */
  githubToken?: string;
  /** GitHub username for PR counts (optional) */
  githubUsername?: string;
}

export interface RecentTask {
  id: string;
  name: string;
  projectPath?: string;
  lastUsedAt: number;
}

const MAX_RECENT_TASKS = 6;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  clickupApiKey: "",
  clickupTeamId: "",
  idleThresholdMinutes: 10,
  autoBackdateEnabled: true,
  minBackdateMinutes: DEFAULT_MIN_BACKDATE_MINUTES,
  maxBackdateMinutes: DEFAULT_MAX_BACKDATE_MINUTES,
  promptDescriptionOnStop: true,
  noTimerWarningEnabled: true,
  noTimerWarningMinutes: 10,
  noTimerWarningRepeat: false,
  noTimerWarningRepeatOnlyDuringWorkHours: true,
  meetingDetectionEnabled: false,
  widgetEnabled: false,
  workdayStart: "08:00",
  workdayEnd: "17:00",
  workdays: [...DEFAULT_WORK_DAYS],
  expectedHoursPerDay: DEFAULT_EXPECTED_HOURS_PER_DAY,
  githubToken: "",
  githubUsername: "",
};

export async function getSettings(): Promise<AppSettings | null> {
  const apiKey = await store.get<string>("clickupApiKey");
  const teamId = await store.get<string>("clickupTeamId");

  if (!apiKey || !teamId) {
    return null;
  }

  const [
    threshold,
    autoBackdateEnabled,
    minBackdateMinutes,
    maxBackdateMinutes,
    promptDescriptionOnStop,
    noTimerWarningEnabled,
    noTimerWarningMinutes,
    noTimerWarningRepeat,
    noTimerWarningRepeatOnlyDuringWorkHours,
    meetingDetectionEnabled,
    widgetEnabled,
    workdayStart,
    workdayEnd,
    workdays,
    expectedHoursPerDay,
    githubToken,
    githubUsername,
  ] = await Promise.all([
    store.get<number>("idleThresholdMinutes"),
    store.get<boolean>("autoBackdateEnabled"),
    store.get<number>("minBackdateMinutes"),
    store.get<number>("maxBackdateMinutes"),
    store.get<boolean>("promptDescriptionOnStop"),
    store.get<boolean>("noTimerWarningEnabled"),
    store.get<number>("noTimerWarningMinutes"),
    store.get<boolean>("noTimerWarningRepeat"),
    store.get<boolean>("noTimerWarningRepeatOnlyDuringWorkHours"),
    store.get<boolean>("meetingDetectionEnabled"),
    store.get<boolean>("widgetEnabled"),
    store.get<string>("workdayStart"),
    store.get<string>("workdayEnd"),
    store.get<number[]>("workdays"),
    store.get<number>("expectedHoursPerDay"),
    store.get<string>("githubToken"),
    store.get<string>("githubUsername"),
  ]);

  return {
    clickupApiKey: apiKey,
    clickupTeamId: teamId,
    idleThresholdMinutes: threshold ?? 10,
    autoBackdateEnabled: autoBackdateEnabled ?? true,
    minBackdateMinutes: minBackdateMinutes ?? DEFAULT_MIN_BACKDATE_MINUTES,
    maxBackdateMinutes: maxBackdateMinutes ?? DEFAULT_MAX_BACKDATE_MINUTES,
    promptDescriptionOnStop: promptDescriptionOnStop ?? true,
    noTimerWarningEnabled: noTimerWarningEnabled ?? true,
    noTimerWarningMinutes: noTimerWarningMinutes ?? 10,
    noTimerWarningRepeat: noTimerWarningRepeat ?? false,
    noTimerWarningRepeatOnlyDuringWorkHours:
      noTimerWarningRepeatOnlyDuringWorkHours ?? true,
    meetingDetectionEnabled: meetingDetectionEnabled ?? false,
    widgetEnabled: widgetEnabled ?? false,
    workdayStart: workdayStart ?? "08:00",
    workdayEnd: workdayEnd ?? "17:00",
    workdays: normalizeWorkdays(workdays),
    expectedHoursPerDay: expectedHoursPerDay ?? DEFAULT_EXPECTED_HOURS_PER_DAY,
    githubToken: githubToken ?? undefined,
    githubUsername: githubUsername ?? undefined,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await store.set("clickupApiKey", settings.clickupApiKey.trim());
  await store.set("clickupTeamId", settings.clickupTeamId.trim());
  await store.set("idleThresholdMinutes", settings.idleThresholdMinutes);
  await store.set("autoBackdateEnabled", settings.autoBackdateEnabled);
  await store.set("minBackdateMinutes", settings.minBackdateMinutes);
  await store.set("maxBackdateMinutes", settings.maxBackdateMinutes);
  await store.set("promptDescriptionOnStop", settings.promptDescriptionOnStop);
  await store.set("noTimerWarningEnabled", settings.noTimerWarningEnabled);
  await store.set("noTimerWarningMinutes", settings.noTimerWarningMinutes);
  await store.set("noTimerWarningRepeat", settings.noTimerWarningRepeat);
  await store.set(
    "noTimerWarningRepeatOnlyDuringWorkHours",
    settings.noTimerWarningRepeatOnlyDuringWorkHours
  );
  await store.set("meetingDetectionEnabled", settings.meetingDetectionEnabled);
  await store.set("widgetEnabled", settings.widgetEnabled);
  await store.set("workdayStart", settings.workdayStart);
  await store.set("workdayEnd", settings.workdayEnd);
  await store.set("workdays", normalizeWorkdays(settings.workdays));
  await store.set("expectedHoursPerDay", settings.expectedHoursPerDay);
  await store.set("githubToken", settings.githubToken?.trim() ?? "");
  await store.set("githubUsername", settings.githubUsername?.trim() ?? "");
  await store.save();
  await emit(SETTINGS_UPDATED_EVENT);
}

export async function isConfigured(): Promise<boolean> {
  const settings = await getSettings();
  return settings !== null;
}

export async function clearSettings(): Promise<void> {
  await store.clear();
  await store.save();
  await emit(SETTINGS_UPDATED_EVENT);
}

export async function getRecentTasks(): Promise<RecentTask[]> {
  try {
    const tasks = await store.get<RecentTask[]>("recentTasks");
    return tasks ?? [];
  } catch (err) {
    console.error("[store] Error getting recent tasks:", err);
    return [];
  }
}

export async function addRecentTask(
  task: Omit<RecentTask, "lastUsedAt">
): Promise<RecentTask[]> {
  try {
    const existing = await getRecentTasks();
    const filtered = existing.filter((t) => t.id !== task.id);
    const updated: RecentTask[] = [
      {
        id: task.id,
        name: task.name,
        projectPath: task.projectPath,
        lastUsedAt: Date.now(),
      },
      ...filtered,
    ].slice(0, MAX_RECENT_TASKS);

    await store.set("recentTasks", updated);
    await store.save();
    return updated;
  } catch (err) {
    console.error("[store] Error adding recent task:", err);
    return [];
  }
}

export async function removeRecentTask(taskId: string): Promise<RecentTask[]> {
  const existing = await getRecentTasks();
  const filtered = existing.filter((t) => t.id !== taskId);
  await store.set("recentTasks", filtered);
  await store.save();
  return filtered;
}

export async function getWidgetPosition(): Promise<WidgetPosition | null> {
  try {
    const position = await store.get<WidgetPosition>("widgetPosition");
    return position ?? null;
  } catch (err) {
    console.error("[store] Error getting widget position:", err);
    return null;
  }
}

export async function saveWidgetPosition(position: WidgetPosition): Promise<void> {
  try {
    if (position.x >= 0 && position.x < 5000 && position.y >= 0 && position.y < 2000) {
      await store.set("widgetPosition", position);
      await store.save();
    }
  } catch (err) {
    console.error("[store] Error saving widget position:", err);
  }
}

export async function clearWidgetPosition(): Promise<void> {
  try {
    await store.delete("widgetPosition");
    await store.save();
  } catch (err) {
    console.error("[store] Error clearing widget position:", err);
  }
}

export async function getLastUpdateCheckAt(): Promise<number | null> {
  try {
    const timestamp = await store.get<number>("lastUpdateCheckAt");
    return typeof timestamp === "number" ? timestamp : null;
  } catch (err) {
    console.error("[store] Error getting last update check timestamp:", err);
    return null;
  }
}

export async function setLastUpdateCheckAt(timestamp: number): Promise<void> {
  try {
    await store.set("lastUpdateCheckAt", timestamp);
    await store.save();
  } catch (err) {
    console.error("[store] Error saving last update check timestamp:", err);
  }
}
