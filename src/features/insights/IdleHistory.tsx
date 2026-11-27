import { PauseCircle, ShieldCheck, TimerOff } from "lucide-react";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { IdleEvent } from "@/types/timer";

interface IdleHistoryProps {
  events: IdleEvent[];
}

export function IdleHistory({ events }: IdleHistoryProps) {
  const protectedCount = events.filter((e) => e.timer_stopped).length;
  const totalIdleSecs = events.reduce((sum, e) => sum + e.duration_secs, 0);

  return (
    <section className="surface-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="section-eyebrow">Interruption Feed</span>
        {events.length > 0 && (
          <span className="font-mono-display text-[11px] text-muted-foreground">
            {protectedCount} protected · {formatDuration(totalIdleSecs)} idle
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-black/20 py-5 text-center">
          <p className="text-xs font-medium text-foreground/80">
            No interruptions logged
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Auto-stopped idle timers appear here
          </p>
        </div>
      ) : (
        <div className="max-h-52 space-y-1.5 overflow-y-auto pr-0.5">
          {events.map((event) => (
            <div
              key={event.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs",
                event.timer_stopped
                  ? "border-primary/25 bg-primary/[0.07]"
                  : "border-white/[0.06] bg-white/[0.02]"
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {event.timer_stopped ? (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                ) : event.task_name ? (
                  <TimerOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <PauseCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {event.task_name ||
                      (event.timer_stopped ? "Timer auto-stopped" : "Went idle")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(event.started_at * 1000)}
                    {event.timer_stopped && event.session_duration_secs > 0 && (
                      <span className="ml-1.5 font-mono-display text-primary">
                        · ran {formatDuration(event.session_duration_secs)}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <span className="shrink-0 font-mono-display text-[11px] text-muted-foreground">
                {formatDuration(event.duration_secs)} idle
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
