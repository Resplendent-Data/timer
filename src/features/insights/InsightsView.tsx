import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  Flame,
  Minus,
  RefreshCw,
  Sparkles,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimer } from "@/context/TimerProvider";
import { useNow } from "@/hooks/useNow";
import {
  formatDuration,
  formatMinutes,
  getStartOfTodayMs,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { normalizeWorkdays, parseTimeToMinutes } from "@/lib/workSchedule";
import type { ProductivityStats, TeamLeaderboardResponse } from "@/types/timer";
import { FocusChart } from "./FocusChart";
import { IdleHistory } from "./IdleHistory";
import { TeamLeaderboard } from "./TeamLeaderboard";

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

function levelTitle(level: number): string {
  const whole = Math.max(1, Math.floor(level));
  const idx = Math.min(whole, LEVEL_LABELS.length) - 1;
  const label = LEVEL_LABELS[idx];
  return whole <= LEVEL_LABELS.length
    ? label
    : `${label} +${whole - LEVEL_LABELS.length}`;
}

interface DailyQuest {
  id: string;
  name: string;
  rewardXp: number;
  current: number;
  target: number;
  valueLabel: string;
  targetLabel: string;
}

export function InsightsView() {
  const { runningTimer, settings, isWindowVisible, isConfigured } =
    useTimer();
  const nowMs = useNow(isWindowVisible && runningTimer !== null, 30_000);

  const [stats, setStats] = useState<ProductivityStats | null>(null);
  const [leaderboard, setLeaderboard] =
    useState<TeamLeaderboardResponse | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const workStartMinutes = parseTimeToMinutes(settings?.workdayStart, 8 * 60);
      const workEndMinutes = parseTimeToMinutes(settings?.workdayEnd, 17 * 60);
      const workDays = normalizeWorkdays(settings?.workdays);

      const apiKey = settings?.clickupApiKey ?? "";
      const teamId = settings?.clickupTeamId ?? "";
      const clickupOk = Boolean(apiKey && teamId);
      setLeaderboardLoading(clickupOk);
      if (!clickupOk) {
        setLeaderboard(null);
        setLeaderboardError(null);
      }

      const statsPromise = invoke<ProductivityStats>("get_productivity_stats", {
        workStartMinutes,
        workEndMinutes,
        workDays,
      });

      const leaderboardPromise = clickupOk
        ? invoke<TeamLeaderboardResponse>("get_clickup_team_leaderboard", {
            apiKey,
            teamId,
          })
            .then((res) => {
              setLeaderboardError(null);
              return res;
            })
            .catch((err) => {
              setLeaderboardError(
                err instanceof Error ? err.message : String(err)
              );
              return null;
            })
        : Promise.resolve(null);

      const [nextStats, nextLeaderboard] = await Promise.all([
        statsPromise,
        leaderboardPromise,
      ]);
      setStats(nextStats);
      if (clickupOk && nextLeaderboard) {
        setLeaderboard(nextLeaderboard);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLeaderboardLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    if (!isWindowVisible) return;
    void loadStats();
    const interval = window.setInterval(loadStats, 60_000);
    return () => window.clearInterval(interval);
  }, [isWindowVisible, loadStats]);

  if (loading && !stats) {
    return (
      <div className="surface-card flex flex-col items-center justify-center rounded-2xl py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="mt-3 text-xs text-muted-foreground">Loading insights...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface-card rounded-2xl p-5 text-center space-y-3">
        <p className="text-xs text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void loadStats()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!stats) return null;

  const startOfToday = getStartOfTodayMs(nowMs);
  const runningTodaySecs =
    runningTimer && runningTimer.start_time_ms > 0
      ? Math.max(
          0,
          Math.floor(
            (nowMs - Math.max(runningTimer.start_time_ms, startOfToday)) / 1000
          )
        )
      : 0;
  const trackedTodaySecs = stats.session_seconds_today + runningTodaySecs;

  const totalTodaySecs = stats.active_seconds_today + stats.idle_seconds_today;
  const focusRatio =
    totalTodaySecs > 0
      ? Math.round((stats.active_seconds_today / totalTodaySecs) * 100)
      : 0;
  const xpToNext = Math.max(stats.xp_for_next_level - stats.current_xp, 0);
  const cappedLevel = Math.min(Math.max(stats.current_level, 1), LEVEL_LABELS.length);

  const quests: DailyQuest[] = [
    {
      id: "active",
      name: "Deep Work Sprint",
      rewardXp: 40,
      current: stats.active_seconds_today,
      target: 2 * 3600,
      valueLabel: formatDuration(stats.active_seconds_today),
      targetLabel: "2h",
    },
    {
      id: "sessions",
      name: "Session Stacker",
      rewardXp: 30,
      current: stats.sessions_today,
      target: 4,
      valueLabel: `${stats.sessions_today}`,
      targetLabel: "4",
    },
    {
      id: "tracked",
      name: "Timer Discipline",
      rewardXp: 35,
      current: trackedTodaySecs,
      target: 90 * 60,
      valueLabel: formatDuration(trackedTodaySecs),
      targetLabel: "1h 30m",
    },
  ];
  const completedQuests = quests.filter((q) => q.current >= q.target).length;

  const weekMax = Math.max(
    stats.active_seconds_week,
    stats.active_seconds_last_week,
    1
  );
  const thisWeekPct = Math.round((stats.active_seconds_week / weekMax) * 100);
  const lastWeekPct = Math.round((stats.active_seconds_last_week / weekMax) * 100);
  const TrendIcon =
    stats.week_delta_seconds > 0
      ? TrendingUp
      : stats.week_delta_seconds < 0
      ? TrendingDown
      : Minus;

  return (
    <div className="space-y-3 pb-6">
      {/* Rank & Streak Hero */}
      <section className="surface-card relative overflow-hidden rounded-2xl p-4">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-25 blur-2xl"
          style={{ background: "radial-gradient(circle, #9d74ff, transparent)" }}
        />

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="section-eyebrow inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" />
              Focus Rank
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono-display text-2xl font-bold text-foreground">
                Lv {stats.current_level}
              </span>
              <span className="truncate text-xs font-medium text-accent">
                {levelTitle(stats.current_level)}
              </span>
            </div>
            <p className="mt-0.5 font-mono-display text-[11px] text-muted-foreground">
              {stats.current_xp.toLocaleString()} XP · {focusRatio}% focus ratio
            </p>
          </div>

          <div className="shrink-0 rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2 text-right">
            <div className="flex items-center justify-end gap-1 text-accent">
              <Flame className="h-4 w-4" />
              <span className="font-mono-display text-xl font-bold">
                {stats.current_streak}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Best {stats.best_streak}d
            </p>
          </div>
        </div>

        <div className="mt-3.5 space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
              style={{
                width: `${Math.max(0, Math.min(stats.xp_progress_percent, 100))}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>1 XP per active minute</span>
            <span className="font-mono-display">
              {xpToNext.toLocaleString()} XP to Lv {stats.current_level + 1}
            </span>
          </div>
        </div>
      </section>

      {/* 2x2 Bento KPIs */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="surface-card rounded-2xl p-3.5">
          <p className="section-eyebrow flex items-center gap-1">
            <Zap className="h-3 w-3 text-success" />
            Active Today
          </p>
          <p className="mt-1.5 font-mono-display text-xl font-bold text-foreground">
            {formatDuration(stats.active_seconds_today)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Idle {formatDuration(stats.idle_seconds_today)}
          </p>
        </div>

        <div className="surface-card rounded-2xl p-3.5">
          <p className="section-eyebrow flex items-center gap-1">
            <Timer className="h-3 w-3 text-accent" />
            Tracked Today
          </p>
          <p className="mt-1.5 font-mono-display text-xl font-bold text-foreground">
            {formatDuration(trackedTodaySecs)}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {stats.sessions_today} completed
            {runningTimer ? " · 1 live" : ""}
          </p>
        </div>

        <div className="surface-card rounded-2xl p-3.5">
          <p className="section-eyebrow flex items-center gap-1">
            <Target className="h-3 w-3 text-primary" />
            Week Sessions
          </p>
          <p className="mt-1.5 font-mono-display text-xl font-bold text-foreground">
            {stats.sessions_week}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {formatDuration(stats.session_seconds_week)} total
          </p>
        </div>

        <div className="surface-card rounded-2xl p-3.5">
          <p className="section-eyebrow flex items-center gap-1">
            <Trophy className="h-3 w-3 text-accent" />
            Avg Session
          </p>
          <p className="mt-1.5 font-mono-display text-xl font-bold text-foreground">
            {formatMinutes(stats.avg_session_minutes)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            per completed timer
          </p>
        </div>
      </div>

      {/* Daily Quests */}
      <section className="surface-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="section-eyebrow flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-primary" />
            Daily Quests
          </span>
          <span className="font-mono-display text-[11px] text-muted-foreground">
            {completedQuests}/{quests.length} complete
          </span>
        </div>

        <div className="space-y-2.5">
          {quests.map((quest) => {
            const done = quest.current >= quest.target;
            const pct = Math.min((quest.current / quest.target) * 100, 100);
            return (
              <div key={quest.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 font-medium",
                      done ? "text-success" : "text-foreground"
                    )}
                  >
                    {done && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {quest.name}
                  </span>
                  <span className="font-mono-display text-[11px] text-muted-foreground">
                    {quest.valueLabel} / {quest.targetLabel}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      done ? "bg-success" : "bg-primary"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 7-Day Activity */}
      <section className="surface-card rounded-2xl p-4">
        <FocusChart data={stats.last_7_days} />
      </section>

      {/* Weekly Momentum */}
      <section className="surface-card rounded-2xl p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="section-eyebrow flex items-center gap-1.5">
            <TrendIcon className="h-3.5 w-3.5" />
            Weekly Momentum
          </span>
          <span
            className={cn(
              "font-mono-display text-xs font-medium",
              stats.week_delta_seconds > 0
                ? "text-success"
                : stats.week_delta_seconds < 0
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {stats.week_delta_seconds > 0 ? "+" : stats.week_delta_seconds < 0 ? "-" : ""}
            {formatDuration(Math.abs(stats.week_delta_seconds))} vs last wk
          </span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">This week</span>
              <span className="font-mono-display font-medium">
                {formatDuration(stats.active_seconds_week)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${thisWeekPct}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last week</span>
              <span className="font-mono-display text-muted-foreground">
                {formatDuration(stats.active_seconds_last_week)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-white/25"
                style={{ width: `${lastWeekPct}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Team Leaderboard */}
      <TeamLeaderboard
        leaderboard={leaderboard}
        loading={leaderboardLoading}
        error={leaderboardError}
        hasClickupConfig={isConfigured}
      />

      {/* Interruption Feed */}
      <IdleHistory events={stats.recent_events} />

      {/* Collapsible 100 Absurd Ranks */}
      <details className="surface-card rounded-2xl px-4 py-3">
        <summary className="flex cursor-pointer items-center justify-between text-xs">
          <span className="section-eyebrow inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-accent" />
            All 100 Rank Titles
          </span>
          <span className="font-mono-display text-[11px] text-muted-foreground">
            Current: Lv {cappedLevel}
          </span>
        </summary>
        <div className="mt-3 grid max-h-60 grid-cols-1 gap-1 overflow-y-auto pr-1">
          {LEVEL_LABELS.map((label, idx) => {
            const lvl = idx + 1;
            const current = lvl === cappedLevel;
            return (
              <div
                key={lvl}
                className={cn(
                  "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs",
                  current
                    ? "border border-primary/40 bg-primary/15 font-semibold text-foreground"
                    : "bg-white/[0.02] text-muted-foreground"
                )}
              >
                <span className="font-mono-display text-[11px]">Lv {lvl}</span>
                <span className="truncate pl-2 text-right">{label}</span>
              </div>
            );
          })}
        </div>
      </details>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadStats()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh Insights
        </Button>
      </div>
    </div>
  );
}
