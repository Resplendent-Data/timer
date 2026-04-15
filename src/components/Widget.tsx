/**
 * Widget component for the always-on-top timer display.
 *
 * Brand-aligned minimal widget showing elapsed time.
 * Features:
 * - Draggable by clicking anywhere
 * - Click opens the main window (only if not dragging)
 * - Auto-hides when main window is focused
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Timer state received from main window */
interface TimerState {
  taskName: string | null;
  startTimeMs: number | null;
}

/**
 * Format milliseconds elapsed into a compact time string.
 */
function formatElapsedTime(startTimeMs: number): string {
  const now = Date.now();
  const elapsedMs = now - startTimeMs;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function Widget() {
  const [timerState, setTimerState] = useState<TimerState>({
    taskName: null,
    startTimeMs: null,
  });
  const [displayTime, setDisplayTime] = useState<string>("--:--");
  const [isHidden, setIsHidden] = useState(false);
  
  // Track dragging state to distinguish from clicks
  const isDraggingRef = useRef(false);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const savePositionTimeoutRef = useRef<number | null>(null);

  // Handle click to open main window - only if we didn't drag
  const handleClick = useCallback(async () => {
    // If we were dragging, don't trigger click
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    
    try {
      await invoke("show_main_window");
    } catch (error) {
      console.error("Failed to show main window:", error);
    }
  }, []);

  // Handle drag start
  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    // Only start drag on left mouse button
    if (e.button === 0) {
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = false;
      
      try {
        await getCurrentWindow().startDragging();
      } catch (error) {
        console.error("Failed to start dragging:", error);
      }
    }
  }, []);

  // Listen for timer state updates from main window
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await listen<TimerState>("widget-timer-update", (event) => {
        setTimerState(event.payload);
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Listen for visibility toggle from main window focus/blur
  useEffect(() => {
    let unlistenHide: (() => void) | null = null;
    let unlistenShow: (() => void) | null = null;

    const setup = async () => {
      unlistenHide = await listen("widget-hide", () => {
        setIsHidden(true);
      });

      unlistenShow = await listen("widget-show", () => {
        setIsHidden(false);
      });
    };

    setup();

    return () => {
      if (unlistenHide) unlistenHide();
      if (unlistenShow) unlistenShow();
    };
  }, []);

  // Update display time every second when timer is running
  useEffect(() => {
    if (!timerState.startTimeMs) {
      setDisplayTime("--:--");
      return;
    }

    // Update immediately
    setDisplayTime(formatElapsedTime(timerState.startTimeMs));

    // Update every second
    const interval = setInterval(() => {
      if (timerState.startTimeMs) {
        setDisplayTime(formatElapsedTime(timerState.startTimeMs));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timerState.startTimeMs]);

  // Save position when window is moved and detect drag
  useEffect(() => {
    let unlistenMoved: (() => void) | null = null;

    const setup = async () => {
      const currentWindow = getCurrentWindow();
      unlistenMoved = await currentWindow.onMoved(({ payload }) => {
        // Mark as dragging since we moved
        isDraggingRef.current = true;

        if (savePositionTimeoutRef.current) {
          window.clearTimeout(savePositionTimeoutRef.current);
        }

        savePositionTimeoutRef.current = window.setTimeout(() => {
          invoke("save_widget_position", {
            x: payload.x,
            y: payload.y,
          }).catch((error) => {
            console.error("Failed to save widget position:", error);
          });
        }, 200);
      });
    };

    setup();

    return () => {
      if (savePositionTimeoutRef.current) {
        window.clearTimeout(savePositionTimeoutRef.current);
        savePositionTimeoutRef.current = null;
      }
      if (unlistenMoved) unlistenMoved();
    };
  }, []);

  // If hidden, render nothing
  if (isHidden) {
    return null;
  }

  const isTimerRunning = timerState.startTimeMs !== null;

  return (
    <div
      className={`
        h-screen w-screen flex items-center justify-center 
        select-none cursor-pointer
        text-xs font-extrabold tabular-nums tracking-tight uppercase
        border
        rounded-lg
        ${isTimerRunning 
          ? "bg-primary text-primary-foreground border-primary shadow-[0_0_16px_rgba(161,110,255,0.35)]" 
          : "bg-card text-muted-foreground border-border"
        }
      `}
      style={{ fontFamily: "Muller, -apple-system, system-ui, sans-serif" }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {displayTime}
    </div>
  );
}
