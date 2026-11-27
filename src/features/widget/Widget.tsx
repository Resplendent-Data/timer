/**
 * Always-on-top interactive floating pill widget.
 *
 * - Draggable anywhere on the pill body
 * - Click opens the main window (unless dragged)
 * - Direct 1-click Play / Stop button right on the pill
 * - Shows running elapsed time OR amber untracked active duration
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Play, Square } from "lucide-react";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WidgetTimerPayload } from "@/types/timer";

export function Widget() {
  const [state, setState] = useState<WidgetTimerPayload>({
    taskName: null,
    startTimeMs: null,
    isBackdated: false,
    untrackedSinceMs: null,
    untrackedEligible: false,
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isHidden, setIsHidden] = useState(false);

  const isDraggingRef = useRef(false);
  const savePositionTimeoutRef = useRef<number | null>(null);

  const isRunning = state.startTimeMs !== null;
  const showUntracked = !isRunning && state.untrackedEligible && state.untrackedSinceMs !== null;

  const handleOpenMain = useCallback(async () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    try {
      await invoke("show_main_window");
    } catch (err) {
      console.error("[Widget] Failed to show main window:", err);
    }
  }, []);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;

    isDraggingRef.current = false;
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.error("[Widget] Failed to start dragging:", err);
    }
  }, []);

  const handleToggleTimer = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await invoke("widget_toggle_timer", { isRunning });
      } catch (err) {
        console.error("[Widget] Failed to toggle timer:", err);
      }
    },
    [isRunning]
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await listen<WidgetTimerPayload>("widget-timer-update", (event) => {
        setState(event.payload);
      });
    };
    void setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    let unlistenHide: (() => void) | null = null;
    let unlistenShow: (() => void) | null = null;
    const setup = async () => {
      unlistenHide = await listen("widget-hide", () => setIsHidden(true));
      unlistenShow = await listen("widget-show", () => setIsHidden(false));
    };
    void setup();
    return () => {
      if (unlistenHide) unlistenHide();
      if (unlistenShow) unlistenShow();
    };
  }, []);

  useEffect(() => {
    if (!isRunning && !showUntracked) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isRunning, showUntracked]);

  useEffect(() => {
    let unlistenMoved: (() => void) | null = null;
    const setup = async () => {
      const currentWindow = getCurrentWindow();
      unlistenMoved = await currentWindow.onMoved(({ payload }) => {
        isDraggingRef.current = true;
        if (savePositionTimeoutRef.current) {
          window.clearTimeout(savePositionTimeoutRef.current);
        }
        savePositionTimeoutRef.current = window.setTimeout(() => {
          invoke("save_widget_position", {
            x: payload.x,
            y: payload.y,
          }).catch(() => {});
        }, 200);
      });
    };
    void setup();
    return () => {
      if (savePositionTimeoutRef.current) {
        window.clearTimeout(savePositionTimeoutRef.current);
      }
      if (unlistenMoved) unlistenMoved();
    };
  }, []);

  if (isHidden) return null;

  const displayLabel = isRunning
    ? formatClock(nowMs - (state.startTimeMs ?? nowMs))
    : showUntracked
    ? `+${formatClock(nowMs - (state.untrackedSinceMs ?? nowMs))}`
    : "Ready";

  return (
    <div
      onMouseDown={handleMouseDown}
      onClick={() => void handleOpenMain()}
      className={cn(
        "flex h-screen w-screen select-none items-center justify-between rounded-full border pl-3 pr-1.5 transition-colors cursor-pointer",
        isRunning
          ? "border-success/40 bg-[#121622] text-[#fde6a4] shadow-[0_0_20px_rgba(45,212,150,0.22)]"
          : showUntracked
          ? "border-accent/40 bg-[#171624] text-accent"
          : "border-white/12 bg-[#12131d] text-muted-foreground"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            isRunning
              ? "bg-success animate-pulse"
              : showUntracked
              ? "bg-accent"
              : "bg-white/25"
          )}
        />
        <span className="font-mono-display text-xs font-semibold tracking-tight">
          {displayLabel}
        </span>
      </div>

      <button
        type="button"
        onClick={(e) => void handleToggleTimer(e)}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
          isRunning
            ? "bg-destructive/20 text-destructive hover:bg-destructive hover:text-white"
            : showUntracked
            ? "bg-accent text-accent-foreground hover:brightness-110"
            : "bg-primary/20 text-primary hover:bg-primary hover:text-primary-foreground"
        )}
        title={isRunning ? "End Session & Add Note" : "Start Timer"}
        aria-label={isRunning ? "End Session" : "Start Timer"}
      >
        {isRunning ? (
          <Square className="h-3 w-3 fill-current" />
        ) : (
          <Play className="h-3 w-3 fill-current translate-x-[0.5px]" />
        )}
      </button>
    </div>
  );
}
