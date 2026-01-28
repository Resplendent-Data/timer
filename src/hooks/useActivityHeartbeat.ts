/**
 * React hook that sends heartbeats to track user activity time.
 *
 * This hook runs every 30 seconds and reports whether the user is currently
 * idle or active. The Rust backend accumulates this data to track daily
 * active/idle time for the stats screen.
 */

import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Heartbeat interval in milliseconds (must match Rust HEARTBEAT_INTERVAL_SECS * 1000) */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Idle threshold in seconds - if idle time exceeds this, consider user idle */
const IDLE_THRESHOLD_SECS = 60;

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

      // User is considered idle if they've been inactive for more than threshold
      const isIdle = idleSeconds >= IDLE_THRESHOLD_SECS;

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
