/**
 * React hook that sends heartbeats to track user activity time.
 *
 * This hook runs every 30 seconds and reports whether the user is currently
 * idle or active. The Rust backend accumulates this data to track daily
 * active/idle time for the stats screen.
 */

import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "../lib/store";

/** Heartbeat interval in milliseconds (must match Rust HEARTBEAT_INTERVAL_SECS * 1000) */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Lower bound for stats idle threshold */
const MIN_IDLE_THRESHOLD_SECS = 60;

/**
 * Hook that sends activity heartbeats to the backend every 30 seconds.
 * Tracks whether the user is active or idle for stats purposes.
 */
export function useActivityHeartbeat(): void {
  const intervalRef = useRef<number | null>(null);

  const sendHeartbeat = useCallback(async () => {
    try {
      // Get current idle time from the system
      const idleSeconds = await invoke<number>("get_idle_time");

      // Align stats classification with the configured idle threshold.
      const settings = await getSettings();
      const configuredThresholdSecs = (settings?.idleThresholdMinutes ?? 10) * 60;
      const idleThresholdSecs = Math.max(
        MIN_IDLE_THRESHOLD_SECS,
        configuredThresholdSecs
      );
      const isIdle = idleSeconds >= idleThresholdSecs;

      // Send heartbeat to backend
      await invoke("record_heartbeat", { isIdle });
    } catch (error) {
      // Silently ignore errors - heartbeats are best-effort
      console.debug("Heartbeat failed:", error);
    }
  }, []);

  useEffect(() => {
    // Send first heartbeat immediately
    sendHeartbeat();

    // Then send every 30 seconds
    intervalRef.current = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sendHeartbeat]);
}
