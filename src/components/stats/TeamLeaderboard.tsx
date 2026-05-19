import { useMemo, useState } from "react";
import { Crown, Flame, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface TeamLeaderboardUser {
  user_id: string;
  username: string;
  profile_picture: string | null;
  active_seconds: number;
  past_seconds: number;
  total_seconds: number;
  running_entry_count: number;
}

export interface TeamLeaderboardResponse {
  window_days: number;
  generated_at_ms: number;
  is_partial: boolean;
  warning: string | null;
  debug_details: string | null;
  users: TeamLeaderboardUser[];
}

interface TeamLeaderboardProps {
  leaderboard: TeamLeaderboardResponse | null;
  loading: boolean;
  error: string | null;
  hasClickupConfig: boolean;
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

function rankContainerClass(rank: number): string {
  if (rank === 1) return "border-accent/70 bg-accent/15";
  if (rank === 2) return "border-primary/60 bg-primary/12";
  if (rank === 3) return "border-success/60 bg-success/12";
  return "bg-background/45";
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
    () => Math.max(...users.map((user) => user.total_seconds), 1),
    [users]
  );
  const topUser = users[0] ?? null;
  const totalTeamSeconds = users.reduce((sum, user) => sum + user.total_seconds, 0);

  if (!hasClickupConfig) {
    return (
      <Card className="gap-0 py-0">
        <CardContent className="px-4 py-4">
        <p className="brutalist-label flex items-center gap-1">
          <Users className="h-3 w-3" />
          Team Time Showdown
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect ClickUp in Config to unlock leaderboard.
        </p>
        </CardContent>
      </Card>
    );
  }

  if (loading && !leaderboard) {
    return (
      <Card className="gap-0 py-0">
        <CardContent className="px-4 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
          Loading team leaderboard...
        </div>
        </CardContent>
      </Card>
    );
  }

  if (error && !leaderboard) {
    return (
      <Card className="gap-0 py-0">
        <CardContent className="px-4 py-4">
        <p className="brutalist-label flex items-center gap-1">
          <Users className="h-3 w-3" />
          Team Time Showdown
        </p>
        <Alert variant="destructive" className="mt-3">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!leaderboard) return null;

  if (users.length === 0) {
    return (
      <Card className="gap-0 py-0">
        <CardContent className="px-4 py-4">
        <p className="brutalist-label flex items-center gap-1">
          <Users className="h-3 w-3" />
          Team Time Showdown
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          No tracked team time in last {leaderboard.window_days} days.
        </p>
        {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-0">
      <CardContent className="space-y-3 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="brutalist-label flex items-center gap-1">
            <Users className="h-3 w-3" />
            Team Time Showdown
          </p>
          {topUser ? (
            <p className="mt-1 flex items-center gap-1 text-sm">
              <Crown className="h-4 w-4 text-accent" />
              <span className="font-semibold">{topUser.username}</span>
              <span className="text-muted-foreground">
                leads with {formatDuration(topUser.total_seconds)}
              </span>
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Active (live timers) + past {leaderboard.window_days}-day total
          </p>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <p>{formatDuration(totalTeamSeconds)} tracked</p>
          <p>{users.length} teammates</p>
          {loading && <p className="text-primary">Refreshing...</p>}
        </div>
      </div>

      {leaderboard.is_partial && leaderboard.warning && (
        <Alert variant="warning" className="px-2 py-1.5">
          <AlertDescription className="text-[11px]">
            {leaderboard.warning}
          </AlertDescription>
        </Alert>
      )}
      {leaderboard.debug_details && (
        <details className="rounded-lg border border-border bg-background/35 px-2 py-1.5">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Debug: ClickUp API response details
          </summary>
          <ScrollArea className="mt-2 max-h-40">
            <pre className="whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
              {leaderboard.debug_details}
            </pre>
          </ScrollArea>
        </details>
      )}

      {error && (
        <Alert variant="destructive" className="px-2 py-1.5">
          <AlertDescription className="text-[11px]">
            Last refresh issue: {error}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        {users.map((user, index) => {
          const rank = index + 1;
          const totalWidth = Math.max((user.total_seconds / maxTotalSeconds) * 100, 4);
          const activePercent =
            user.total_seconds > 0
              ? (user.active_seconds / user.total_seconds) * 100
              : 0;
          const pastPercent = Math.max(0, 100 - activePercent);
          const hasAvatar = Boolean(user.profile_picture && !brokenImages[user.user_id]);

          return (
            <div
              key={user.user_id}
              className={cn(
                "rounded-lg border border-border px-2.5 py-2 transition-colors",
                rankContainerClass(rank),
                user.running_entry_count > 0 &&
                  "shadow-[0_0_0_1px_rgba(0,214,143,0.4)]"
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono-display text-xs text-muted-foreground w-6">
                    #{rank}
                  </span>
                  <div className="h-7 w-7 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/60">
                    {hasAvatar ? (
                      <img
                        src={user.profile_picture ?? ""}
                        alt={`${user.username} profile`}
                        className="h-full w-full object-cover"
                        onError={() =>
                          setBrokenImages((previous) => ({
                            ...previous,
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
                    <p className="truncate text-sm font-medium">{user.username}</p>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span>{formatDuration(user.active_seconds)} active</span>
                      <span>·</span>
                      <span>{formatDuration(user.past_seconds)} past</span>
                      {user.running_entry_count > 0 && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-0.5 text-success">
                            <Flame className="h-3 w-3" />
                            Live {user.running_entry_count}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <span className="font-mono-display text-xs font-semibold">
                  {formatDuration(user.total_seconds)}
                </span>
              </div>

              <div className="h-3 overflow-hidden rounded-full bg-muted/35">
                <div
                  className="flex h-full min-w-[4px]"
                  style={{ width: `${totalWidth}%` }}
                >
                  <div
                    className="h-full bg-success"
                    style={{ width: `${activePercent}%` }}
                  />
                  <div
                    className="h-full bg-primary/85"
                    style={{ width: `${pastPercent}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background/35">
        <Table>
          <TableHeader>
            <TableRow className="text-muted-foreground">
              <TableHead>Rank</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">
                Past {leaderboard.window_days}d
              </TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user, index) => (
              <TableRow key={`table-${user.user_id}`}>
                <TableCell className="font-mono-display text-muted-foreground">
                  #{index + 1}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="truncate">{user.username}</span>
                    {user.running_entry_count > 0 && (
                      <Badge variant="outline" className="border-success/40 text-success">
                        live
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono-display text-success">
                  {formatDuration(user.active_seconds)}
                </TableCell>
                <TableCell className="text-right font-mono-display text-primary">
                  {formatDuration(user.past_seconds)}
                </TableCell>
                <TableCell className="text-right font-mono-display font-semibold">
                  {formatDuration(user.total_seconds)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">
        Green = active now, purple = past {leaderboard.window_days}-day time
      </p>
      </CardContent>
    </Card>
  );
}
