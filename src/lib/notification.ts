/**
 * Cross-platform notification utility.
 *
 * On macOS: Uses the Tauri notification plugin
 * On Linux: Uses notify-send via a Rust command (workaround for GNOME 46+ bug)
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
  // Linux uses notify-send which doesn't require permission
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
 * On Linux: Uses notify-send command via Rust backend
 * On macOS/Windows: Uses Tauri notification plugin
 */
export async function sendNotification(
  options: NotificationOptions
): Promise<void> {
  if (isLinux()) {
    // Use notify-send on Linux (workaround for GNOME 46+ bug)
    try {
      await invoke("send_notification_linux", {
        title: options.title,
        body: options.body,
      });
    } catch (error) {
      console.error("Failed to send Linux notification:", error);
    }
    return;
  }

  // macOS/Windows: Use Tauri plugin
  const permissionGranted = await checkNotificationPermission();
  if (permissionGranted) {
    tauriSendNotification({
      title: options.title,
      body: options.body,
    });
  }
}
