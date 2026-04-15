/**
 * Battery-first runtime scheduler for idle monitoring and timer state.
 *
 * This hook owns the app's essential background loop:
 * - polls one Rust runtime snapshot instead of multiple native/network calls
 * - records adaptive activity heartbeats for stats
 * - updates tray/widget state at a coarse cadence
 * - keeps the main UI smooth by letting the visible window interpolate locally
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";
import { exit } from "@tauri-apps/plugin-process";
import { sendNotification } from "../lib/notification";
import { AppSettings, addRecentTask } from "../lib/store";
import { isWithinWorkSchedule } from "../lib/workSchedule";

/** Battery-first visible runtime poll cadence. */
const VISIBLE_RUNTIME_INTERVAL_MS = 15_000;
/** Hidden-to-tray runtime cadence. */
const HIDDEN_RUNTIME_INTERVAL_MS = 60_000;
/** Idle threshold lower bound used for stats classification. */
const MIN_IDLE_THRESHOLD_SECS = 60;

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

/** Result returned from the Rust poll_runtime command */
interface RuntimeSnapshot {
  idle_duration: number;
  running_timer: RunningTimerInfo | null;
  stopped: boolean;
  stopped_task_name: string | null;
  stopped_task_id: string | null;
  stopped_description: string | null;
  stopped_is_manual: boolean;
  stopped_tags: TimeEntryTag[];
  stopped_billable: boolean;
  error: string | null;
}

/** Current status of the idle checker */
export interface IdleStatus {
  isRunning: boolean;
  currentIdleSeconds: number;
  lastIdleSampledAtMs: number | null;
  runningTimerId: string | null;
  runningTaskName: string | null;
  runningTaskId: string | null;
  runningTaskStartMs: number | null;
  runningTimerIsManual: boolean;
  runningTimerDescription: string | null;
  runningTimerTags: TimeEntryTag[];
  runningTimerBillable: boolean;
  lastStoppedAt: Date | null;
  lastStoppedTaskName: string | null;
  lastStoppedTaskId: string | null;
  lastStoppedTimerIsManual: boolean;
  lastStoppedTimerDescription: string | null;
  lastStoppedTimerTags: TimeEntryTag[];
  lastStoppedTimerBillable: boolean;
  error: string | null;
  lastNoTimerWarningAt: Date | null;
  refresh: () => Promise<void>;
}

function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function updateTrayDisplay(timer: RunningTimerInfo | null): Promise<void> {
  const text =
    timer && timer.start_time_ms
      ? `${timer.name} - ${formatElapsedTime(Date.now() - timer.start_time_ms)}`
      : "No timer running";

  try {
    await invoke("update_tray_timer_display", { text });
  } catch (error) {
    console.error("Failed to update tray display:", error);
  }
}

async function emitWidgetUpdate(timer: RunningTimerInfo | null): Promise<void> {
  try {
    await emit("widget-timer-update", {
      taskName: timer?.name ?? null,
      startTimeMs: timer?.start_time_ms ?? null,
    });
  } catch {
    // Widget may not exist; ignore.
  }
}

function idleThresholdSecs(settings: AppSettings | null): number {
  return Math.max(
    MIN_IDLE_THRESHOLD_SECS,
    (settings?.idleThresholdMinutes ?? 10) * 60
  );
}

export function useIdleChecker(
  settings: AppSettings | null,
  isWindowVisible: boolean
): IdleStatus {
  const timeoutRef = useRef<number | null>(null);
  const settingsRef = useRef<AppSettings | null>(settings);
  const visibilityRef = useRef(isWindowVisible);
  const lastHeartbeatAtRef = useRef<number | null>(null);
  const lastTimerSeenAtRef = useRef<number | null>(null);
  const lastNoTimerWarningAtRef = useRef<number | null>(null);
  const lastAddedTaskIdRef = useRef<string | null>(null);
  const wasActiveRef = useRef(true);
  const taggedTimerIdsRef = useRef<Set<string>>(new Set());
  const lastRunningTimerRef = useRef<RunningTimerInfo | null>(null);
  const repeatOffHoursPauseStartedAtRef = useRef<number | null>(null);
  const repeatOffHoursPausedMsRef = useRef(0);
  const isPollingRef = useRef(false);
  const lastWidgetSignatureRef = useRef<string | null>(null);
  const trayHadRunningTimerRef = useRef(false);
  const pollRuntimeRef = useRef<() => Promise<void>>(async () => {});

  const [status, setStatus] = useState<IdleStatus>({
    isRunning: false,
    currentIdleSeconds: 0,
    lastIdleSampledAtMs: null,
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

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    visibilityRef.current = isWindowVisible;
  }, [isWindowVisible]);

  const syncDisplays = useCallback(async (timer: RunningTimerInfo | null) => {
    const hadRunningTimer = trayHadRunningTimerRef.current;
    if (timer) {
      await updateTrayDisplay(timer);
      trayHadRunningTimerRef.current = true;
    } else if (!hadRunningTimer) {
      return;
    } else {
      await updateTrayDisplay(null);
      trayHadRunningTimerRef.current = false;
    }

    const widgetSignature = timer
      ? `${timer.id}:${timer.start_time_ms}`
      : "no-timer";
    if (widgetSignature !== lastWidgetSignatureRef.current) {
      lastWidgetSignatureRef.current = widgetSignature;
      await emitWidgetUpdate(timer);
    }
  }, []);

  const recordHeartbeat = useCallback(async (idleSeconds: number) => {
    const now = Date.now();
    const previous = lastHeartbeatAtRef.current;
    lastHeartbeatAtRef.current = now;

    if (previous === null) {
      return;
    }

    const durationSecs = Math.max(1, Math.round((now - previous) / 1000));
    await invoke("record_heartbeat", {
      isIdle: idleSeconds >= idleThresholdSecs(settingsRef.current),
      durationSecs,
    });
  }, []);

  const handleNoTimerWarning = useCallback(
    async (idleSeconds: number, hasRunningTimer: boolean) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings?.noTimerWarningEnabled || hasRunningTimer) {
        repeatOffHoursPauseStartedAtRef.current = null;
        repeatOffHoursPausedMsRef.current = 0;
        return;
      }

      const now = Date.now();
      const warningThresholdMs = currentSettings.noTimerWarningMinutes * 60 * 1000;
      const isUserActive = idleSeconds < 120;

      if (isUserActive && !wasActiveRef.current) {
        lastTimerSeenAtRef.current = now;
      }
      wasActiveRef.current = isUserActive;

      if (lastTimerSeenAtRef.current === null) {
        lastTimerSeenAtRef.current = now;
      }

      const timeSinceLastTimer = now - lastTimerSeenAtRef.current;
      const lastNoTimerWarningAt = lastNoTimerWarningAtRef.current;
      let shouldWarn = false;

      if (isUserActive && timeSinceLastTimer >= warningThresholdMs) {
        if (!currentSettings.noTimerWarningRepeat) {
          shouldWarn = lastNoTimerWarningAt === null;
          repeatOffHoursPauseStartedAtRef.current = null;
          repeatOffHoursPausedMsRef.current = 0;
        } else if (lastNoTimerWarningAt === null) {
          shouldWarn = true;
          repeatOffHoursPauseStartedAtRef.current = null;
          repeatOffHoursPausedMsRef.current = 0;
        } else if (!currentSettings.noTimerWarningRepeatOnlyDuringWorkHours) {
          shouldWarn = now - lastNoTimerWarningAt >= warningThresholdMs;
          repeatOffHoursPauseStartedAtRef.current = null;
          repeatOffHoursPausedMsRef.current = 0;
        } else {
          const inWorkHours = isWithinWorkSchedule(
            new Date(now),
            currentSettings.workdayStart,
            currentSettings.workdayEnd,
            currentSettings.workdays
          );

          if (!inWorkHours) {
            if (repeatOffHoursPauseStartedAtRef.current === null) {
              repeatOffHoursPauseStartedAtRef.current = now;
            }
          } else if (repeatOffHoursPauseStartedAtRef.current !== null) {
            repeatOffHoursPausedMsRef.current +=
              now - repeatOffHoursPauseStartedAtRef.current;
            repeatOffHoursPauseStartedAtRef.current = null;
          }

          const accumulatedPausedMs =
            repeatOffHoursPausedMsRef.current +
            (repeatOffHoursPauseStartedAtRef.current !== null
              ? now - repeatOffHoursPauseStartedAtRef.current
              : 0);

          shouldWarn =
            inWorkHours &&
            Math.max(0, now - lastNoTimerWarningAt - accumulatedPausedMs) >=
              warningThresholdMs;
        }
      }

      if (!shouldWarn) {
        return;
      }

      const minutesWithoutTimer = Math.floor(timeSinceLastTimer / 60_000);
      await sendNotification({
        title: "No Timer Running",
        body: `You've been active for ${minutesWithoutTimer} minute${
          minutesWithoutTimer !== 1 ? "s" : ""
        } without a timer.`,
      });

      lastNoTimerWarningAtRef.current = now;
      repeatOffHoursPauseStartedAtRef.current = null;
      repeatOffHoursPausedMsRef.current = 0;
      setStatus((prev) => ({
        ...prev,
        lastNoTimerWarningAt: new Date(now),
      }));
    },
    []
  );

  const applyRunningTimer = useCallback(
    async (timer: RunningTimerInfo | null, idleSeconds: number, sampledAtMs: number) => {
      const currentSettings = settingsRef.current;
      const hasRunningTimer = timer !== null;

      if (hasRunningTimer && timer) {
        lastRunningTimerRef.current = timer;
        lastTimerSeenAtRef.current = sampledAtMs;
        lastNoTimerWarningAtRef.current = null;
        repeatOffHoursPauseStartedAtRef.current = null;
        repeatOffHoursPausedMsRef.current = 0;

        if (timer.task_id && timer.task_id !== lastAddedTaskIdRef.current) {
          lastAddedTaskIdRef.current = timer.task_id;
          addRecentTask({ id: timer.task_id, name: timer.name }).catch((error) => {
            console.error("[useIdleChecker] Failed to add recent task:", error);
          });
        }

        const hasRtTag = timer.tags.some((tag) => tag.name === "rt");
        const alreadyTagged = taggedTimerIdsRef.current.has(timer.id);
        if (
          currentSettings?.clickupApiKey &&
          currentSettings?.clickupTeamId &&
          !hasRtTag &&
          !alreadyTagged
        ) {
          taggedTimerIdsRef.current.add(timer.id);
          invoke("add_rt_tag_to_time_entry", {
            apiKey: currentSettings.clickupApiKey,
            teamId: currentSettings.clickupTeamId,
            timeEntryId: timer.id,
            existingTags: timer.tags,
          }).catch((error) => {
            console.error("[useIdleChecker] Failed to add rt tag:", error);
            taggedTimerIdsRef.current.delete(timer.id);
          });
        }
      } else {
        lastAddedTaskIdRef.current = null;
        const lastRunningTimer = lastRunningTimerRef.current;
        if (lastRunningTimer) {
          setStatus((prev) => ({
            ...prev,
            lastStoppedAt: new Date(sampledAtMs),
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
        currentIdleSeconds: idleSeconds,
        lastIdleSampledAtMs: sampledAtMs,
        runningTimerId: timer?.id ?? null,
        runningTaskName: timer?.name ?? null,
        runningTaskId: timer?.task_id ?? null,
        runningTaskStartMs: timer?.start_time_ms ?? null,
        runningTimerIsManual: timer?.is_manual ?? false,
        runningTimerDescription: timer?.description ?? null,
        runningTimerTags: timer?.tags ?? [],
        runningTimerBillable: timer?.billable ?? false,
      }));

      await handleNoTimerWarning(idleSeconds, hasRunningTimer);
      await syncDisplays(timer);
    },
    [handleNoTimerWarning, syncDisplays]
  );

  const stopTimerForEvent = useCallback(async (reason: string): Promise<boolean> => {
    const currentSettings = settingsRef.current;
    if (!currentSettings?.clickupApiKey || !currentSettings?.clickupTeamId) {
      return false;
    }

    const timerInfo = lastRunningTimerRef.current;
    if (!timerInfo) {
      return false;
    }

    await invoke("stop_timer", {
      apiKey: currentSettings.clickupApiKey,
      teamId: currentSettings.clickupTeamId,
    });

    await sendNotification({
      title: "Timer Stopped",
      body: `Timer stopped on "${timerInfo.name}" because ${reason}`,
    });

    const now = Date.now();
    lastRunningTimerRef.current = null;
    setStatus((prev) => ({
      ...prev,
      lastStoppedAt: new Date(now),
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

    await syncDisplays(null);
    return true;
  }, [syncDisplays]);

  const scheduleNextPoll = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    timeoutRef.current = window.setTimeout(() => {
      void pollRuntimeRef.current();
    }, visibilityRef.current ? VISIBLE_RUNTIME_INTERVAL_MS : HIDDEN_RUNTIME_INTERVAL_MS);
  }, []);

  const pollRuntime = useCallback(async () => {
    if (isPollingRef.current) {
      return;
    }

    isPollingRef.current = true;
    const currentSettings = settingsRef.current;

    try {
      let snapshot: RuntimeSnapshot;

      if (currentSettings?.clickupApiKey && currentSettings?.clickupTeamId) {
        snapshot = await invoke<RuntimeSnapshot>("poll_runtime", {
          apiKey: currentSettings.clickupApiKey,
          teamId: currentSettings.clickupTeamId,
          idleThresholdSecs: idleThresholdSecs(currentSettings),
        });
      } else {
        const idleDuration = await invoke<number>("get_idle_time");
        snapshot = {
          idle_duration: idleDuration,
          running_timer: null,
          stopped: false,
          stopped_task_name: null,
          stopped_task_id: null,
          stopped_description: null,
          stopped_is_manual: false,
          stopped_tags: [],
          stopped_billable: false,
          error: null,
        };
      }

      const sampledAtMs = Date.now();
      await recordHeartbeat(snapshot.idle_duration);

      setStatus((prev) => ({
        ...prev,
        isRunning: true,
        currentIdleSeconds: snapshot.idle_duration,
        lastIdleSampledAtMs: sampledAtMs,
        error:
          snapshot.error ??
          (currentSettings ? null : "Not configured. Please add your ClickUp settings."),
      }));

      if (snapshot.stopped) {
        const stoppedName =
          snapshot.stopped_task_name ||
          snapshot.stopped_description?.trim() ||
          (snapshot.stopped_is_manual ? "Manual Timer" : "Timer");
        const idleMinutes = Math.floor(snapshot.idle_duration / 60);

        await sendNotification({
          title: "Timer Stopped",
          body: `Timer stopped due to inactivity on "${stoppedName}" (idle for ${idleMinutes} minutes)`,
        });

        lastRunningTimerRef.current = null;
        setStatus((prev) => ({
          ...prev,
          lastStoppedAt: new Date(sampledAtMs),
          lastStoppedTaskName: stoppedName,
          lastStoppedTaskId: snapshot.stopped_task_id,
          lastStoppedTimerIsManual: snapshot.stopped_is_manual,
          lastStoppedTimerDescription: snapshot.stopped_description,
          lastStoppedTimerTags: snapshot.stopped_tags,
          lastStoppedTimerBillable: snapshot.stopped_billable,
          runningTimerId: null,
          runningTaskName: null,
          runningTaskId: null,
          runningTaskStartMs: null,
          runningTimerIsManual: false,
          runningTimerDescription: null,
          runningTimerTags: [],
          runningTimerBillable: false,
        }));

        await syncDisplays(null);
        await handleNoTimerWarning(snapshot.idle_duration, false);
      } else {
        await applyRunningTimer(
          snapshot.running_timer,
          snapshot.idle_duration,
          sampledAtMs
        );
      }
    } catch (error) {
      console.error("Runtime poll failed:", error);
      setStatus((prev) => ({
        ...prev,
        isRunning: true,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      isPollingRef.current = false;
      scheduleNextPoll();
    }
  }, [applyRunningTimer, handleNoTimerWarning, recordHeartbeat, scheduleNextPoll, syncDisplays]);

  useEffect(() => {
    pollRuntimeRef.current = pollRuntime;
  }, [pollRuntime]);

  useEffect(() => {
    void pollRuntime();
  }, [pollRuntime, settings, isWindowVisible]);

  useEffect(() => {
    let unlistenSleep: UnlistenFn | null = null;
    let unlistenShutdown: UnlistenFn | null = null;
    let unlistenQuit: UnlistenFn | null = null;

    const setup = async () => {
      unlistenSleep = await listen("system-sleep", async () => {
        try {
          await stopTimerForEvent("your computer went to sleep");
        } catch (error) {
          console.error("[useIdleChecker] Failed to stop timer on sleep:", error);
        }
      });

      unlistenShutdown = await listen("system-shutdown", async () => {
        try {
          await stopTimerForEvent("your computer is shutting down");
        } catch (error) {
          console.error("[useIdleChecker] Failed to stop timer on shutdown:", error);
        }
      });

      unlistenQuit = await listen("app-quit-requested", async () => {
        try {
          await stopTimerForEvent("the app is closing");
        } catch (error) {
          console.error("[useIdleChecker] Failed to stop timer on quit:", error);
        } finally {
          await exit(0);
        }
      });
    };

    void setup();

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (unlistenSleep) unlistenSleep();
      if (unlistenShutdown) unlistenShutdown();
      if (unlistenQuit) unlistenQuit();
    };
  }, [stopTimerForEvent]);

  return {
    ...status,
    refresh: pollRuntime,
  };
}
