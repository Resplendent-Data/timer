/**
 * Meeting detector hook.
 *
 * Polls backend meeting presence (macOS) and triggers meeting-mode notifications
 * integrated with the centralized TimerProvider.
 */

import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@/lib/notification";
import type { AppSettings } from "@/lib/store";
import type { MeetingResumePayload, RunningTimerInfo } from "@/types/timer";

const POLL_INTERVAL_MS = 60_000;
const STABLE_POLLS_REQUIRED = 2;
const MEETING_TAG_NAME = "meeting";

interface MeetingPresence {
  supported: boolean;
  in_meeting: boolean;
  app_name: string | null;
  bundle_id: string | null;
  window_title: string | null;
  reason: string | null;
  diagnostic: string | null;
}

function hasMeetingTag(tags: { name: string }[]): boolean {
  return tags.some((tag) => tag.name.toLowerCase() === MEETING_TAG_NAME);
}

function isRunningMeetingTimer(timer: RunningTimerInfo | null): boolean {
  return Boolean(timer && timer.is_manual && hasMeetingTag(timer.tags));
}

function captureResumeSnapshot(
  timer: RunningTimerInfo | null
): MeetingResumePayload | null {
  if (!timer) return null;

  if (timer.is_manual) {
    return {
      kind: "manual",
      task_id: null,
      task_name: timer.name,
      description: timer.description,
      tags: timer.tags.map((tag) => tag.name),
      billable: timer.billable,
    };
  }

  if (!timer.task_id) return null;

  return {
    kind: "task",
    task_id: timer.task_id,
    task_name: timer.name,
    description: null,
    tags: timer.tags.map((tag) => tag.name),
    billable: timer.billable,
  };
}

export function useMeetingDetector(
  runningTimer: RunningTimerInfo | null,
  settings: AppSettings | null,
  isWindowVisible: boolean
): void {
  const intervalRef = useRef<number | null>(null);
  const latestTimerRef = useRef<RunningTimerInfo | null>(runningTimer);
  const latestSettingsRef = useRef<AppSettings | null>(settings);
  const consecutiveMeetingRef = useRef(0);
  const consecutiveNotMeetingRef = useRef(0);
  const sessionActiveRef = useRef(false);
  const startPromptSentRef = useRef(false);
  const preMeetingSnapshotRef = useRef<MeetingResumePayload | null>(null);

  useEffect(() => {
    latestTimerRef.current = runningTimer;
  }, [runningTimer]);

  useEffect(() => {
    latestSettingsRef.current = settings;
  }, [settings]);

  const resetState = useCallback(() => {
    consecutiveMeetingRef.current = 0;
    consecutiveNotMeetingRef.current = 0;
    sessionActiveRef.current = false;
    startPromptSentRef.current = false;
    preMeetingSnapshotRef.current = null;
  }, []);

  const pollMeetingState = useCallback(async () => {
    try {
      const currentSettings = latestSettingsRef.current;
      if (
        !isWindowVisible ||
        !currentSettings?.meetingDetectionEnabled ||
        !currentSettings.clickupApiKey ||
        !currentSettings.clickupTeamId
      ) {
        resetState();
        return;
      }

      const presence = await invoke<MeetingPresence>("get_meeting_presence");
      if (!presence.supported) return;

      const currentTimer = latestTimerRef.current;

      if (presence.in_meeting) {
        consecutiveMeetingRef.current += 1;
        consecutiveNotMeetingRef.current = 0;

        if (consecutiveMeetingRef.current >= STABLE_POLLS_REQUIRED) {
          sessionActiveRef.current = true;

          if (!startPromptSentRef.current) {
            if (!isRunningMeetingTimer(currentTimer)) {
              preMeetingSnapshotRef.current = captureResumeSnapshot(currentTimer);

              await invoke("ensure_meeting_tag", {
                apiKey: currentSettings.clickupApiKey,
                teamId: currentSettings.clickupTeamId,
              }).catch(() => {});

              await sendNotification({
                title: "Meeting Detected",
                body: "Click to switch your timer to a meeting in 1 click.",
                extra: { intent: "meeting-start" },
              });
            }
            startPromptSentRef.current = true;
          }
        }
        return;
      }

      consecutiveNotMeetingRef.current += 1;
      consecutiveMeetingRef.current = 0;

      if (
        sessionActiveRef.current &&
        consecutiveNotMeetingRef.current >= STABLE_POLLS_REQUIRED
      ) {
        if (isRunningMeetingTimer(currentTimer) && preMeetingSnapshotRef.current) {
          await sendNotification({
            title: "Meeting Ended",
            body: "Click to resume your previous task.",
            extra: {
              intent: "meeting-resume",
              resume_payload: preMeetingSnapshotRef.current,
            },
          });
        }
        sessionActiveRef.current = false;
        startPromptSentRef.current = false;
        preMeetingSnapshotRef.current = null;
      }
    } catch (err) {
      console.debug("[useMeetingDetector] Poll failed:", err);
    }
  }, [isWindowVisible, resetState]);

  useEffect(() => {
    if (!isWindowVisible) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    void pollMeetingState();
    intervalRef.current = window.setInterval(pollMeetingState, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isWindowVisible, pollMeetingState]);
}
