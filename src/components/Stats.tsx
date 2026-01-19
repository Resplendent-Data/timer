import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XPProgressBar } from "./stats/XPProgressBar";
import { StreakDisplay } from "./stats/StreakDisplay";
import { WeeklyRank } from "./stats/WeeklyRank";
import { StatCard } from "./stats/StatCard";
import { FocusChart } from "./stats/FocusChart";
import { IdleHistory } from "./stats/IdleHistory";

interface IdleEvent {
  id: number;
  started_at: number;
  duration_secs: number;
  timer_stopped: boolean;
  task_name: string | null;
  task_id: string | null;
}

interface DailyStats {
  date: string;
  focus_minutes: number;
  idle_count: number;
  longest_focus_mins: number;
}

interface ProductivityStats {
  current_xp: number;
  current_level: number;
  xp_for_next_level: number;
  xp_progress_percent: number;
  current_streak: number;
  best_streak: number;
  weekly_rank: number;
  weekly_rank_trend: number;
  total_focus_minutes_today: number;
  total_idle_count_today: number;
  total_focus_minutes_week: number;
  average_focus_minutes: number;
  recent_events: IdleEvent[];
  last_7_days: DailyStats[];
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
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
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span>⚡</span> Level & XP
          </CardTitle>
        </CardHeader>
        <CardContent>
          <XPProgressBar
            currentXp={stats.current_xp}
            level={stats.current_level}
            xpForNextLevel={stats.xp_for_next_level}
            progressPercent={stats.xp_progress_percent}
          />
        </CardContent>
      </Card>

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

      <Card>
        <CardContent className="pt-4">
          <FocusChart data={stats.last_7_days} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <WeeklyRank rank={stats.weekly_rank} trend={stats.weekly_rank_trend} />
        </div>
        <StatCard
          title="Focus Today"
          value={formatMinutes(stats.total_focus_minutes_today)}
          icon="🎯"
          variant="highlight"
        />
        <StatCard
          title="This Week"
          value={formatMinutes(stats.total_focus_minutes_week)}
          icon="📅"
        />
        <StatCard
          title="Avg Focus"
          value={formatMinutes(Math.round(stats.average_focus_minutes))}
          subtitle="per active day"
          icon="📈"
        />
        <StatCard
          title="Idle Today"
          value={stats.total_idle_count_today}
          subtitle={stats.total_idle_count_today === 1 ? "time" : "times"}
          icon="💤"
          variant="muted"
        />
      </div>

      <Card>
        <CardContent className="pt-4">
          <IdleHistory events={stats.recent_events} />
        </CardContent>
      </Card>
    </div>
  );
}
