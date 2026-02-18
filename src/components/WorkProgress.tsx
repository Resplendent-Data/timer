import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Progress } from "@/components/ui/progress";
import { normalizeWorkdays, parseTimeToMinutes } from "@/lib/workSchedule";
import {
  DEFAULT_EXPECTED_HOURS_PER_DAY,
  DEFAULT_WORK_DAYS,
  getSettings,
} from "../lib/store";
import { IdleStatus } from "../hooks/useIdleChecker";

interface WorkProgressProps {
  status: IdleStatus;
}

interface ProductivityProgressStats {
  session_seconds_today: number;
  session_seconds_week: number;
}

function getStartOfTodayMs(nowMs: number): number {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function getStartOfWeekMs(nowMs: number): number {
  const today = new Date(nowMs);
  const daysSinceMonday = (today.getDay() + 6) % 7;
  today.setDate(today.getDate() - daysSinceMonday);
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function runningSecondsInRange(
  timerStartMs: number,
  rangeStartMs: number,
  nowMs: number
): number {
  const effectiveStartMs = Math.max(timerStartMs, rangeStartMs);
  if (nowMs <= effectiveStartMs) return 0;
  return Math.floor((nowMs - effectiveStartMs) / 1000);
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded)
    ? `${rounded.toFixed(0)}h`
    : `${rounded.toFixed(1)}h`;
}

function formatSecondsAsHours(seconds: number): string {
  return formatHours(seconds / 3600);
}

export function WorkProgress({ status }: WorkProgressProps) {
  const [stats, setStats] = useState<ProductivityProgressStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [targetHoursPerDay, setTargetHoursPerDay] = useState(
    DEFAULT_EXPECTED_HOURS_PER_DAY
  );
  const [workdayCount, setWorkdayCount] = useState(DEFAULT_WORK_DAYS.length);
  const [clockMs, setClockMs] = useState(() => Date.now());

  const loadProgress = useCallback(async () => {
    try {
      setLoading(true);
      const settings = await getSettings();

      if (!settings) {
        setStats({ session_seconds_today: 0, session_seconds_week: 0 });
        setTargetHoursPerDay(DEFAULT_EXPECTED_HOURS_PER_DAY);
        setWorkdayCount(DEFAULT_WORK_DAYS.length);
        return;
      }

      const workDays = normalizeWorkdays(settings.workdays);
      const workStartMinutes = parseTimeToMinutes(settings.workdayStart, 8 * 60);
      const workEndMinutes = parseTimeToMinutes(settings.workdayEnd, 17 * 60);
      const nextStats = await invoke<ProductivityProgressStats>(
        "get_productivity_stats",
        {
          workStartMinutes,
          workEndMinutes,
          workDays,
        }
      );

      setStats(nextStats);
      setTargetHoursPerDay(settings.expectedHoursPerDay);
      setWorkdayCount(workDays.length);
    } catch (error) {
      console.error("[WorkProgress] Failed to load progress:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProgress();
    const interval = window.setInterval(loadProgress, 60_000);
    return () => window.clearInterval(interval);
  }, [loadProgress]);

  useEffect(() => {
    if (!status.runningTaskStartMs) return;

    setClockMs(Date.now());
    const interval = window.setInterval(() => setClockMs(Date.now()), 1000);

    return () => window.clearInterval(interval);
  }, [status.runningTaskStartMs]);

  const nowMs = status.runningTaskStartMs ? clockMs : Date.now();
  const runningTodaySeconds = status.runningTaskStartMs
    ? runningSecondsInRange(
        status.runningTaskStartMs,
        getStartOfTodayMs(nowMs),
        nowMs
      )
    : 0;
  const runningWeekSeconds = status.runningTaskStartMs
    ? runningSecondsInRange(status.runningTaskStartMs, getStartOfWeekMs(nowMs), nowMs)
    : 0;

  const todaySeconds = (stats?.session_seconds_today ?? 0) + runningTodaySeconds;
  const weekSeconds = (stats?.session_seconds_week ?? 0) + runningWeekSeconds;
  const dailyTargetSeconds = Math.max(targetHoursPerDay, 0) * 3600;
  const progressPercent =
    dailyTargetSeconds > 0
      ? Math.min((todaySeconds / dailyTargetSeconds) * 100, 100)
      : 0;
  const weeklyExpectedHours = targetHoursPerDay * workdayCount;

  return (
    <div className="brutalist-border bg-card/80 p-3">
      <div className="mb-2 flex items-end justify-between gap-2">
        <div>
          <p className="brutalist-label">Today&apos;s Work</p>
          <p className="font-mono-display text-xl font-bold tabular-nums">
            {formatSecondsAsHours(todaySeconds)}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Target {formatHours(targetHoursPerDay)}</p>
      </div>

      <Progress
        value={progressPercent}
        className="h-2 brutalist-border bg-muted"
        indicatorClassName={progressPercent >= 100 ? "bg-success" : "bg-primary"}
      />

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{loading ? "Loading..." : `${Math.round(progressPercent)}%`}</span>
        <span>
          Week {formatSecondsAsHours(weekSeconds)} / {formatHours(weeklyExpectedHours)}
        </span>
      </div>
    </div>
  );
}
