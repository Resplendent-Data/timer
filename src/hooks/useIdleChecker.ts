/**
 * React hook for monitoring user idle time and managing ClickUp timers.
 *
 * This hook runs a background check every minute to:
 * 1. Get the current idle time from the Rust backend
 * 2. If idle exceeds threshold, stop any running ClickUp timer
 * 3. Show a notification when a timer is stopped
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getSettings, addRecentTask } from "../lib/store";

/** Result returned from the Rust check_and_stop_timer command */
interface IdleCheckResult {
  stopped: boolean;
  task_name: string | null;
  task_id: string | null;
  idle_duration: number;
  error: string | null;
}

/** Info about the running timer from Rust */
interface RunningTimerInfo {
  name: string;
  task_id: string | null;
  start_time_ms: number;
}

/** Current status of the idle checker */
export interface IdleStatus {
  /** Whether the checker is running */
  isRunning: boolean;
  /** Current idle time in seconds */
  currentIdleSeconds: number;
  /** Name of the currently running task (if any) */
  runningTaskName: string | null;
  /** Start time of the running timer (for elapsed time calculation) */
  runningTaskStartMs: number | null;
  /** Last time a timer was stopped */
  lastStoppedAt: Date | null;
  /** Last stopped task name */
  lastStoppedTaskName: string | null;
  /** Last stopped task ID (for resume functionality) */
  lastStoppedTaskId: string | null;
  /** Error message if something went wrong */
  error: string | null;
  /** Last time we sent a "no timer" warning */
  lastNoTimerWarningAt: Date | null;
  /** Function to manually refresh the status */
  refresh: () => Promise<void>;
}

/**
 * Hook that monitors idle time and automatically stops ClickUp timers.
 *
 * @param checkIntervalMs - How often to check idle time (default: 60000ms = 1 minute)
 * @returns Current idle status
 */
export function useIdleChecker(checkIntervalMs: number = 60_000): IdleStatus {
  const intervalRef = useRef<number | null>(null);
  /** Timestamp (ms) when we last saw a running timer */
  const lastTimerSeenAtRef = useRef<number | null>(null);
  /** Timestamp (ms) when we last sent a "no timer" warning */
  const lastNoTimerWarningAtRef = useRef<number | null>(null);
  /** Task ID of the last running timer we added to recent tasks */
  const lastAddedTaskIdRef = useRef<string | null>(null);

  const [status, setStatus] = useState<IdleStatus>({
    isRunning: false,
    currentIdleSeconds: 0,
    runningTaskName: null,
    runningTaskStartMs: null,
    lastStoppedAt: null,
    lastStoppedTaskName: null,
    lastStoppedTaskId: null,
    error: null,
    lastNoTimerWarningAt: null,
    refresh: async () => {},
  });

  const checkIdle = useCallback(async () => {
    try {
      const settings = await getSettings();

      if (!settings) {
        setStatus((prev) => ({
          ...prev,
          error: "Not configured. Please add your ClickUp settings.",
        }));
        return;
      }

      // Calculate threshold in seconds
      const thresholdSecs = settings.idleThresholdMinutes * 60;

      // Call Rust backend to check idle and potentially stop timer
      const result = await invoke<IdleCheckResult>("check_and_stop_timer", {
        apiKey: settings.clickupApiKey,
        teamId: settings.clickupTeamId,
        idleThresholdSecs: thresholdSecs,
      });

      // Update status with current idle time
      setStatus((prev) => ({
        ...prev,
        isRunning: true,
        currentIdleSeconds: result.idle_duration,
        error: result.error,
      }));

      // If a timer was stopped, show notification and update state
      if (result.stopped && result.task_name) {
        // Check and request notification permission
        let permissionGranted = await isPermissionGranted();
        if (!permissionGranted) {
          const permission = await requestPermission();
          permissionGranted = permission === "granted";
        }

        if (permissionGranted) {
          const idleMinutes = Math.floor(result.idle_duration / 60);
          sendNotification({
            title: "Timer Stopped",
            body: `Timer stopped due to inactivity on "${result.task_name}" (idle for ${idleMinutes} minutes)`,
            sound: "default",
          });
        }

        setStatus((prev) => ({
          ...prev,
          lastStoppedAt: new Date(),
          lastStoppedTaskName: result.task_name,
          lastStoppedTaskId: result.task_id,
          runningTaskName: null,
          runningTaskStartMs: null,
        }));
      }

      // Also fetch current running timer info for display
      if (!result.stopped) {
        try {
          const timerInfo = await invoke<RunningTimerInfo | null>(
            "get_running_timer_info",
            {
              apiKey: settings.clickupApiKey,
              teamId: settings.clickupTeamId,
            }
          );

          const hasRunningTimer = timerInfo !== null;

          if (hasRunningTimer) {
            // Timer is running - update lastTimerSeenAt and reset warning state
            lastTimerSeenAtRef.current = Date.now();
            lastNoTimerWarningAtRef.current = null;

            // Add to recent tasks if this is a new task we haven't tracked yet
            // (only if task has a task_id - manual timers without tasks won't be added)
            if (timerInfo.task_id && timerInfo.task_id !== lastAddedTaskIdRef.current) {
              lastAddedTaskIdRef.current = timerInfo.task_id;
              console.log("[useIdleChecker] Adding running task to recent:", timerInfo.name);
              addRecentTask({
                id: timerInfo.task_id,
                name: timerInfo.name,
              }).catch((err) => {
                console.error("[useIdleChecker] Failed to add recent task:", err);
              });
            }
          } else {
            // No timer running - reset the last added task ID so we can add it again later
            lastAddedTaskIdRef.current = null;
          }

          setStatus((prev) => ({
            ...prev,
            runningTaskName: timerInfo?.name ?? null,
            runningTaskStartMs: timerInfo?.start_time_ms ?? null,
          }));

          // Check if we should warn about no timer running
          if (
            !hasRunningTimer &&
            settings.noTimerWarningEnabled
          ) {
            const now = Date.now();
            const warningThresholdMs = settings.noTimerWarningMinutes * 60 * 1000;
            
            // Consider user "active" if idle less than 2 minutes
            const isUserActive = result.idle_duration < 120;

            // Initialize lastTimerSeenAt if this is the first check with no timer
            if (lastTimerSeenAtRef.current === null) {
              lastTimerSeenAtRef.current = now;
            }

            const timeSinceLastTimer = now - lastTimerSeenAtRef.current;
            const timeSinceLastWarning = lastNoTimerWarningAtRef.current
              ? now - lastNoTimerWarningAtRef.current
              : Infinity;

            // Should we warn?
            // - User must be active (not idle)
            // - Time since last timer must exceed threshold
            // - Either: repeat is enabled OR we haven't warned yet this session
            const shouldWarn =
              isUserActive &&
              timeSinceLastTimer >= warningThresholdMs &&
              (settings.noTimerWarningRepeat
                ? timeSinceLastWarning >= warningThresholdMs
                : lastNoTimerWarningAtRef.current === null);

            if (shouldWarn) {
              // Check and request notification permission
              let permissionGranted = await isPermissionGranted();
              if (!permissionGranted) {
                const permission = await requestPermission();
                permissionGranted = permission === "granted";
              }

              if (permissionGranted) {
                const minutesWithoutTimer = Math.floor(timeSinceLastTimer / 60000);
                sendNotification({
                  title: "No Timer Running",
                  body: `You've been active for ${minutesWithoutTimer} minute${minutesWithoutTimer !== 1 ? "s" : ""} without a timer.`,
                  sound: "default",
                });
              }

              lastNoTimerWarningAtRef.current = now;
              setStatus((prev) => ({
                ...prev,
                lastNoTimerWarningAt: new Date(now),
              }));
            }
          }
        } catch {
          // Ignore errors fetching running timer
        }
      }
    } catch (error) {
      console.error("Idle check failed:", error);
      setStatus((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  // Start the interval on mount
  useEffect(() => {
    // Run immediately on mount
    checkIdle();

    // Then run every interval
    intervalRef.current = window.setInterval(checkIdle, checkIntervalMs);

    setStatus((prev) => ({ ...prev, isRunning: true }));

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setStatus((prev) => ({ ...prev, isRunning: false }));
    };
  }, [checkIdle, checkIntervalMs]);

  return { ...status, refresh: checkIdle };
}

/**
 * Hook to manually get the current idle time.
 *
 * @returns Current idle time in seconds
 */
export function useIdleTime(): {
  idleSeconds: number;
  refresh: () => Promise<void>;
} {
  const [idleSeconds, setIdleSeconds] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const seconds = await invoke<number>("get_idle_time");
      setIdleSeconds(seconds);
    } catch (error) {
      console.error("Failed to get idle time:", error);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { idleSeconds, refresh };
}
