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
import { listen, emit, UnlistenFn } from "@tauri-apps/api/event";
import { exit } from "@tauri-apps/plugin-process";
import { sendNotification } from "../lib/notification";
import { getSettings, addRecentTask } from "../lib/store";

/** Result returned from the Rust check_and_stop_timer command */
interface IdleCheckResult {
  stopped: boolean;
  task_name: string | null;
  task_id: string | null;
  description: string | null;
  is_manual: boolean;
  tags: TimeEntryTag[];
  billable: boolean;
  idle_duration: number;
  error: string | null;
}

/** Time entry tag from ClickUp */
interface TimeEntryTag {
  name: string;
  tag_bg: string | null;
  tag_fg: string | null;
}

/** Info about the running timer from Rust */
interface RunningTimerInfo {
  id: string;
  name: string;
  task_id: string | null;
  start_time_ms: number;
  description: string | null;
  is_manual: boolean;
  tags: TimeEntryTag[];
  billable: boolean;
}

/** Current status of the idle checker */
export interface IdleStatus {
  /** Whether the checker is running */
  isRunning: boolean;
  /** Current idle time in seconds */
  currentIdleSeconds: number;
  /** ID of the current time entry (for rt-tag detection) */
  runningTimerId: string | null;
  /** Name of the currently running task (if any) */
  runningTaskName: string | null;
  /** ID of the currently running task (if any, null for manual timers) */
  runningTaskId: string | null;
  /** Start time of the running timer (for elapsed time calculation) */
  runningTaskStartMs: number | null;
  /** Whether the running timer is a manual timer (no task) */
  runningTimerIsManual: boolean;
  /** Description of the running timer (for manual timers) */
  runningTimerDescription: string | null;
  /** Tags on the running timer */
  runningTimerTags: TimeEntryTag[];
  /** Whether the running timer is billable */
  runningTimerBillable: boolean;
  /** Last time a timer was stopped */
  lastStoppedAt: Date | null;
  /** Last stopped task name */
  lastStoppedTaskName: string | null;
  /** Last stopped task ID (for resume functionality) */
  lastStoppedTaskId: string | null;
  /** Whether the last stopped timer was manual */
  lastStoppedTimerIsManual: boolean;
  /** Description of the last stopped timer (manual timers) */
  lastStoppedTimerDescription: string | null;
  /** Tags from the last stopped timer */
  lastStoppedTimerTags: TimeEntryTag[];
  /** Whether the last stopped timer was billable */
  lastStoppedTimerBillable: boolean;
  /** Error message if something went wrong */
  error: string | null;
  /** Last time we sent a "no timer" warning */
  lastNoTimerWarningAt: Date | null;
  /** Function to manually refresh the status */
  refresh: () => Promise<void>;
}

/**
 * Format elapsed time as H:MM:SS or M:SS.
 */
function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Update the tray menu timer display text.
 */
async function updateTrayDisplay(
  taskName: string | null,
  startTimeMs: number | null
): Promise<void> {
  try {
    if (taskName && startTimeMs) {
      const elapsed = Date.now() - startTimeMs;
      await invoke("update_tray_timer_display", {
        text: `${taskName} - ${formatElapsedTime(elapsed)}`,
      });
    } else {
      await invoke("update_tray_timer_display", {
        text: "No timer running",
      });
    }
  } catch (e) {
    console.error("Failed to update tray display:", e);
  }
}

/**
 * Emit timer state to the widget window.
 */
async function emitWidgetUpdate(
  taskName: string | null,
  startTimeMs: number | null
): Promise<void> {
  try {
    await emit("widget-timer-update", {
      taskName,
      startTimeMs,
    });
  } catch (e) {
    // Widget may not exist, ignore errors
  }
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
  /** Whether the user was active (not idle) on the previous check - used to detect idle→active transitions */
  const wasActiveRef = useRef<boolean>(true);
  /** Interval for fast tray updates (10s) when timer is running */
  const trayIntervalRef = useRef<number | null>(null);
  /** Set of time entry IDs we've already added the rt tag to (to avoid duplicate calls) */
  const taggedTimerIdsRef = useRef<Set<string>>(new Set());
  /** Most recent running timer seen, used to capture manual stop metadata */
  const lastRunningTimerRef = useRef<RunningTimerInfo | null>(null);

  const [status, setStatus] = useState<IdleStatus>({
    isRunning: false,
    currentIdleSeconds: 0,
    runningTimerId: null,
    runningTaskName: null,
    runningTaskId: null,
    runningTaskStartMs: null,
    runningTimerIsManual: false,
    runningTimerDescription: null,
    runningTimerTags: [],
    runningTimerBillable: false,
    lastStoppedAt: null,
    lastStoppedTaskName: null,
    lastStoppedTaskId: null,
    lastStoppedTimerIsManual: false,
    lastStoppedTimerDescription: null,
    lastStoppedTimerTags: [],
    lastStoppedTimerBillable: false,
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
      if (result.stopped) {
        const stoppedName =
          result.task_name ||
          result.description?.trim() ||
          (result.is_manual ? "Manual Timer" : "Timer");
        const idleMinutes = Math.floor(result.idle_duration / 60);
        await sendNotification({
          title: "Timer Stopped",
          body: `Timer stopped due to inactivity on "${stoppedName}" (idle for ${idleMinutes} minutes)`,
        });

        setStatus((prev) => ({
          ...prev,
          lastStoppedAt: new Date(),
          lastStoppedTaskName: stoppedName,
          lastStoppedTaskId: result.task_id,
          lastStoppedTimerIsManual: result.is_manual,
          lastStoppedTimerDescription: result.description,
          lastStoppedTimerTags: result.tags,
          lastStoppedTimerBillable: result.billable,
          runningTimerId: null,
          runningTaskName: null,
          runningTaskId: null,
          runningTaskStartMs: null,
          runningTimerIsManual: false,
          runningTimerDescription: null,
          runningTimerTags: [],
          runningTimerBillable: false,
        }));
        lastRunningTimerRef.current = null;
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
            lastRunningTimerRef.current = timerInfo;

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

            // Check if running timer needs the "rt" tag added (for externally-started timers)
            const hasRtTag = timerInfo.tags.some((t) => t.name === "rt");
            const alreadyTagged = taggedTimerIdsRef.current.has(timerInfo.id);
            
            if (!hasRtTag && !alreadyTagged) {
              console.log("[useIdleChecker] Adding rt tag to externally-started timer:", timerInfo.id);
              taggedTimerIdsRef.current.add(timerInfo.id);
              
              invoke("add_rt_tag_to_time_entry", {
                apiKey: settings.clickupApiKey,
                teamId: settings.clickupTeamId,
                timeEntryId: timerInfo.id,
                existingTags: timerInfo.tags,
              }).then((added) => {
                if (added) {
                  console.log("[useIdleChecker] Successfully added rt tag to time entry:", timerInfo.id);
                }
              }).catch((err) => {
                console.error("[useIdleChecker] Failed to add rt tag:", err);
                // Remove from tracked set so we can retry next poll
                taggedTimerIdsRef.current.delete(timerInfo.id);
              });
            }
          } else {
            // No timer running - reset the last added task ID so we can add it again later
            lastAddedTaskIdRef.current = null;

            // Detect timer stop events (e.g., manual stop button) and preserve resume metadata.
            const lastRunningTimer = lastRunningTimerRef.current;
            if (lastRunningTimer) {
              setStatus((prev) => ({
                ...prev,
                lastStoppedAt: new Date(),
                lastStoppedTaskName: lastRunningTimer.name,
                lastStoppedTaskId: lastRunningTimer.task_id,
                lastStoppedTimerIsManual: lastRunningTimer.is_manual,
                lastStoppedTimerDescription: lastRunningTimer.description,
                lastStoppedTimerTags: lastRunningTimer.tags,
                lastStoppedTimerBillable: lastRunningTimer.billable,
              }));
              lastRunningTimerRef.current = null;
            }
          }

          setStatus((prev) => ({
            ...prev,
            runningTimerId: timerInfo?.id ?? null,
            runningTaskName: timerInfo?.name ?? null,
            runningTaskId: timerInfo?.task_id ?? null,
            runningTaskStartMs: timerInfo?.start_time_ms ?? null,
            runningTimerIsManual: timerInfo?.is_manual ?? false,
            runningTimerDescription: timerInfo?.description ?? null,
            runningTimerTags: timerInfo?.tags ?? [],
            runningTimerBillable: timerInfo?.billable ?? false,
          }));

          // Update tray display with current timer info
          await updateTrayDisplay(
            timerInfo?.name ?? null,
            timerInfo?.start_time_ms ?? null
          );

          // Update widget with current timer info
          await emitWidgetUpdate(
            timerInfo?.name ?? null,
            timerInfo?.start_time_ms ?? null
          );

          // Check if we should warn about no timer running
          if (
            !hasRunningTimer &&
            settings.noTimerWarningEnabled
          ) {
            const now = Date.now();
            const warningThresholdMs = settings.noTimerWarningMinutes * 60 * 1000;
            
            // Consider user "active" if idle less than 2 minutes
            const isUserActive = result.idle_duration < 120;

            // Reset "time without timer" if user just became active after being idle
            // This prevents showing huge numbers after waking from sleep/idle
            if (isUserActive && !wasActiveRef.current) {
              lastTimerSeenAtRef.current = now;
            }
            wasActiveRef.current = isUserActive;

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
              const minutesWithoutTimer = Math.floor(timeSinceLastTimer / 60000);
              await sendNotification({
                title: "No Timer Running",
                body: `You've been active for ${minutesWithoutTimer} minute${minutesWithoutTimer !== 1 ? "s" : ""} without a timer.`,
              });

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

    // Listen for system sleep events (macOS lid close / display sleep)
    let unlistenSleep: UnlistenFn | null = null;
    let unlistenShutdown: UnlistenFn | null = null;
    let unlistenQuit: UnlistenFn | null = null;

    /**
     * Stop any running timer and update UI state.
     * Shared logic for sleep, shutdown, and app quit events.
     */
    const stopTimerForEvent = async (reason: string): Promise<boolean> => {
      const settings = await getSettings();
      if (!settings?.clickupApiKey || !settings?.clickupTeamId) return false;

      const timerInfo = await invoke<RunningTimerInfo | null>(
        "get_running_timer_info",
        {
          apiKey: settings.clickupApiKey,
          teamId: settings.clickupTeamId,
        }
      );

      if (timerInfo) {
        await invoke("stop_timer", {
          apiKey: settings.clickupApiKey,
          teamId: settings.clickupTeamId,
        });

        await sendNotification({
          title: "Timer Stopped",
          body: `Timer stopped on "${timerInfo.name}" because ${reason}`,
        });

        setStatus((prev) => ({
          ...prev,
          lastStoppedAt: new Date(),
          lastStoppedTaskName: timerInfo.name,
          lastStoppedTaskId: timerInfo.task_id,
          lastStoppedTimerIsManual: timerInfo.is_manual,
          lastStoppedTimerDescription: timerInfo.description,
          lastStoppedTimerTags: timerInfo.tags,
          lastStoppedTimerBillable: timerInfo.billable,
          runningTimerId: null,
          runningTaskName: null,
          runningTaskId: null,
          runningTaskStartMs: null,
          runningTimerIsManual: false,
          runningTimerDescription: null,
          runningTimerTags: [],
          runningTimerBillable: false,
        }));

        await updateTrayDisplay(null, null);
        await emitWidgetUpdate(null, null);
        return true;
      }
      return false;
    };

    const setupSleepListener = async () => {
      unlistenSleep = await listen("system-sleep", async () => {
        console.log("[useIdleChecker] System sleep detected, stopping timer");
        try {
          await stopTimerForEvent("your computer went to sleep");
        } catch (error) {
          console.error("[useIdleChecker] Failed to stop timer on sleep:", error);
        }
      });
    };

    const setupShutdownListener = async () => {
      unlistenShutdown = await listen("system-shutdown", async () => {
        console.log("[useIdleChecker] System shutdown detected, stopping timer");
        try {
          await stopTimerForEvent("your computer is shutting down");
        } catch (error) {
          console.error("[useIdleChecker] Failed to stop timer on shutdown:", error);
        }
      });
    };

    const setupQuitListener = async () => {
      unlistenQuit = await listen("app-quit-requested", async () => {
        console.log("[useIdleChecker] App quit requested, stopping timer before exit");
        try {
          await stopTimerForEvent("the app is closing");
        } catch (error) {
          console.error("[useIdleChecker] Failed to stop timer on quit:", error);
        } finally {
          // Always exit the app, even if timer stop failed
          await exit(0);
        }
      });
    };

    setupSleepListener();
    setupShutdownListener();
    setupQuitListener();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (unlistenSleep) {
        unlistenSleep();
      }
      if (unlistenShutdown) {
        unlistenShutdown();
      }
      if (unlistenQuit) {
        unlistenQuit();
      }
      setStatus((prev) => ({ ...prev, isRunning: false }));
    };
  }, [checkIdle, checkIntervalMs]);

  // Fast tray update interval (10s) when timer is running
  useEffect(() => {
    // Clear any existing fast interval
    if (trayIntervalRef.current) {
      clearInterval(trayIntervalRef.current);
      trayIntervalRef.current = null;
    }

    // Only start fast interval if timer is running
    if (status.runningTaskName && status.runningTaskStartMs) {
      const taskName = status.runningTaskName;
      const startMs = status.runningTaskStartMs;

      // Update immediately
      emitWidgetUpdate(taskName, startMs);

      // Update every 10 seconds
      trayIntervalRef.current = window.setInterval(() => {
        updateTrayDisplay(taskName, startMs);
        emitWidgetUpdate(taskName, startMs);
      }, 10_000);
    } else {
      // No timer running - update widget immediately
      emitWidgetUpdate(null, null);
    }

    return () => {
      if (trayIntervalRef.current) {
        clearInterval(trayIntervalRef.current);
        trayIntervalRef.current = null;
      }
    };
  }, [status.runningTaskName, status.runningTaskStartMs]);

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
