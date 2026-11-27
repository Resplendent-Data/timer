import { useMemo, useState } from "react";
import { Crown, Flame, Users } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TeamLeaderboardResponse } from "@/types/timer";

interface TeamLeaderboardProps {
  leaderboard: TeamLeaderboardResponse | null;
  loading: boolean;
  error: string | null;
  hasClickupConfig: boolean;
}

function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function TeamLeaderboard({
  leaderboard,
  loading,
  error,
  hasClickupConfig,
}: TeamLeaderboardProps) {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const users = leaderboard?.users ?? [];

  const maxTotalSeconds = useMemo(
    () => Math.max(...users.map((u) => u.total_seconds), 1),
    [users]
  );

  const topUser = users[0] ?? null;
  const totalTeamSeconds = users.reduce((sum, u) => sum + u.total_seconds, 0);

  if (!hasClickupConfig) {
    return (
      <section className="surface-card rounded-2xl p-4">
        <p className="section-eyebrow flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Team Leaderboard
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Connect ClickUp in Settings to view your workspace leaderboard.
        </p>
      </section>
    );
  }

  if (loading && !leaderboard) {
    return (
      <section className="surface-card rounded-2xl p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading team leaderboard...
        </div>
      </section>
    );
  }

  if (error && !leaderboard) {
    return (
      <section className="surface-card rounded-2xl p-4 space-y-2">
        <p className="section-eyebrow flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Team Leaderboard
        </p>
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      </section>
    );
  }

  if (!leaderboard) return null;

  return (
    <section className="surface-card rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="section-eyebrow flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Team Leaderboard · {leaderboard.window_days}d
          </p>
          {topUser && (
            <p className="mt-1 flex items-center gap-1.5 text-xs">
              <Crown className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="truncate font-semibold text-foreground">
                {topUser.username}
              </span>
              <span className="shrink-0 text-muted-foreground">
                leads · {formatDuration(topUser.total_seconds)}
              </span>
            </p>
          )}
        </div>
        <div className="shrink-0 text-right font-mono-display text-[11px] text-muted-foreground">
          <p>{formatDuration(totalTeamSeconds)}</p>
          <p>{users.length} active</p>
        </div>
      </div>

      {leaderboard.is_partial && leaderboard.warning && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          {leaderboard.warning}
        </div>
      )}

      {users.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">
          No tracked team time in the last {leaderboard.window_days} days.
        </p>
      ) : (
        <div className="space-y-2">
          {users.map((user, idx) => {
            const rank = idx + 1;
            const totalPct = Math.max((user.total_seconds / maxTotalSeconds) * 100, 4);
            const livePct =
              user.total_seconds > 0
                ? (user.active_seconds / user.total_seconds) * 100
                : 0;
            const pastPct = Math.max(0, 100 - livePct);
            const hasAvatar = Boolean(
              user.profile_picture && !brokenImages[user.user_id]
            );
            const isLive = user.running_entry_count > 0;

            return (
              <div
                key={user.user_id}
                className={cn(
                  "rounded-xl border px-3 py-2.5 transition-colors",
                  rank === 1
                    ? "border-accent/35 bg-accent/[0.06]"
                    : isLive
                    ? "border-success/30 bg-success/[0.05]"
                    : "border-white/[0.07] bg-white/[0.02]"
                )}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "w-5 shrink-0 font-mono-display text-xs font-semibold",
                        rank === 1 ? "text-accent" : "text-muted-foreground"
                      )}
                    >
                      #{rank}
                    </span>

                    <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
                      {hasAvatar ? (
                        <img
                          src={user.profile_picture ?? ""}
                          alt={user.username}
                          className="h-full w-full object-cover"
                          onError={() =>
                            setBrokenImages((prev) => ({
                              ...prev,
                              [user.user_id]: true,
                            }))
                          }
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted-foreground">
                          {initialsFromName(user.username)}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {user.username}
                        </p>
                        {isLive && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                            <Flame className="h-2.5 w-2.5" />
                            Live
                          </span>
                        )}
                      </div>
                      <p className="font-mono-display text-[10px] text-muted-foreground">
                        {formatDuration(user.past_seconds)} logged
                        {user.active_seconds > 0
                          ? ` · +${formatDuration(user.active_seconds)} live`
                          : ""}
                      </p>
                    </div>
                  </div>

                  <span className="shrink-0 font-mono-display text-xs font-semibold text-foreground">
                    {formatDuration(user.total_seconds)}
                  </span>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="flex h-full min-w-[4px] overflow-hidden rounded-full"
                    style={{ width: `${totalPct}%` }}
                  >
                    {livePct > 0 && (
                      <div
                        className="h-full bg-success"
                        style={{ width: `${livePct}%` }}
                      />
                    )}
                    {pastPct > 0 && (
                      <div
                        className="h-full bg-primary/85"
                        style={{ width: `${pastPct}%` }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {leaderboard.debug_details && (
        <details className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">API details</summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono-display text-[10px]">
            {leaderboard.debug_details}
          </pre>
        </details>
      )}
    </section>
  );
}
