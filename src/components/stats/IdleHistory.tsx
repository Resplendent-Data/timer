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
  if (events.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <p className="text-xs uppercase tracking-wider">No idle events yet</p>
        <p className="text-[10px] mt-1">Keep focused</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="brutalist-label">Recent Idle Events</p>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {events.map((event) => (
          <div
            key={event.id}
            className={cn(
              "flex items-center justify-between py-2 px-3 text-sm",
              event.timer_stopped
                ? "bg-primary/10 border-l-2 border-l-primary"
                : "bg-muted/30"
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "w-1.5 h-1.5",
                  event.timer_stopped ? "bg-primary" : "bg-muted-foreground"
                )}
              />
              <div>
                <p className="text-foreground text-sm">
                  {event.task_name || (event.timer_stopped ? "Timer stopped" : "Went idle")}
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
            <span className="text-muted-foreground text-xs font-mono-display">
              {formatDuration(event.duration_secs)} idle
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
