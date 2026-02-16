/**
 * Meeting detector hook.
 *
 * Polls backend meeting presence and sends meeting start/end notifications.
 */

import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "../lib/store";
import { sendNotification } from "../lib/notification";
import { IdleStatus } from "./useIdleChecker";

const POLL_INTERVAL_MS = 20_000;
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

export interface MeetingResumeSnapshot {
  kind: "task" | "manual";
  task_id: string | null;
  task_name: string | null;
  description: string | null;
  tags: string[];
  billable: boolean;
}

function hasMeetingTag(tags: { name: string }[]): boolean {
  return tags.some((tag) => tag.name.toLowerCase() === MEETING_TAG_NAME);
}

function isRunningMeetingTimer(status: IdleStatus): boolean {
  return !!status.runningTaskName && status.runningTimerIsManual && hasMeetingTag(status.runningTimerTags);
}

function captureResumeSnapshot(status: IdleStatus): MeetingResumeSnapshot | null {
  if (!status.runningTaskName) {
    return null;
  }

  if (status.runningTimerIsManual) {
    return {
      kind: "manual",
      task_id: null,
      task_name: status.runningTaskName,
      description: status.runningTimerDescription,
      tags: status.runningTimerTags.map((tag) => tag.name),
      billable: status.runningTimerBillable,
    };
  }

  if (!status.runningTaskId) {
    return null;
  }

  return {
    kind: "task",
    task_id: status.runningTaskId,
    task_name: status.runningTaskName,
    description: null,
    tags: status.runningTimerTags.map((tag) => tag.name),
    billable: status.runningTimerBillable,
  };
}

/**
 * Start polling meeting presence and drive meeting-mode notifications.
 */
export function useMeetingDetector(status: IdleStatus): void {
  const intervalRef = useRef<number | null>(null);
  const latestStatusRef = useRef<IdleStatus>(status);
  const consecutiveMeetingRef = useRef(0);
  const consecutiveNotMeetingRef = useRef(0);
  const sessionActiveRef = useRef(false);
  const startPromptSentRef = useRef(false);
  const preMeetingSnapshotRef = useRef<MeetingResumeSnapshot | null>(null);
  const lastLoggedPresenceRef = useRef<{
    in_meeting: boolean;
    reason: string | null;
    diagnostic: string | null;
  } | null>(null);

  useEffect(() => {
    latestStatusRef.current = status;
  }, [status]);

  const resetState = useCallback(() => {
    consecutiveMeetingRef.current = 0;
    consecutiveNotMeetingRef.current = 0;
    sessionActiveRef.current = false;
    startPromptSentRef.current = false;
    preMeetingSnapshotRef.current = null;
    lastLoggedPresenceRef.current = null;
  }, []);

  const pollMeetingState = useCallback(async () => {
    try {
      const settings = await getSettings();
      if (
        !settings?.meetingDetectionEnabled ||
        !settings.clickupApiKey ||
        !settings.clickupTeamId
      ) {
        resetState();
        return;
      }

      const presence = await invoke<MeetingPresence>("get_meeting_presence");
      if (!presence.supported) {
        return;
      }

      const previousPresence = lastLoggedPresenceRef.current;
      const shouldLogPresence =
        !previousPresence ||
        previousPresence.in_meeting !== presence.in_meeting ||
        previousPresence.reason !== presence.reason ||
        previousPresence.diagnostic !== presence.diagnostic;
      if (shouldLogPresence) {
        console.debug("[useMeetingDetector] Presence update:", {
          in_meeting: presence.in_meeting,
          app_name: presence.app_name,
          bundle_id: presence.bundle_id,
          window_title: presence.window_title,
          reason: presence.reason,
          diagnostic: presence.diagnostic,
        });
        lastLoggedPresenceRef.current = {
          in_meeting: presence.in_meeting,
          reason: presence.reason,
          diagnostic: presence.diagnostic,
        };
      }

      const currentStatus = latestStatusRef.current;

      if (presence.in_meeting) {
        consecutiveMeetingRef.current += 1;
        consecutiveNotMeetingRef.current = 0;

        if (consecutiveMeetingRef.current >= STABLE_POLLS_REQUIRED) {
          if (!sessionActiveRef.current) {
            sessionActiveRef.current = true;
          }

          if (!startPromptSentRef.current) {
            if (!isRunningMeetingTimer(currentStatus)) {
              preMeetingSnapshotRef.current = captureResumeSnapshot(currentStatus);

              // Best effort: ensure "meeting" tag exists before modal start flow.
              await invoke("ensure_meeting_tag", {
                apiKey: settings.clickupApiKey,
                teamId: settings.clickupTeamId,
              }).catch((error) => {
                console.debug("[useMeetingDetector] Failed to ensure meeting tag:", error);
              });

              await sendNotification({
                title: "Meeting Detected",
                body: "Would you like to switch the timer to a meeting?",
                extra: {
                  intent: "meeting-start",
                },
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
        if (isRunningMeetingTimer(currentStatus) && preMeetingSnapshotRef.current) {
          await sendNotification({
            title: "Meeting Ended",
            body: "Hey, do you want to go back to your previous task?",
            extra: {
              intent: "meeting-resume",
              resume_payload: preMeetingSnapshotRef.current,
            },
          });
        }

        // End this meeting session and reset one-shot state.
        sessionActiveRef.current = false;
        startPromptSentRef.current = false;
        preMeetingSnapshotRef.current = null;
      }
    } catch (error) {
      console.debug("[useMeetingDetector] Poll failed:", error);
    }
  }, [resetState]);

  useEffect(() => {
    pollMeetingState();
    intervalRef.current = window.setInterval(pollMeetingState, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pollMeetingState]);
}
