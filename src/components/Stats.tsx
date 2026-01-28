import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TodayActivity } from "./stats/TodayActivity";
import { XPProgressBar } from "./stats/XPProgressBar";
import { StreakDisplay } from "./stats/StreakDisplay";
import { WeeklyProgress } from "./stats/WeeklyProgress";
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

function formatMinutes(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = Math.floor(mins / 60);
  const minutes = Math.round(mins % 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function Stats() {
  const [stats, setStats] = useState<ProductivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<ProductivityStats>("get_productivity_stats");
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

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <p className="text-2xl animate-pulse">📊</p>
          <p className="text-sm text-muted-foreground mt-2">Loading stats...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <p className="text-2xl mb-2">😵</p>
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={loadStats}>
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-4">
      {/* Today's Activity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span>📊</span> Today
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TodayActivity
            activeSeconds={stats.active_seconds_today}
            idleSeconds={stats.idle_seconds_today}
          />
        </CardContent>
      </Card>

      {/* Streak */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span>🔥</span> Streak
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StreakDisplay
            currentStreak={stats.current_streak}
            bestStreak={stats.best_streak}
          />
        </CardContent>
      </Card>

      {/* Weekly Chart */}
      <Card>
        <CardContent className="pt-4">
          <FocusChart data={stats.last_7_days} />
        </CardContent>
      </Card>

      {/* XP/Level and Sessions Grid */}
      <div className="grid grid-cols-2 gap-2">
        {/* Level & XP */}
        <Card className="col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span>⚡</span> Level
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <XPProgressBar
              currentXp={stats.current_xp}
              level={stats.current_level}
              xpForNextLevel={stats.xp_for_next_level}
              progressPercent={stats.xp_progress_percent}
            />
          </CardContent>
        </Card>

        {/* Sessions */}
        <Card className="col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span>🎯</span> Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-2xl font-bold">{stats.sessions_today}</span>
              <span className="text-xs text-muted-foreground">today</span>
            </div>
            <div className="flex justify-between items-baseline text-sm">
              <span className="font-medium">{stats.sessions_week}</span>
              <span className="text-xs text-muted-foreground">this week</span>
            </div>
            {stats.avg_session_minutes > 0 && (
              <p className="text-xs text-muted-foreground">
                Avg: {formatMinutes(stats.avg_session_minutes)} per session
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weekly Progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span>🏆</span> This Week
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WeeklyProgress
            activeSecondsWeek={stats.active_seconds_week}
            activeSecondsLastWeek={stats.active_seconds_last_week}
            weekDeltaSeconds={stats.week_delta_seconds}
          />
        </CardContent>
      </Card>

      {/* Idle History */}
      <Card>
        <CardContent className="pt-4">
          <IdleHistory events={stats.recent_events} />
        </CardContent>
      </Card>
    </div>
  );
}
