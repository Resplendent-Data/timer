/**
 * Cross-platform notification utility.
 *
 * On macOS: Uses the Tauri notification plugin
 * On Linux: Uses a Rust command that sends via D-Bus with notify-send fallback
 *
 * @see https://github.com/tauri-apps/plugins-workspace/issues/2566
 * @see https://github.com/hoodie/notify-rust/issues/218
 */

import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriSendNotification,
} from "@tauri-apps/plugin-notification";

interface NotificationOptions {
  title: string;
  body: string;
  extra?: Record<string, unknown>;
}

/**
 * Detect if we're running on Linux.
 * Uses navigator.platform as a simple heuristic.
 */
function isLinux(): boolean {
  return navigator.platform.toLowerCase().includes("linux");
}

/**
 * Check if notification permission is granted (or not needed on Linux).
 */
export async function checkNotificationPermission(): Promise<boolean> {
  // Linux notifications are sent via backend D-Bus call (no browser permission needed)
  if (isLinux()) {
    return true;
  }

  // macOS/Windows use Tauri plugin
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }
  return granted;
}

/**
 * Send a notification using the appropriate method for the platform.
 *
 * On Linux: Uses a Rust backend command (D-Bus + notify-send fallback)
 * On macOS/Windows: Uses Tauri notification plugin
 */
export async function sendNotification(
  options: NotificationOptions
): Promise<void> {
  if (isLinux()) {
    // Linux: use backend D-Bus path with notify-send fallback.
    try {
      await invoke("send_notification_linux", {
        title: options.title,
        body: options.body,
      });
    } catch (error) {
      console.error("Failed to send Linux notification:", error);
      // Best-effort fallback to plugin path on Linux versions where it still works.
      try {
        await tauriSendNotification({
          title: options.title,
          body: options.body,
          extra: options.extra,
        });
      } catch (pluginError) {
        console.error("Linux plugin notification fallback also failed:", pluginError);
      }
    }
    return;
  }

  // macOS/Windows: Use Tauri plugin
  const permissionGranted = await checkNotificationPermission();
  if (permissionGranted) {
    await tauriSendNotification({
      title: options.title,
      body: options.body,
      extra: options.extra,
    });
  }
}
