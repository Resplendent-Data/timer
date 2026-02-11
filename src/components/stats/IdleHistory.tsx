import { PauseCircle, ShieldCheck, TimerOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface IdleEvent {
  id: number;
  started_at: number;
  duration_secs: number;
  timer_stopped: boolean;
  task_name: string | null;
  task_id: string | null;
  session_duration_secs: number;
}

interface IdleHistoryProps {
  events: IdleEvent[];
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return "Yesterday";
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function IdleHistory({ events }: IdleHistoryProps) {
  const timerStops = events.filter((event) => event.timer_stopped).length;
  const totalIdleSeconds = events.reduce(
    (sum, event) => sum + event.duration_secs,
    0
  );

  if (events.length === 0) {
    return (
      <div className="py-6 text-center text-muted-foreground">
        <p className="text-xs uppercase tracking-wider">No interruptions yet</p>
        <p className="mt-1 text-[10px]">Nice focus streak</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="brutalist-label">Interruption Feed</p>
        <div className="flex gap-2 text-[10px] font-mono-display text-muted-foreground">
          <span className="brutalist-border bg-background/60 px-1.5 py-0.5">
            {timerStops} timers protected
          </span>
          <span className="brutalist-border bg-background/60 px-1.5 py-0.5">
            {formatDuration(totalIdleSeconds)} idle
          </span>
        </div>
      </div>

      <div className="max-h-44 space-y-1.5 overflow-y-auto">
        {events.map((event) => (
          <div
            key={event.id}
            className={cn(
              "flex items-center justify-between px-3 py-2 text-sm brutalist-border",
              event.timer_stopped
                ? "bg-primary/10 border-primary/40"
                : "bg-muted/30 border-border"
            )}
          >
            <div className="flex items-center gap-2">
              {event.timer_stopped ? (
                <ShieldCheck className="h-4 w-4 text-primary" />
              ) : event.task_name ? (
                <TimerOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <PauseCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <div>
                <p className="text-foreground text-sm">
                  {event.task_name ||
                    (event.timer_stopped ? "Timer auto-stopped" : "Went idle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(event.started_at)}
                  {event.timer_stopped && event.session_duration_secs > 0 && (
                    <span className="ml-2 text-primary">
                      ran {formatDuration(event.session_duration_secs)}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <span className="text-xs font-mono-display text-muted-foreground">
              {formatDuration(event.duration_secs)} idle
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
