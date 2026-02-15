/**
 * Hook for automatic app updates.
 *
 * Checks for updates on startup and every hour, automatically downloads
 * and installs updates, then restarts the app.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getLastUpdateCheckAt, setLastUpdateCheckAt } from "../lib/store";

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
  /** Timestamp of the last time an update check was started */
  lastCheckedAt: number | null;
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
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("You're up to date");

  const isUpdatingRef = useRef(false);
  const isCheckingRef = useRef(false);
  const hasCheckedRef = useRef(false);

  // Get current version from Tauri
  useEffect(() => {
    import("@tauri-apps/api/app").then(({ getVersion }) => {
      getVersion().then(setCurrentVersion).catch(console.error);
    });
  }, []);

  useEffect(() => {
    getLastUpdateCheckAt().then(setLastCheckedAt).catch(console.error);
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

  const doCheck = useCallback(
    async (isManual: boolean) => {
      if (isCheckingRef.current || isUpdatingRef.current) return;

      isCheckingRef.current = true;
      if (isManual) {
        setIsChecking(true);
        setStatusMessage("Checking for updates...");
      }
      setError(null);
      const checkedAt = Date.now();
      setLastCheckedAt(checkedAt);
      void setLastUpdateCheckAt(checkedAt);

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
          isCheckingRef.current = false;

          // Auto-download and install
          await performUpdate(update);
        } else {
          console.log("No update available");
          setUpdateInfo(null);
          setStatusMessage("You're up to date");
          setIsChecking(false);
          isCheckingRef.current = false;
        }
      } catch (err) {
        console.error("Update check failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatusMessage("Update check failed");
        setIsChecking(false);
        isCheckingRef.current = false;
      }
    },
    [performUpdate]
  );

  // Manual check wrapper
  const checkForUpdates = useCallback(() => {
    return doCheck(true);
  }, [doCheck]);

  // Check for updates on mount and set up interval (runs once)
  useEffect(() => {
    // Prevent double-checking in React strict mode
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    // Initial check after a short delay to let the app settle
    const initialTimeout = setTimeout(() => {
      doCheck(false);
    }, 3000);

    // Set up hourly check interval
    const intervalId = setInterval(() => {
      doCheck(false);
    }, UPDATE_CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isChecking,
    isUpdating,
    updateInfo,
    progress,
    error,
    currentVersion,
    lastCheckedAt,
    checkForUpdates,
    statusMessage,
  };
}
