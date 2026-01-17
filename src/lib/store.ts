/**
 * Secure storage wrapper using Tauri's plugin-store.
 *
 * Provides type-safe access to application settings stored in an
 * encrypted JSON file managed by Tauri.
 */

import { Store } from "@tauri-apps/plugin-store";

// Create a singleton store instance
let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load("settings.json");
  }
  return storeInstance;
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
}

/**
 * Get all application settings.
 *
 * @returns The current settings, or null if not configured
 */
export async function getSettings(): Promise<AppSettings | null> {
  const store = await getStore();

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
  const store = await getStore();

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
  const store = await getStore();
  await store.clear();
  await store.save();
}
