/**
 * Hook for automatic app updates.
 *
 * Checks for updates on startup and every hour, automatically downloads
 * and installs updates, then restarts the app.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Update check interval in milliseconds (1 hour) */
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export interface UseUpdaterResult {
  /** Whether an update check is in progress */
  isChecking: boolean;
  /** Whether an update is being downloaded/installed */
  isUpdating: boolean;
  /** Information about available update, if any */
  updateInfo: UpdateInfo | null;
  /** Download progress */
  progress: UpdateProgress | null;
  /** Error message if update check/install failed */
  error: string | null;
  /** Current app version */
  currentVersion: string;
  /** Manually trigger an update check */
  checkForUpdates: () => Promise<void>;
  /** Status message for UI */
  statusMessage: string;
}

export function useUpdater(): UseUpdaterResult {
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState("0.0.0");
  const [statusMessage, setStatusMessage] = useState("Ready");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isUpdatingRef = useRef(false);

  // Get current version from Tauri
  useEffect(() => {
    import("@tauri-apps/api/app").then(({ getVersion }) => {
      getVersion().then(setCurrentVersion).catch(console.error);
    });
  }, []);

  const performUpdate = useCallback(async (update: Update) => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;
    setIsUpdating(true);
    setError(null);

    try {
      let downloaded = 0;

      setStatusMessage(`Downloading v${update.version}...`);

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setProgress({
              downloaded: 0,
              total: event.data.contentLength ?? null,
            });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setProgress((prev) => ({
              downloaded,
              total: prev?.total ?? null,
            }));
            break;
          case "Finished":
            setProgress(null);
            break;
        }
      });

      setStatusMessage("Update installed, restarting...");

      // Small delay to show the message before restart
      await new Promise((resolve) => setTimeout(resolve, 500));
      await relaunch();
    } catch (err) {
      console.error("Update failed:", err);
      setError(err instanceof Error ? err.message : String(err));
      setStatusMessage("Update failed");
      setIsUpdating(false);
      isUpdatingRef.current = false;
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (isChecking || isUpdatingRef.current) return;

    setIsChecking(true);
    setError(null);
    setStatusMessage("Checking for updates...");

    try {
      const update = await check();

      if (update) {
        console.log(
          `Update available: ${update.version} (current: ${update.currentVersion})`
        );

        setUpdateInfo({
          version: update.version,
          currentVersion: update.currentVersion,
          body: update.body ?? undefined,
          date: update.date ?? undefined,
        });

        setStatusMessage(`Update available: v${update.version}`);
        setIsChecking(false);

        // Auto-download and install
        await performUpdate(update);
      } else {
        console.log("No update available");
        setUpdateInfo(null);
        setStatusMessage("You're up to date");
        setIsChecking(false);
      }
    } catch (err) {
      console.error("Update check failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatusMessage("Update check failed");
      setIsChecking(false);
    }
  }, [isChecking, performUpdate]);

  // Check for updates on mount and set up interval
  useEffect(() => {
    // Initial check after a short delay to let the app settle
    const initialTimeout = setTimeout(() => {
      checkForUpdates();
    }, 3000);

    // Set up hourly check interval
    intervalRef.current = setInterval(() => {
      checkForUpdates();
    }, UPDATE_CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [checkForUpdates]);

  return {
    isChecking,
    isUpdating,
    updateInfo,
    progress,
    error,
    currentVersion,
    checkForUpdates,
    statusMessage,
  };
}
