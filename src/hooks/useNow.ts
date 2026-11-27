import { useEffect, useState } from "react";

/**
 * Scoped wall-clock hook that only re-renders the component that calls it.
 * When `enabled` is false (e.g., window hidden or idle), runs zero timers (0 Hz).
 */
export function useNow(enabled: boolean, intervalMs: number): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setNowMs(Date.now());
    if (!enabled || intervalMs <= 0) return;

    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);

  return nowMs;
}
