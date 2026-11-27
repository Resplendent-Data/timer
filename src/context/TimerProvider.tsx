/**
 * Centralized application state provider for Resplendent Timer.
 *
 * Designed for near-zero idle CPU & memory:
 * - Zero global 1-second timers (live ticking is scoped only to TimerHero)
 * - Memoized context value to prevent unnecessary subtree reconciliation
 * - Event-driven history/progress refreshes with conservative background intervals
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onAction } from "@tauri-apps/plugin-notification";
import { exit } from "@tauri-apps/plugin-process";
import { formatClock, formatDuration, formatTimeOfDay } from "@/lib/format";
import { checkNotificationPermission, sendNotification } from "@/lib/notification";
import {
  type AppSettings,
  type RecentTask,
  SETTINGS_UPDATED_EVENT,
  addRecentTask,
  clearWidgetPosition,
  getRecentTasks,
  getSettings,
  getWidgetPosition,
  saveWidgetPosition,
} from "@/lib/store";
import { isWithinWorkSchedule } from "@/lib/workSchedule";
import {
  stoppedToWrapUp,
  summaryToStopped,
} from "@/lib/wrapup";
import type {
  ActiveUntrackedSnapshot,
  MeetingResumePayload,
  RunningTimerInfo,
  RuntimeSnapshot,
  StoppedTimeEntry,
  TimeEntrySummary,
  TimeEntryTag,
  UpdateTimeEntryPayload,
  WidgetTimerPayload,
  WorkProgressStats,
  WrapUpEntry,
} from "@/types/timer";

const VISIBLE_POLL_INTERVAL_MS = 15_000;
const HIDDEN_POLL_INTERVAL_MS = 60_000;
const RECENT_HISTORY_REFRESH_MS = 5 * 60_000;
const WORK_PROGRESS_REFRESH_MS = 2 * 60_000;
const MIN_IDLE_THRESHOLD_SECS = 60;
const RECENT_HISTORY_DAYS = 14;

export type AppTab = "focus" | "insights" | "settings";

interface AppVisibilityChange {
  visible: boolean;
  focused: boolean;
}

export interface StartQuickTimerOptions {
  taskId?: string | null;
  taskName?: string | null;
  projectPath?: string;
  description?: string | null;
  tags?: string[];
  billable?: boolean;
  useBackdate?: boolean;
  resumedNote?: string | null;
}

export interface ResumableSession {
  task_id: string | null;
  task_name: string | null;
  name: string;
  description: string | null;
  is_manual: boolean;
  tags: TimeEntryTag[];
  billable: boolean;
}

interface TimerContextValue {
  // Navigation & shell
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  isWindowVisible: boolean;

  // Settings
  settings: AppSettings | null;
  settingsLoaded: boolean;
  isConfigured: boolean;
  reloadSettings: () => Promise<void>;

  // Live runtime snapshots (no global 1s tick)
  isMonitoring: boolean;
  isProcessing: boolean;
  runningTimer: RunningTimerInfo | null;
  resumedFromNote: string | null;
  sampledIdleSeconds: number;
  lastIdleSampledAtMs: number | null;
  activeUntrackedSinceMs: number | null;
  isBackdateEligible: boolean;
  includeBackdate: boolean;
  setIncludeBackdate: (value: boolean) => void;
  lastStoppedEntry: StoppedTimeEntry | null;
  lastStoppedAtMs: number | null;
  error: string | null;
  clearError: () => void;

  // Wrap-up & needs-note queue
  wrapUpEntry: WrapUpEntry | null;
  pendingNoteEntry: WrapUpEntry | null;
  openWrapUp: (entry: WrapUpEntry) => void;
  closeWrapUp: (skipped?: boolean) => void;
  dismissPendingNote: () => void;

  // Workspace data
  recentTasks: RecentTask[];
  workspaceTags: TimeEntryTag[];
  isLoadingTags: boolean;
  ensureWorkspaceTags: () => Promise<TimeEntryTag[]>;
  recentEntries: TimeEntrySummary[];
  isLoadingRecentEntries: boolean;
  refreshRecentEntries: () => Promise<void>;
  workProgress: WorkProgressStats | null;
  refreshWorkProgress: () => Promise<void>;

  // Meeting mode resume banner
  meetingResumePayload: MeetingResumePayload | null;
  dismissMeetingResume: () => void;
  resumeAfterMeeting: () => Promise<void>;

  // Actions
  startQuickTimer: (options?: StartQuickTimerOptions) => Promise<void>;
  resumeFromEntry: (entry: ResumableSession) => Promise<void>;
  stopAndWrapUp: () => Promise<void>;
  saveWrapUpEntry: (entryId: string, payload: UpdateTimeEntryPayload) => Promise<void>;
  resumeLastTimer: () => Promise<void>;
  dismissUntrackedTime: () => Promise<void>;
  refreshRuntime: () => Promise<void>;
}

const TimerContext = createContext<TimerContextValue | null>(null);

function idleThresholdSecs(settings: AppSettings | null): number {
  return Math.max(
    MIN_IDLE_THRESHOLD_SECS,
    (settings?.idleThresholdMinutes ?? 10) * 60
  );
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<AppTab>("focus");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [isWindowVisible, setIsWindowVisible] = useState(true);

  // Runtime snapshots (updated on poll or user action, never 1Hz)
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [runningTimer, setRunningTimer] = useState<RunningTimerInfo | null>(null);
  const [resumedFromNote, setResumedFromNote] = useState<string | null>(null);
  const [sampledIdleSeconds, setSampledIdleSeconds] = useState(0);
  const [lastIdleSampledAtMs, setLastIdleSampledAtMs] = useState<number | null>(null);
  const [activeUntrackedSinceMs, setActiveUntrackedSinceMs] = useState<number | null>(null);
  const [sampledUntrackedSecs, setSampledUntrackedSecs] = useState(0);
  const [includeBackdate, setIncludeBackdate] = useState(true);
  const [lastStoppedEntry, setLastStoppedEntry] = useState<StoppedTimeEntry | null>(null);
  const [lastStoppedAtMs, setLastStoppedAtMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wrap-Up & pending note state
  const [wrapUpEntry, setWrapUpEntry] = useState<WrapUpEntry | null>(null);
  const [pendingNoteEntry, setPendingNoteEntry] = useState<WrapUpEntry | null>(null);

  // Workspace data
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);
  const [workspaceTags, setWorkspaceTags] = useState<TimeEntryTag[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [recentEntries, setRecentEntries] = useState<TimeEntrySummary[]>([]);
  const [isLoadingRecentEntries, setIsLoadingRecentEntries] = useState(false);
  const [workProgress, setWorkProgress] = useState<WorkProgressStats | null>(null);
  const [meetingResumePayload, setMeetingResumePayload] =
    useState<MeetingResumePayload | null>(null);

  // Mutable refs for scheduler & native callbacks
  const settingsRef = useRef<AppSettings | null>(null);
  const visibilityRef = useRef(true);
  const runningTimerRef = useRef<RunningTimerInfo | null>(null);
  const resumedFromNoteRef = useRef<string | null>(null);
  const activeUntrackedSinceRef = useRef<number | null>(null);
  const includeBackdateRef = useRef(true);
  const widgetEnabledRef = useRef(false);
  const pollTimeoutRef = useRef<number | null>(null);
  const isPollingRef = useRef(false);
  const lastHeartbeatAtRef = useRef<number | null>(null);
  const lastNoTimerWarningAtRef = useRef<number | null>(null);
  const repeatOffHoursPauseStartedAtRef = useRef<number | null>(null);
  const repeatOffHoursPausedMsRef = useRef(0);
  const lastAddedTaskIdRef = useRef<string | null>(null);
  const taggedTimerIdsRef = useRef<Set<string>>(new Set());
  const tagsLoadedForTeamRef = useRef<string | null>(null);
  const lastWidgetSigRef = useRef<string | null>(null);
  const trayHadRunningRef = useRef(false);
  const pollRuntimeRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    visibilityRef.current = isWindowVisible;
  }, [isWindowVisible]);

  useEffect(() => {
    runningTimerRef.current = runningTimer;
  }, [runningTimer]);

  useEffect(() => {
    resumedFromNoteRef.current = resumedFromNote;
  }, [resumedFromNote]);

  useEffect(() => {
    activeUntrackedSinceRef.current = activeUntrackedSinceMs;
  }, [activeUntrackedSinceMs]);

  useEffect(() => {
    includeBackdateRef.current = includeBackdate;
  }, [includeBackdate]);

  const isConfigured = Boolean(
    settings?.clickupApiKey && settings?.clickupTeamId
  );

  const isBackdateEligible = Boolean(
    !runningTimer &&
      activeUntrackedSinceMs !== null &&
      sampledUntrackedSecs >= (settings?.minBackdateMinutes ?? 2) * 60
  );

  const updateWidgetState = useCallback(async (enabled: boolean) => {
    try {
      if (enabled) {
        const position = await getWidgetPosition();
        let x: number | null = null;
        let y: number | null = null;
        if (
          position &&
          position.x >= 0 &&
          position.x < 5000 &&
          position.y >= 0 &&
          position.y < 2000
        ) {
          x = position.x;
          y = position.y;
        } else if (position) {
          await clearWidgetPosition();
        }
        await invoke("create_widget_window", { x, y });
      } else {
        await invoke("close_widget_window");
      }
    } catch (err) {
      console.error("[TimerProvider] Failed to update widget state:", err);
    }
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      const next = await getSettings();
      setSettings(next);
      setIncludeBackdate(next?.autoBackdateEnabled ?? true);

      const nextWidget = next?.widgetEnabled ?? false;
      if (widgetEnabledRef.current !== nextWidget) {
        widgetEnabledRef.current = nextWidget;
        void updateWidgetState(nextWidget);
      }
    } catch (err) {
      console.error("[TimerProvider] Failed to load settings:", err);
    } finally {
      setSettingsLoaded(true);
    }
  }, [updateWidgetState]);

  const refreshWorkProgress = useCallback(async () => {
    try {
      const stats = await invoke<WorkProgressStats>("get_work_progress_summary");
      setWorkProgress(stats);
    } catch (err) {
      console.error("[TimerProvider] Failed to load work progress:", err);
    }
  }, []);

  const refreshRecentEntries = useCallback(async () => {
    const s = settingsRef.current;
    if (!s?.clickupApiKey || !s?.clickupTeamId) {
      setRecentEntries([]);
      return;
    }

    setIsLoadingRecentEntries(true);
    try {
      const entries = await invoke<TimeEntrySummary[]>("get_recent_time_entries", {
        apiKey: s.clickupApiKey,
        teamId: s.clickupTeamId,
        days: RECENT_HISTORY_DAYS,
      });
      setRecentEntries(entries);

      const latestCompleted = entries.find((e) => !e.is_running);
      if (latestCompleted) {
        setLastStoppedEntry((prev) => prev ?? summaryToStopped(latestCompleted));
      }
    } catch (err) {
      console.debug("[TimerProvider] Failed to load recent entries:", err);
    } finally {
      setIsLoadingRecentEntries(false);
    }
  }, []);

  const ensureWorkspaceTags = useCallback(async (): Promise<TimeEntryTag[]> => {
    const s = settingsRef.current;
    if (!s?.clickupApiKey || !s?.clickupTeamId) return [];
    if (tagsLoadedForTeamRef.current === s.clickupTeamId && workspaceTags.length > 0) {
      return workspaceTags;
    }

    setIsLoadingTags(true);
    try {
      const fetched = await invoke<TimeEntryTag[]>("get_time_entry_tags", {
        apiKey: s.clickupApiKey,
        teamId: s.clickupTeamId,
      });
      tagsLoadedForTeamRef.current = s.clickupTeamId;
      setWorkspaceTags(fetched);
      return fetched;
    } catch (err) {
      console.debug("[TimerProvider] Failed to fetch workspace tags:", err);
      return workspaceTags;
    } finally {
      setIsLoadingTags(false);
    }
  }, [workspaceTags]);

  const syncExternalDisplays = useCallback(
    async (
      timer: RunningTimerInfo | null,
      untrackedSinceMs: number | null,
      untrackedEligible: boolean
    ) => {
      const hadRunning = trayHadRunningRef.current;
      if (timer) {
        const displayTags = timer.tags
          .map((t) => t.name)
          .filter((n) => n.toLowerCase() !== "rt");
        const label =
          timer.is_manual && !timer.description && displayTags.length > 0
            ? displayTags.join(", ")
            : timer.name;
        const text = `${label} — ${formatClock(Date.now() - timer.start_time_ms)}`;
        invoke("update_tray_timer_display", { text }).catch(() => {});
        trayHadRunningRef.current = true;
      } else if (hadRunning) {
        invoke("update_tray_timer_display", { text: "No timer running" }).catch(() => {});
        trayHadRunningRef.current = false;
      }

      if (!widgetEnabledRef.current) return;

      const payload: WidgetTimerPayload = {
        taskName: timer?.name ?? null,
        startTimeMs: timer?.start_time_ms ?? null,
        isBackdated: timer?.is_backdated ?? false,
        untrackedSinceMs: timer ? null : untrackedSinceMs,
        untrackedEligible: !timer && untrackedEligible,
      };
      const sig = JSON.stringify(payload);
      if (sig !== lastWidgetSigRef.current) {
        lastWidgetSigRef.current = sig;
        emit("widget-timer-update", payload).catch(() => {});
      }
    },
    []
  );

  const recordHeartbeat = useCallback(async (idleSeconds: number) => {
    const now = Date.now();
    const prev = lastHeartbeatAtRef.current;
    lastHeartbeatAtRef.current = now;
    if (prev === null) return;

    const durationSecs = Math.max(1, Math.round((now - prev) / 1000));
    await invoke("record_heartbeat", {
      isIdle: idleSeconds >= idleThresholdSecs(settingsRef.current),
      durationSecs,
    });
  }, []);

  const handleNoTimerWarning = useCallback(
    async (
      idleSeconds: number,
      hasRunningTimer: boolean,
      untrackedSinceMs: number | null
    ) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings?.noTimerWarningEnabled || hasRunningTimer || !untrackedSinceMs) {
        repeatOffHoursPauseStartedAtRef.current = null;
        repeatOffHoursPausedMsRef.current = 0;
        return;
      }

      const now = Date.now();
      const warningThresholdMs = currentSettings.noTimerWarningMinutes * 60 * 1000;
      const isUserActive = idleSeconds < 120;
      const activeDurationMs = Math.max(0, now - untrackedSinceMs);
      const lastWarningAt = lastNoTimerWarningAtRef.current;

      let shouldWarn = false;
      if (isUserActive && activeDurationMs >= warningThresholdMs) {
        if (!currentSettings.noTimerWarningRepeat) {
          shouldWarn = lastWarningAt === null;
          repeatOffHoursPauseStartedAtRef.current = null;
          repeatOffHoursPausedMsRef.current = 0;
        } else if (lastWarningAt === null) {
          shouldWarn = true;
          repeatOffHoursPauseStartedAtRef.current = null;
          repeatOffHoursPausedMsRef.current = 0;
        } else if (!currentSettings.noTimerWarningRepeatOnlyDuringWorkHours) {
          shouldWarn = now - lastWarningAt >= warningThresholdMs;
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
            Math.max(0, now - lastWarningAt - accumulatedPausedMs) >=
              warningThresholdMs;
        }
      }

      if (!shouldWarn) return;

      const mins = Math.max(1, Math.floor(activeDurationMs / 60_000));
      const sinceText = formatTimeOfDay(untrackedSinceMs);
      const backdateHint = currentSettings.autoBackdateEnabled
        ? ` Click to start from ${sinceText}.`
        : "";

      await sendNotification({
        title: "No Timer Running",
        body: `You've been active for ${mins}m without a timer.${backdateHint}`,
        extra: { intent: "no-timer-reminder" },
      });

      lastNoTimerWarningAtRef.current = now;
      repeatOffHoursPauseStartedAtRef.current = null;
      repeatOffHoursPausedMsRef.current = 0;
    },
    []
  );

  const scheduleNextPoll = useCallback(() => {
    if (pollTimeoutRef.current) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    pollTimeoutRef.current = window.setTimeout(() => {
      void pollRuntimeRef.current();
    }, visibilityRef.current ? VISIBLE_POLL_INTERVAL_MS : HIDDEN_POLL_INTERVAL_MS);
  }, []);

  const pollRuntime = useCallback(async () => {
    if (isPollingRef.current) return;
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
        const untracked = await invoke<ActiveUntrackedSnapshot>(
          "get_active_untracked_state"
        );
        snapshot = {
          idle_duration: untracked.current_idle_secs,
          running_timer: null,
          active_untracked_since_ms: untracked.active_since_ms,
          active_untracked_secs: untracked.active_duration_secs,
          stopped: false,
          stopped_entry_id: null,
          stopped_task_name: null,
          stopped_task_id: null,
          stopped_description: null,
          stopped_is_manual: false,
          stopped_tags: [],
          stopped_billable: false,
          stopped_start_time_ms: null,
          stopped_end_time_ms: null,
          stopped_duration_secs: 0,
          stopped_is_backdated: false,
          error: null,
        };
      }

      const sampledAtMs = Date.now();
      await recordHeartbeat(snapshot.idle_duration);

      setIsMonitoring(true);
      setSampledIdleSeconds(snapshot.idle_duration);
      setLastIdleSampledAtMs(sampledAtMs);
      setActiveUntrackedSinceMs(snapshot.active_untracked_since_ms);
      setSampledUntrackedSecs(snapshot.active_untracked_secs);
      setError(snapshot.error ?? null);

      if (snapshot.stopped) {
        const stoppedName =
          snapshot.stopped_task_name ||
          snapshot.stopped_description?.trim() ||
          "Untitled session";
        const idleMins = Math.floor(snapshot.idle_duration / 60);

        await sendNotification({
          title: "Timer Auto-Stopped",
          body: `Stopped "${stoppedName}" after ${idleMins}m of inactivity.`,
        });

        const stoppedObj: StoppedTimeEntry = {
          id: snapshot.stopped_entry_id ?? "",
          name: stoppedName,
          task_id: snapshot.stopped_task_id,
          task_name: snapshot.stopped_is_manual ? null : snapshot.stopped_task_name,
          description: snapshot.stopped_description,
          start_time_ms: snapshot.stopped_start_time_ms ?? sampledAtMs,
          end_time_ms: snapshot.stopped_end_time_ms ?? sampledAtMs,
          duration_secs: snapshot.stopped_duration_secs,
          is_manual: snapshot.stopped_is_manual,
          tags: snapshot.stopped_tags,
          billable: snapshot.stopped_billable,
          is_backdated: snapshot.stopped_is_backdated,
        };

        const suggested = resumedFromNoteRef.current;
        setRunningTimer(null);
        setResumedFromNote(null);
        setLastStoppedEntry(stoppedObj);
        setLastStoppedAtMs(sampledAtMs);
        setIncludeBackdate(currentSettings?.autoBackdateEnabled ?? true);

        if (stoppedObj.id && !stoppedObj.description?.trim()) {
          setPendingNoteEntry(stoppedToWrapUp(stoppedObj, "auto-stop", suggested));
        }

        await syncExternalDisplays(null, snapshot.active_untracked_since_ms, false);
        void refreshWorkProgress();
        void refreshRecentEntries();
      } else {
        const timer = snapshot.running_timer;
        const previousTimer = runningTimerRef.current;

        if (timer) {
          lastNoTimerWarningAtRef.current = null;
          repeatOffHoursPauseStartedAtRef.current = null;
          repeatOffHoursPausedMsRef.current = 0;

          if (timer.task_id && timer.task_id !== lastAddedTaskIdRef.current) {
            lastAddedTaskIdRef.current = timer.task_id;
            addRecentTask({ id: timer.task_id, name: timer.name })
              .then(setRecentTasks)
              .catch(() => {});
          }

          const hasRtTag = timer.tags.some((t) => t.name.toLowerCase() === "rt");
          if (
            currentSettings?.clickupApiKey &&
            currentSettings?.clickupTeamId &&
            !hasRtTag &&
            !taggedTimerIdsRef.current.has(timer.id)
          ) {
            taggedTimerIdsRef.current.add(timer.id);
            invoke("add_rt_tag_to_time_entry", {
              apiKey: currentSettings.clickupApiKey,
              teamId: currentSettings.clickupTeamId,
              timeEntryId: timer.id,
              existingTags: timer.tags,
            }).catch(() => {
              taggedTimerIdsRef.current.delete(timer.id);
            });
          }
        } else {
          lastAddedTaskIdRef.current = null;
          if (previousTimer) {
            const externalStopped: StoppedTimeEntry = {
              id: previousTimer.id,
              name: previousTimer.name,
              task_id: previousTimer.task_id,
              task_name: previousTimer.is_manual ? null : previousTimer.name,
              description: previousTimer.description,
              start_time_ms: previousTimer.start_time_ms,
              end_time_ms: sampledAtMs,
              duration_secs: Math.max(
                0,
                Math.floor((sampledAtMs - previousTimer.start_time_ms) / 1000)
              ),
              is_manual: previousTimer.is_manual,
              tags: previousTimer.tags,
              billable: previousTimer.billable,
              is_backdated: previousTimer.is_backdated,
            };
            const suggested = resumedFromNoteRef.current;
            setResumedFromNote(null);
            setLastStoppedEntry(externalStopped);
            setLastStoppedAtMs(sampledAtMs);
            setIncludeBackdate(currentSettings?.autoBackdateEnabled ?? true);
            if (externalStopped.id && !externalStopped.description?.trim()) {
              setPendingNoteEntry(
                stoppedToWrapUp(externalStopped, "auto-stop", suggested)
              );
            }
            void refreshWorkProgress();
            void refreshRecentEntries();
          }
        }

        setRunningTimer(timer);

        const minBackdateSecs = (currentSettings?.minBackdateMinutes ?? 2) * 60;
        const untrackedEligible =
          !timer &&
          (currentSettings?.autoBackdateEnabled ?? true) &&
          snapshot.active_untracked_since_ms !== null &&
          snapshot.active_untracked_secs >= minBackdateSecs;

        await handleNoTimerWarning(
          snapshot.idle_duration,
          timer !== null,
          snapshot.active_untracked_since_ms
        );
        await syncExternalDisplays(
          timer,
          snapshot.active_untracked_since_ms,
          untrackedEligible
        );
      }
    } catch (err) {
      console.error("[TimerProvider] Runtime poll failed:", err);
      setIsMonitoring(true);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      isPollingRef.current = false;
      scheduleNextPoll();
    }
  }, [
    handleNoTimerWarning,
    recordHeartbeat,
    refreshRecentEntries,
    refreshWorkProgress,
    scheduleNextPoll,
    syncExternalDisplays,
  ]);

  useEffect(() => {
    pollRuntimeRef.current = pollRuntime;
  }, [pollRuntime]);

  const startQuickTimer = useCallback(
    async (options?: StartQuickTimerOptions) => {
      const s = settingsRef.current;
      if (!s?.clickupApiKey || !s?.clickupTeamId) {
        setActiveTab("settings");
        setError("Configure your ClickUp API key and Workspace ID first.");
        return;
      }

      setIsProcessing(true);
      setError(null);

      try {
        let switchedFromRunning = false;
        if (runningTimerRef.current) {
          switchedFromRunning = true;
          const prevSuggested = resumedFromNoteRef.current;
          const prevStopped = await invoke<StoppedTimeEntry>("stop_and_capture_timer", {
            apiKey: s.clickupApiKey,
            teamId: s.clickupTeamId,
          });
          setLastStoppedEntry(prevStopped);
          setLastStoppedAtMs(Date.now());
          if (prevStopped.id && !prevStopped.description?.trim()) {
            setPendingNoteEntry(
              stoppedToWrapUp(prevStopped, "manual-stop", prevSuggested)
            );
          }
          void refreshWorkProgress();
        }

        const shouldBackdate =
          !switchedFromRunning &&
          (options?.useBackdate !== undefined
            ? options.useBackdate
            : includeBackdateRef.current);

        const now = Date.now();
        const untrackedSince = activeUntrackedSinceRef.current;
        const minSecs = (s.minBackdateMinutes ?? 2) * 60;
        const maxSecs = (s.maxBackdateMinutes ?? 120) * 60;
        const untrackedElapsedSecs =
          untrackedSince !== null ? Math.floor((now - untrackedSince) / 1000) : 0;

        const backdateStartMs =
          shouldBackdate &&
          s.autoBackdateEnabled &&
          untrackedSince !== null &&
          untrackedElapsedSecs >= minSecs
            ? Math.max(untrackedSince, now - maxSecs * 1000)
            : null;

        const started = await invoke<RunningTimerInfo>("start_quick_timer", {
          apiKey: s.clickupApiKey,
          teamId: s.clickupTeamId,
          taskId: options?.taskId ?? null,
          description: options?.description ?? null,
          billable: options?.billable ?? false,
          tags: options?.tags ?? null,
          backdateStartMs,
          maxBackdateSecs: maxSecs,
        });

        setRunningTimer(started);
        setResumedFromNote(options?.resumedNote?.trim() || null);
        setActiveUntrackedSinceMs(null);
        setSampledUntrackedSecs(0);
        setMeetingResumePayload(null);
        lastNoTimerWarningAtRef.current = null;

        if (options?.taskId && options?.taskName) {
          const updated = await addRecentTask({
            id: options.taskId,
            name: options.taskName,
            projectPath: options.projectPath,
          });
          setRecentTasks(updated);
        } else if (started.task_id) {
          const updated = await addRecentTask({
            id: started.task_id,
            name: started.name,
          });
          setRecentTasks(updated);
        }

        await syncExternalDisplays(started, null, false);
        void refreshRecentEntries();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsProcessing(false);
      }
    },
    [refreshRecentEntries, refreshWorkProgress, syncExternalDisplays]
  );

  const resumeFromEntry = useCallback(
    async (entry: ResumableSession) => {
      const tagNames = Array.from(
        new Set(
          entry.tags
            .map((t) => t.name)
            .filter((name) => name.toLowerCase() !== "rt")
        )
      );

      await startQuickTimer({
        taskId: entry.is_manual ? null : entry.task_id,
        taskName: entry.is_manual ? null : entry.task_name ?? entry.name,
        description: null,
        tags: tagNames,
        billable: entry.billable,
        resumedNote: entry.description?.trim() || null,
      });
    },
    [startQuickTimer]
  );

  const stopAndWrapUp = useCallback(async () => {
    const s = settingsRef.current;
    if (!s?.clickupApiKey || !s?.clickupTeamId) return;

    setIsProcessing(true);
    setError(null);

    try {
      const suggested = resumedFromNoteRef.current;
      const stopped = await invoke<StoppedTimeEntry>("stop_and_capture_timer", {
        apiKey: s.clickupApiKey,
        teamId: s.clickupTeamId,
      });

      const now = Date.now();
      setRunningTimer(null);
      setResumedFromNote(null);
      setLastStoppedEntry(stopped);
      setLastStoppedAtMs(now);
      setActiveUntrackedSinceMs(stopped.end_time_ms);
      setSampledUntrackedSecs(0);
      setIncludeBackdate(s.autoBackdateEnabled ?? true);

      await syncExternalDisplays(null, stopped.end_time_ms, false);
      void refreshWorkProgress();
      void refreshRecentEntries();

      if (s.promptDescriptionOnStop ?? true) {
        setWrapUpEntry(stoppedToWrapUp(stopped, "manual-stop", suggested));
        setPendingNoteEntry(null);
      } else if (!stopped.description?.trim() && stopped.id) {
        setPendingNoteEntry(stoppedToWrapUp(stopped, "manual-stop", suggested));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  }, [refreshRecentEntries, refreshWorkProgress, syncExternalDisplays]);

  const saveWrapUpEntry = useCallback(
    async (entryId: string, payload: UpdateTimeEntryPayload) => {
      const s = settingsRef.current;
      if (!s?.clickupApiKey || !s?.clickupTeamId) {
        throw new Error("Settings not configured");
      }

      const updated = await invoke<TimeEntrySummary>("update_time_entry", {
        apiKey: s.clickupApiKey,
        teamId: s.clickupTeamId,
        entryId,
        payload,
      });

      setRecentEntries((prev) => {
        const exists = prev.some((item) => item.id === updated.id);
        if (exists) {
          return prev.map((item) => (item.id === updated.id ? updated : item));
        }
        return [updated, ...prev];
      });

      setLastStoppedEntry((prev) =>
        prev && prev.id === updated.id ? summaryToStopped(updated) : prev
      );

      if (updated.task_id && updated.task_name) {
        const nextRecent = await addRecentTask({
          id: updated.task_id,
          name: updated.task_name,
        });
        setRecentTasks(nextRecent);
      }

      setWrapUpEntry(null);
      setPendingNoteEntry((prev) => (prev?.id === entryId ? null : prev));
      void refreshWorkProgress();
    },
    [refreshWorkProgress]
  );

  const openWrapUp = useCallback((entry: WrapUpEntry) => {
    setWrapUpEntry(entry);
  }, []);

  const closeWrapUp = useCallback((skipped = false) => {
    setWrapUpEntry((current) => {
      if (skipped && current && !current.description.trim() && current.source === "manual-stop") {
        setPendingNoteEntry(current);
      }
      return null;
    });
  }, []);

  const dismissPendingNote = useCallback(() => {
    setPendingNoteEntry(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const dismissMeetingResume = useCallback(() => {
    setMeetingResumePayload(null);
  }, []);

  const resumeLastTimer = useCallback(async () => {
    if (!lastStoppedEntry) return;
    await resumeFromEntry(lastStoppedEntry);
  }, [lastStoppedEntry, resumeFromEntry]);

  const dismissUntrackedTime = useCallback(async () => {
    await invoke("reset_untracked_session").catch(() => {});
    setActiveUntrackedSinceMs(Date.now());
    setSampledUntrackedSecs(0);
  }, []);

  const resumeAfterMeeting = useCallback(async () => {
    const payload = meetingResumePayload;
    if (!payload) return;

    const tagNames = Array.from(
      new Set(payload.tags.filter((name) => name.toLowerCase() !== "rt"))
    );

    await startQuickTimer({
      taskId: payload.kind === "task" ? payload.task_id : null,
      taskName: payload.kind === "task" ? payload.task_name : null,
      description: null,
      tags: tagNames,
      billable: payload.billable,
      useBackdate: false,
      resumedNote: payload.description?.trim() || null,
    });
    setMeetingResumePayload(null);
  }, [meetingResumePayload, startQuickTimer]);

  const stopTimerForSystemEvent = useCallback(
    async (reason: string) => {
      const s = settingsRef.current;
      const timer = runningTimerRef.current;
      if (!s?.clickupApiKey || !s?.clickupTeamId || !timer) return;

      const suggested = resumedFromNoteRef.current;
      const stopped = await invoke<StoppedTimeEntry>("stop_and_capture_timer", {
        apiKey: s.clickupApiKey,
        teamId: s.clickupTeamId,
      });

      await sendNotification({
        title: "Timer Stopped",
        body: `Stopped "${timer.name}" (${formatDuration(stopped.duration_secs)}) because ${reason}.`,
      });

      setRunningTimer(null);
      setResumedFromNote(null);
      setLastStoppedEntry(stopped);
      setLastStoppedAtMs(Date.now());
      if (stopped.id && !stopped.description?.trim()) {
        setPendingNoteEntry(stoppedToWrapUp(stopped, "auto-stop", suggested));
      }
      await syncExternalDisplays(null, null, false);
    },
    [syncExternalDisplays]
  );

  // Initial startup loads
  useEffect(() => {
    void reloadSettings();
    getRecentTasks().then(setRecentTasks).catch(() => {});
    checkNotificationPermission().catch(() => {});
  }, [reloadSettings]);

  // Ensure "rt" tag exists & load workspace data when configured
  useEffect(() => {
    if (!settings?.clickupApiKey || !settings?.clickupTeamId) return;

    invoke<boolean>("ensure_rt_tag", {
      apiKey: settings.clickupApiKey,
      teamId: settings.clickupTeamId,
    }).catch((err) => console.debug("[TimerProvider] ensure_rt_tag failed:", err));

    void refreshWorkProgress();
    void refreshRecentEntries();
    void ensureWorkspaceTags();
  }, [
    settings?.clickupApiKey,
    settings?.clickupTeamId,
    refreshWorkProgress,
    refreshRecentEntries,
    ensureWorkspaceTags,
  ]);

  // Trigger runtime poll on settings or visibility change
  useEffect(() => {
    if (!settingsLoaded) return;
    void pollRuntime();
  }, [settingsLoaded, settings, isWindowVisible, pollRuntime]);

  // Conservative background refreshes only while visible on the Focus tab
  useEffect(() => {
    if (!isWindowVisible || !isConfigured || activeTab !== "focus") return;
    const progressTimer = window.setInterval(
      refreshWorkProgress,
      WORK_PROGRESS_REFRESH_MS
    );
    const historyTimer = window.setInterval(
      refreshRecentEntries,
      RECENT_HISTORY_REFRESH_MS
    );
    return () => {
      window.clearInterval(progressTimer);
      window.clearInterval(historyTimer);
    };
  }, [isWindowVisible, isConfigured, activeTab, refreshWorkProgress, refreshRecentEntries]);

  // Tauri native events
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let notificationUnregister: (() => void) | null = null;

    const setup = async () => {
      try {
        unlisteners.push(
          await listen(SETTINGS_UPDATED_EVENT, () => {
            void reloadSettings();
          })
        );

        unlisteners.push(
          await listen<AppVisibilityChange>("app-visibility-changed", (event) => {
            setIsWindowVisible(event.payload.visible);
          })
        );

        unlisteners.push(
          await listen<[number, number]>("save-widget-position", async (event) => {
            const [x, y] = event.payload;
            await saveWidgetPosition({ x, y });
          })
        );

        unlisteners.push(
          await listen("menu-quick-start", () => {
            if (!runningTimerRef.current) {
              void startQuickTimer();
            } else {
              invoke("show_main_window").catch(() => {});
            }
          })
        );

        unlisteners.push(
          await listen("menu-stop-timer", () => {
            setActiveTab("focus");
            if (runningTimerRef.current) {
              void stopAndWrapUp();
            }
          })
        );

        unlisteners.push(
          await listen("open-meeting-modal", async () => {
            setActiveTab("focus");
            const s = settingsRef.current;
            if (!s?.clickupApiKey || !s?.clickupTeamId) return;
            await invoke("ensure_meeting_tag", {
              apiKey: s.clickupApiKey,
              teamId: s.clickupTeamId,
            }).catch(() => {});
            await startQuickTimer({
              description: null,
              tags: ["meeting"],
              useBackdate: false,
              resumedNote: "Meeting",
            });
          })
        );

        unlisteners.push(
          await listen<MeetingResumePayload | null>("show-meeting-resume", (event) => {
            if (event.payload) {
              setMeetingResumePayload(event.payload);
            }
          })
        );

        unlisteners.push(
          await listen("system-sleep", async () => {
            try {
              await stopTimerForSystemEvent("your computer went to sleep");
            } catch (err) {
              console.error("[TimerProvider] Sleep stop failed:", err);
            }
          })
        );

        unlisteners.push(
          await listen("system-shutdown", async () => {
            try {
              await stopTimerForSystemEvent("your computer is shutting down");
            } catch (err) {
              console.error("[TimerProvider] Shutdown stop failed:", err);
            }
          })
        );

        unlisteners.push(
          await listen("app-quit-requested", async () => {
            try {
              await stopTimerForSystemEvent("the app is closing");
            } catch (err) {
              console.error("[TimerProvider] Quit stop failed:", err);
            } finally {
              await exit(0);
            }
          })
        );

        try {
          const listener = await onAction((notification) => {
            invoke("show_main_window").catch(() => {});
            setActiveTab("focus");

            const intent = notification.extra?.intent;
            if (intent === "meeting-start") {
              emit("open-meeting-modal").catch(() => {});
              return;
            }
            if (intent === "meeting-resume") {
              emit(
                "show-meeting-resume",
                notification.extra?.resume_payload ?? null
              ).catch(() => {});
            }
          });
          notificationUnregister = () => listener.unregister();
        } catch {
          // Notification action listeners are unavailable on some Linux environments.
        }
      } catch (err) {
        console.debug("[TimerProvider] Tauri event setup skipped:", err);
      }
    };

    void setup();

    return () => {
      if (pollTimeoutRef.current) {
        window.clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
      unlisteners.forEach((fn) => fn());
      if (notificationUnregister) notificationUnregister();
    };
  }, [reloadSettings, startQuickTimer, stopAndWrapUp, stopTimerForSystemEvent]);

  const value = useMemo<TimerContextValue>(
    () => ({
      activeTab,
      setActiveTab,
      isWindowVisible,
      settings,
      settingsLoaded,
      isConfigured,
      reloadSettings,
      isMonitoring,
      isProcessing,
      runningTimer,
      resumedFromNote,
      sampledIdleSeconds,
      lastIdleSampledAtMs,
      activeUntrackedSinceMs,
      isBackdateEligible,
      includeBackdate,
      setIncludeBackdate,
      lastStoppedEntry,
      lastStoppedAtMs,
      error,
      clearError,
      wrapUpEntry,
      pendingNoteEntry,
      openWrapUp,
      closeWrapUp,
      dismissPendingNote,
      recentTasks,
      workspaceTags,
      isLoadingTags,
      ensureWorkspaceTags,
      recentEntries,
      isLoadingRecentEntries,
      refreshRecentEntries,
      workProgress,
      refreshWorkProgress,
      meetingResumePayload,
      dismissMeetingResume,
      resumeAfterMeeting,
      startQuickTimer,
      resumeFromEntry,
      stopAndWrapUp,
      saveWrapUpEntry,
      resumeLastTimer,
      dismissUntrackedTime,
      refreshRuntime: pollRuntime,
    }),
    [
      activeTab,
      isWindowVisible,
      settings,
      settingsLoaded,
      isConfigured,
      reloadSettings,
      isMonitoring,
      isProcessing,
      runningTimer,
      resumedFromNote,
      sampledIdleSeconds,
      lastIdleSampledAtMs,
      activeUntrackedSinceMs,
      isBackdateEligible,
      includeBackdate,
      lastStoppedEntry,
      lastStoppedAtMs,
      error,
      clearError,
      wrapUpEntry,
      pendingNoteEntry,
      openWrapUp,
      closeWrapUp,
      dismissPendingNote,
      recentTasks,
      workspaceTags,
      isLoadingTags,
      ensureWorkspaceTags,
      recentEntries,
      isLoadingRecentEntries,
      refreshRecentEntries,
      workProgress,
      refreshWorkProgress,
      meetingResumePayload,
      dismissMeetingResume,
      resumeAfterMeeting,
      startQuickTimer,
      resumeFromEntry,
      stopAndWrapUp,
      saveWrapUpEntry,
      resumeLastTimer,
      dismissUntrackedTime,
      pollRuntime,
    ]
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) {
    throw new Error("useTimer must be used within a TimerProvider");
  }
  return ctx;
}
