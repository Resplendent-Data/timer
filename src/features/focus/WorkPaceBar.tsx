import { useTimer } from "@/context/TimerProvider";
import { useNow } from "@/hooks/useNow";
import {
  formatHours,
  getStartOfTodayMs,
  getStartOfWeekMs,
} from "@/lib/format";
import { DEFAULT_EXPECTED_HOURS_PER_DAY, DEFAULT_WORK_DAYS } from "@/lib/store";
import { cn } from "@/lib/utils";

function runningSecondsInRange(
  startMs: number,
  rangeStartMs: number,
  nowMs: number
): number {
  const effectiveStart = Math.max(startMs, rangeStartMs);
  if (nowMs <= effectiveStart) return 0;
  return Math.floor((nowMs - effectiveStart) / 1000);
}

export function WorkPaceBar() {
  const { runningTimer, workProgress, settings, isWindowVisible } = useTimer();
  // Tenths-of-an-hour precision only needs a 30s tick while a timer is running (0 Hz when idle).
  const nowMs = useNow(isWindowVisible && runningTimer !== null, 30_000);

  const targetHoursPerDay =
    settings?.expectedHoursPerDay ?? DEFAULT_EXPECTED_HOURS_PER_DAY;
  const workdayCount = settings?.workdays?.length ?? DEFAULT_WORK_DAYS.length;
  const weeklyExpectedHours = targetHoursPerDay * workdayCount;

  const runningTodaySecs = runningTimer?.start_time_ms
    ? runningSecondsInRange(
        runningTimer.start_time_ms,
        getStartOfTodayMs(nowMs),
        nowMs
      )
    : 0;
  const runningWeekSecs = runningTimer?.start_time_ms
    ? runningSecondsInRange(
        runningTimer.start_time_ms,
        getStartOfWeekMs(nowMs),
        nowMs
      )
    : 0;

  const todaySecs = (workProgress?.session_seconds_today ?? 0) + runningTodaySecs;
  const weekSecs = (workProgress?.session_seconds_week ?? 0) + runningWeekSecs;
  const dailyTargetSecs = Math.max(targetHoursPerDay, 0) * 3600;
  const pct =
    dailyTargetSecs > 0 ? Math.min((todaySecs / dailyTargetSecs) * 100, 100) : 0;
  const metGoal = pct >= 100;

  return (
    <div className="surface-card rounded-xl px-3.5 py-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">Today</span>
          <span
            className={cn(
              "font-mono-display text-sm font-semibold",
              metGoal ? "text-success" : "text-foreground"
            )}
          >
            {formatHours(todaySecs / 3600)}
          </span>
          <span className="font-mono-display text-[11px] text-muted-foreground/80">
            / {formatHours(targetHoursPerDay)}
          </span>
        </div>

        <div className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
          <span>Week</span>
          <span className="font-mono-display font-medium text-foreground/85">
            {formatHours(weekSecs / 3600)}
          </span>
          <span className="font-mono-display text-muted-foreground/70">
            / {formatHours(weeklyExpectedHours)}
          </span>
        </div>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            metGoal
              ? "bg-success shadow-[0_0_12px_rgba(45,212,150,0.45)]"
              : "bg-gradient-to-r from-primary via-primary to-accent"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
