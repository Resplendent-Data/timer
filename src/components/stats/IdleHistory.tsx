import { cn } from "@/lib/utils";

interface IdleEvent {
  id: number;
  started_at: number;
  duration_secs: number;
  timer_stopped: boolean;
  task_name: string | null;
  task_id: string | null;
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
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-2xl mb-2">🎯</p>
        <p className="text-sm">No idle events yet</p>
        <p className="text-xs">Keep focused!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Recent Idle Events</p>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {events.map((event) => (
          <div
            key={event.id}
            className={cn(
              "flex items-center justify-between py-2 px-3 rounded-lg text-sm",
              event.timer_stopped
                ? "bg-amber-500/10 border border-amber-500/20"
                : "bg-muted/50"
            )}
          >
            <div className="flex items-center gap-2">
              <span>{event.timer_stopped ? "⏹️" : "💤"}</span>
              <div>
                <p className="text-foreground">
                  {event.task_name || (event.timer_stopped ? "Timer stopped" : "Went idle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(event.started_at)}
                </p>
              </div>
            </div>
            <span className="text-muted-foreground text-xs">
              {formatDuration(event.duration_secs)} idle
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
