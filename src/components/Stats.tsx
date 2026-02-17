import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CircleHelp,
  Flame,
  Minus,
  Sparkles,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { normalizeWorkdays, parseTimeToMinutes } from "@/lib/workSchedule";
import { IdleStatus } from "../hooks/useIdleChecker";
import { getSettings } from "../lib/store";
import { FocusChart } from "./stats/FocusChart";
import { IdleHistory } from "./stats/IdleHistory";

interface IdleEvent {
  id: number;
  started_at: number;
  duration_secs: number;
  timer_stopped: boolean;
  task_name: string | null;
  task_id: string | null;
  session_duration_secs: number;
}

interface DailyActivity {
  date: string;
  active_seconds: number;
  idle_seconds: number;
  session_count: number;
  session_seconds: number;
}

interface ProductivityStats {
  // Today's activity
  active_seconds_today: number;
  idle_seconds_today: number;

  // Streaks
  current_streak: number;
  best_streak: number;

  // XP/Level
  current_xp: number;
  current_level: number;
  xp_for_next_level: number;
  xp_progress_percent: number;

  // ClickUp sessions
  sessions_today: number;
  sessions_week: number;
  session_seconds_today: number;
  session_seconds_week: number;
  avg_session_minutes: number;

  // Weekly comparison
  active_seconds_week: number;
  active_seconds_last_week: number;
  week_delta_seconds: number;

  // Charts
  last_7_days: DailyActivity[];

  // Events
  recent_events: IdleEvent[];
}

interface DailyQuest {
  id: string;
  name: string;
  hint: string;
  rewardXp: number;
  current: number;
  target: number;
  valueLabel: string;
  targetLabel: string;
}

interface HintProps {
  text: string;
}

const LEVEL_LABELS: readonly string[] = [
  "Unlicensed Spreadsheet Goblin",
  "Narwhal Forklift Operator",
  "Semicolon Smuggler",
  "Midnight CSV Yodeler",
  "SQL Grease Wizard",
  "Keyboard Doom Barista",
  "Pivot Table Chaos Intern",
  "Bug Farm Shepherd",
  "Regex Ventriloquist",
  "Dashboard Jumpscare Engineer",
  "Packet Soup Sommelier",
  "Query Goblin on Stilts",
  "Cache Coffin Locksmith",
  "YAML Weather Shaman",
  "Cron Job Fortune Teller",
  "Latency Cowboy Astronaut",
  "Data Dumpster Fire Marshal",
  "Null Pointer Exorcist",
  "API Goblet Blacksmith",
  "Narwhal Submarine Dentist",
  "Metric Poltergeist Wrangler",
  "Build Log Conspiracy Theorist",
  "Bandwidth Bonfire Juggler",
  "Schema Origami Menace",
  "Flaky Test Warlord",
  "Incident Karaoke Dictator",
  "Spreadsheet Werewolf",
  "Pipeline Catapult Operator",
  "Cursor Telepathy Intern",
  "Version Control Time Traveler",
  "Anomaly Rodeo Clown",
  "ETL Moon Priest",
  "Dashboard Thunder Medium",
  "Graph Goblin Cartographer",
  "Feature Flag Pyromancer",
  "Stack Trace Archaeopteryx",
  "Uptime Candle Dealer",
  "API Gatekeeper of Snacks",
  "Cache Voodoo Mechanic",
  "Narwhal Torpedo Sommelier",
  "KPI Dungeon Locksmith",
  "Data Lake Swamp Oracle",
  "Hyperfocus Ferret Captain",
  "Deploy Button Gladiator",
  "Packet Necromancer Deluxe",
  "Query Wizard on Rollerblades",
  "Cron Nap Overlord",
  "Bug Tribunal Supreme",
  "Timebox Witch Doctor",
  "JSON Flamenco Instructor",
  "Database Volcano Cartographer",
  "P99 Apocalypse Scout",
  "Refactor Luchador Prime",
  "YAML Summoning DJ",
  "Schema Disco Warden",
  "Incident Pajama Emperor",
  "Regex Shuriken Monk",
  "Bandwidth Kraken Shepherd",
  "Treemap Doom Bard",
  "Narwhal Mecha Admiral",
  "Telemetry Thunder Bishop",
  "Recursive Snack Prophet Plus",
  "Cloud Yak Shaman King",
  "Synthetic Data Alchemist Unbound",
  "A/B Test Chaos Pilgrim",
  "Throughput Basilisk Tamer",
  "Kubernetes Tentacle Baron",
  "Logfile Cryptid Hunter",
  "Widget Necromancer",
  "Outlier Doomsday Cartographer",
  "Index Mirage Alchemist",
  "Kernel Panic Orchestra Conductor",
  "Feature Creep Exterminator",
  "Latency Lighthouse Warlock",
  "Distributed Systems Vampire",
  "Query Catacomb Curator",
  "Narwhal Nebula Warlord",
  "Metric Black Hole Gardener",
  "Pipeline Poltergeist Supreme",
  "Dashboard Kaiju Wrangler",
  "Data Cathedral Scream Prophet",
  "Semicolon Thunder Tyrant",
  "Cache Cathedral Gargoyle",
  "Chronological Chaos Baron",
  "Anomaly Tornado Herder",
  "Graph Database Dungeon Kaiju",
  "Moonlit SQL Necromancer",
  "Galactic KPI Overmind V2",
  "Hyperdimensional Pivot Oracle",
  "Cursor Rift Commander",
  "Staging Realm Archmage",
  "Refactor Apocalypse Herald",
  "Bug Volcano Ambassador",
  "Lord of Missing Parentheses",
  "Baron of Broken Rollbacks",
  "Supreme Narwhal Time Emperor",
  "Mythic Spreadsheet Leviathan",
  "Final Boss of Focus Reality",
  "Transcendent Data Doom Oracle",
  "Omniversal Narwhal of Infinite Metrics",
];

function Hint({ text }: HintProps) {
  return (
    <span
      className="inline-flex items-center text-muted-foreground/70 hover:text-foreground"
      title={text}
      aria-label={text}
    >
      <CircleHelp className="h-3 w-3" />
    </span>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function formatMinutes(mins: number): string {
  if (mins <= 0) return "--";
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = Math.floor(mins / 60);
  const minutes = Math.round(mins % 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function levelTitle(level: number): string {
  const wholeLevel = Math.max(1, Math.floor(level));
  const cappedIndex = Math.min(wholeLevel, LEVEL_LABELS.length) - 1;
  const baseLabel = LEVEL_LABELS[cappedIndex];
  if (wholeLevel <= LEVEL_LABELS.length) {
    return baseLabel;
  }
  return `${baseLabel} +${wholeLevel - LEVEL_LABELS.length}`;
}

function runningSecondsTrackedToday(startTimeMs: number, nowMs: number): number {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const effectiveStartMs = Math.max(startTimeMs, startOfToday.getTime());
  if (nowMs <= effectiveStartMs) return 0;

  return Math.floor((nowMs - effectiveStartMs) / 1000);
}

interface StatsProps {
  status: IdleStatus;
}

export function Stats({ status }: StatsProps) {
  const [stats, setStats] = useState<ProductivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const settings = await getSettings();
      const workStartMinutes = parseTimeToMinutes(settings?.workdayStart, 8 * 60);
      const workEndMinutes = parseTimeToMinutes(settings?.workdayEnd, 17 * 60);
      const workDays = normalizeWorkdays(settings?.workdays);
      const result = await invoke<ProductivityStats>("get_productivity_stats", {
        workStartMinutes,
        workEndMinutes,
        workDays,
      });
      setStats(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 60000);
    return () => clearInterval(interval);
  }, [loadStats]);

  useEffect(() => {
    if (!status.runningTaskStartMs) return;

    setClockMs(Date.now());
    const interval = window.setInterval(() => setClockMs(Date.now()), 1000);

    return () => clearInterval(interval);
  }, [status.runningTaskStartMs]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="h-6 w-6 border-2 border-primary border-t-transparent animate-spin mx-auto" />
          <p className="text-xs text-muted-foreground mt-3 uppercase tracking-wider">
            Loading stats...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="brutalist-border p-6">
        <div className="text-center">
          <p className="text-sm text-destructive font-mono-display mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={loadStats}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const hasRunningTimer = status.runningTaskStartMs !== null;
  const runningTrackedSeconds = status.runningTaskStartMs
    ? runningSecondsTrackedToday(status.runningTaskStartMs, clockMs)
    : 0;
  const trackedTodaySeconds = stats.session_seconds_today + runningTrackedSeconds;

  const totalTodaySeconds = stats.active_seconds_today + stats.idle_seconds_today;
  const focusRatioPercent =
    totalTodaySeconds > 0
      ? Math.round((stats.active_seconds_today / totalTodaySeconds) * 100)
      : 0;
  const xpToNextLevel = Math.max(stats.xp_for_next_level - stats.current_xp, 0);

  const quests: DailyQuest[] = [
    {
      id: "active",
      name: "Deep Work Sprint",
      hint: "Log active time at your keyboard",
      rewardXp: 40,
      current: stats.active_seconds_today,
      target: 2 * 60 * 60,
      valueLabel: formatDuration(stats.active_seconds_today),
      targetLabel: "2h",
    },
    {
      id: "sessions",
      name: "Session Stacker",
      hint: "Complete focused timer blocks",
      rewardXp: 30,
      current: stats.sessions_today,
      target: 4,
      valueLabel: `${stats.sessions_today}`,
      targetLabel: "4",
    },
    {
      id: "tracked",
      name: "Timer Discipline",
      hint: "Track time on real ClickUp sessions",
      rewardXp: 35,
      current: trackedTodaySeconds,
      target: 90 * 60,
      valueLabel: formatDuration(trackedTodaySeconds),
      targetLabel: "1h 30m",
    },
  ];

  const completedQuestCount = quests.filter((quest) => quest.current >= quest.target).length;
  const earnedQuestXp = quests
    .filter((quest) => quest.current >= quest.target)
    .reduce((sum, quest) => sum + quest.rewardXp, 0);
  const activeXpToday = Math.floor(stats.active_seconds_today / 60);
  const completedQuestNames = quests
    .filter((quest) => quest.current >= quest.target)
    .map((quest) => quest.name);
  const questXpSourceText =
    completedQuestNames.length > 0
      ? completedQuestNames.join(", ")
      : "No quests completed yet";

  const weekChangePercent =
    stats.active_seconds_last_week > 0
      ? Math.round((stats.week_delta_seconds / stats.active_seconds_last_week) * 100)
      : null;
  const weekBarMax = Math.max(
    stats.active_seconds_week,
    stats.active_seconds_last_week,
    1
  );
  const thisWeekBarPercent = Math.round(
    (stats.active_seconds_week / weekBarMax) * 100
  );
  const lastWeekBarPercent = Math.round(
    (stats.active_seconds_last_week / weekBarMax) * 100
  );
  const cappedCurrentLevel = Math.min(Math.max(stats.current_level, 1), LEVEL_LABELS.length);

  const TrendIcon =
    stats.week_delta_seconds > 0
      ? TrendingUp
      : stats.week_delta_seconds < 0
      ? TrendingDown
      : Minus;

  return (
    <div className="space-y-4 pb-2">
      <div className="relative overflow-hidden brutalist-border bg-card p-4">
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rotate-12 bg-primary/10" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-20 w-32 bg-success-faint" />

        <div className="relative">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="brutalist-label flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Focus Command Center
              </p>
              <div className="mt-1 flex items-end gap-2">
                <span className="font-mono-display text-3xl font-bold">
                  Lv {stats.current_level}
                </span>
                <span className="pb-1 text-xs uppercase tracking-wider text-muted-foreground">
                  {levelTitle(stats.current_level)}
                </span>
              </div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                {stats.current_xp.toLocaleString()} XP total
                <Hint text="Level XP is permanent and comes from active app time only: 1 XP per active minute. ClickUp sessions and quest rewards help tracking goals but do not directly increase level XP." />
              </p>
            </div>

            <div className="text-right">
              <p className="brutalist-label">Streak</p>
              <div className="mt-1 flex items-center justify-end gap-1 text-primary">
                <Flame className="h-4 w-4" />
                <span className="font-mono-display text-2xl font-bold">
                  {stats.current_streak}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Best {stats.best_streak} day{stats.best_streak !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <Progress
            value={Math.max(0, Math.min(stats.xp_progress_percent, 100))}
            className="h-2 brutalist-border bg-muted"
            indicatorClassName="bg-primary"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>XP progress</span>
            <span>{xpToNextLevel.toLocaleString()} XP to next level</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="brutalist-border bg-background/60 px-2 py-1.5">
              <p className="flex items-center gap-1 text-muted-foreground">
                Quest XP Today
                <Hint
                  text={`Quest XP is a daily bonus from completed quests below. Completed: ${completedQuestCount}/${quests.length}. Sources: ${questXpSourceText}.`}
                />
              </p>
              <p className="font-mono-display font-semibold text-primary">
                +{earnedQuestXp}
              </p>
            </div>
            <div className="brutalist-border bg-background/60 px-2 py-1.5">
              <p className="text-muted-foreground">Focus Ratio</p>
              <p className="font-mono-display font-semibold">
                {focusRatioPercent}%
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Today&apos;s XP: +{activeXpToday} level XP from active time
            {earnedQuestXp > 0
              ? ` • +${earnedQuestXp} quest XP (${questXpSourceText})`
              : " • complete quests below to earn quest XP"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="brutalist-border bg-card/70 p-3">
          <p className="brutalist-label flex items-center gap-1">
            <Zap className="h-3 w-3 text-success" />
            Active Today
            <Hint text="System keyboard/mouse activity from heartbeat checks. This is not ClickUp timer data." />
          </p>
          <p className="mt-1 font-mono-display text-xl font-bold">
            {formatDuration(stats.active_seconds_today)}
          </p>
          <p className="text-xs text-muted-foreground">
            Idle {formatDuration(stats.idle_seconds_today)}
          </p>
        </div>

        <div className="brutalist-border bg-card/70 p-3">
          <p className="brutalist-label flex items-center gap-1">
            <Timer className="h-3 w-3 text-primary" />
            Tracked Today
            <Hint text="ClickUp timer time only. Includes completed sessions plus currently running timer time." />
          </p>
          <p className="mt-1 font-mono-display text-xl font-bold">
            {formatDuration(trackedTodaySeconds)}
          </p>
          <p className="text-xs text-muted-foreground">
            {stats.sessions_today} completed
            {hasRunningTimer ? " · 1 running" : ""}
          </p>
          {hasRunningTimer && status.runningTaskName && (
            <p className="truncate text-[10px] text-primary">
              {status.runningTaskName}
            </p>
          )}
        </div>

        <div className="brutalist-border bg-card/70 p-3">
          <p className="brutalist-label flex items-center gap-1">
            <Target className="h-3 w-3 text-success" />
            Weekly Sessions
            <Hint text="Count of completed ClickUp timer sessions this week." />
          </p>
          <p className="mt-1 font-mono-display text-xl font-bold">
            {stats.sessions_week}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDuration(stats.session_seconds_week)} tracked
          </p>
        </div>

        <div className="brutalist-border bg-card/70 p-3">
          <p className="brutalist-label flex items-center gap-1">
            <Trophy className="h-3 w-3 text-primary" />
            Avg Session
            <Hint text="Average duration per completed ClickUp timer session across your saved stats." />
          </p>
          <p className="mt-1 font-mono-display text-xl font-bold">
            {formatMinutes(stats.avg_session_minutes)}
          </p>
          <p className="text-xs text-muted-foreground">per completed ClickUp timer</p>
        </div>
      </div>

      <div className="brutalist-border bg-card/70 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="brutalist-label flex items-center gap-1">
            <Target className="h-3 w-3" />
            Daily Quests
            <Hint text="Gamified goals based on both heartbeat activity and ClickUp timer habits." />
          </p>
          <span className="font-mono-display text-xs text-muted-foreground">
            {completedQuestCount}/{quests.length} complete
          </span>
        </div>
        <div className="space-y-3">
          {quests.map((quest) => {
            const done = quest.current >= quest.target;
            const progress = Math.max(
              0,
              Math.min((quest.current / quest.target) * 100, 100)
            );

            return (
              <div key={quest.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p
                      className={cn(
                        "text-sm font-medium",
                        done && "text-success"
                      )}
                    >
                      {quest.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{quest.hint}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono-display text-xs">
                      {quest.valueLabel} / {quest.targetLabel}
                    </p>
                    <p
                      className={cn(
                        "text-[10px] uppercase tracking-wider",
                        done ? "text-success" : "text-muted-foreground"
                      )}
                    >
                      +{quest.rewardXp} XP
                    </p>
                  </div>
                </div>
                <Progress
                  value={progress}
                  className="h-1.5 brutalist-border bg-muted"
                  indicatorClassName={done ? "bg-success" : "bg-primary"}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="brutalist-border bg-card/70 p-4">
        <div className="mb-3 flex justify-end">
          <Hint text="7-day bars use heartbeat activity (active + idle). Hover a day to see ClickUp tracked time details." />
        </div>
        <FocusChart data={stats.last_7_days} />
      </div>

      <div className="brutalist-border bg-card/70 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="brutalist-label flex items-center gap-1">
            <TrendIcon className="h-3 w-3" />
            Weekly Momentum
            <Hint text="Compares this week's heartbeat active time against last week." />
          </p>
          <span
            className={cn(
              "font-mono-display text-xs",
              stats.week_delta_seconds > 0 && "text-success",
              stats.week_delta_seconds < 0 && "text-destructive",
              stats.week_delta_seconds === 0 && "text-muted-foreground"
            )}
          >
            {stats.week_delta_seconds > 0 && "+"}
            {stats.week_delta_seconds < 0 && "-"}
            {formatDuration(Math.abs(stats.week_delta_seconds))} vs last week
          </span>
        </div>

        <div className="space-y-2">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">This week</span>
              <span className="font-mono-display">
                {formatDuration(stats.active_seconds_week)}
              </span>
            </div>
            <div className="h-2 brutalist-border bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${thisWeekBarPercent}%` }}
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Last week</span>
              <span className="font-mono-display">
                {formatDuration(stats.active_seconds_last_week)}
              </span>
            </div>
            <div className="h-2 brutalist-border bg-muted">
              <div
                className="h-full bg-muted-foreground/60 transition-all"
                style={{ width: `${lastWeekBarPercent}%` }}
              />
            </div>
          </div>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          {weekChangePercent === null
            ? "Complete this week to unlock a momentum comparison."
            : `${Math.abs(weekChangePercent)}% ${
                weekChangePercent >= 0 ? "up" : "down"
              } compared to last week.`}
        </p>
      </div>

      <div className="brutalist-border bg-card/70 p-4">
        <div className="mb-3 flex justify-end">
          <Hint text="Logs idle-threshold events and whether a running ClickUp timer was auto-stopped." />
        </div>
        <IdleHistory events={stats.recent_events} />
      </div>

      <div className="brutalist-border bg-card/70 p-4">
        <details>
          <summary className="flex cursor-pointer items-center justify-between gap-2">
            <p className="brutalist-label flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              About Levels
            </p>
            <span className="font-mono-display text-xs text-muted-foreground">
              100 absurd ranks
            </span>
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            One title per level. Current highlight: Lv {cappedCurrentLevel}.
          </p>
          <div className="mt-3 max-h-72 overflow-y-auto brutalist-border bg-background/40 p-2">
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {LEVEL_LABELS.map((label, index) => {
                const level = index + 1;
                const isCurrent = level === cappedCurrentLevel;

                return (
                  <div
                    key={level}
                    className={cn(
                      "flex items-center justify-between gap-2 brutalist-border px-2 py-1.5 text-xs",
                      isCurrent ? "bg-primary/15 border-primary" : "bg-card/60"
                    )}
                  >
                    <span className="font-mono-display text-[11px] text-muted-foreground">
                      Lv {level}
                    </span>
                    <span className={cn("text-right", isCurrent && "font-semibold")}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={loadStats}>
          Refresh Stats
        </Button>
      </div>
    </div>
  );
}
