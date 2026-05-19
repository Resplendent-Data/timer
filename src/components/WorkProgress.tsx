import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  AppSettings,
  DEFAULT_EXPECTED_HOURS_PER_DAY,
  DEFAULT_WORK_DAYS,
} from "../lib/store";
import { IdleStatus } from "../hooks/useIdleChecker";

interface WorkProgressProps {
  status: IdleStatus;
  settings: AppSettings | null;
  isVisible: boolean;
  nowMs: number;
}

interface WorkProgressSummary {
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

export function WorkProgress({
  status,
  settings,
  isVisible,
  nowMs,
}: WorkProgressProps) {
  const [stats, setStats] = useState<WorkProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const targetHoursPerDay =
    settings?.expectedHoursPerDay ?? DEFAULT_EXPECTED_HOURS_PER_DAY;
  const workdayCount = settings?.workdays?.length ?? DEFAULT_WORK_DAYS.length;

  const loadProgress = useCallback(async () => {
    try {
      setLoading(true);
      const nextStats = await invoke<WorkProgressSummary>("get_work_progress_summary");
      setStats(nextStats);
    } catch (error) {
      console.error("[WorkProgress] Failed to load progress:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    loadProgress();
    const interval = window.setInterval(loadProgress, 60_000);
    return () => window.clearInterval(interval);
  }, [isVisible, loadProgress]);

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
    <Card className="gap-0 py-3">
      <CardContent className="px-4">
        <div className="mb-2 flex items-end justify-between gap-2">
          <div>
            <p className="brutalist-label">Today&apos;s Work</p>
            <p className="font-mono-display text-xl font-bold tabular-nums">
              {formatSecondsAsHours(todaySeconds)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Target {formatHours(targetHoursPerDay)}
          </p>
        </div>

        <Progress
          value={progressPercent}
          className="h-2"
          indicatorClassName={progressPercent >= 100 ? "bg-success" : "bg-primary"}
        />

        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{loading ? "Loading..." : `${Math.round(progressPercent)}%`}</span>
          <span>
            Week {formatSecondsAsHours(weekSeconds)} /{" "}
            {formatHours(weeklyExpectedHours)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
