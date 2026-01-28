import { cn } from "@/lib/utils";

interface DailyActivity {
  date: string;
  active_seconds: number;
  idle_seconds: number;
  session_count: number;
  session_seconds: number;
}

interface FocusChartProps {
  data: DailyActivity[];
}

function formatDay(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function FocusChart({ data }: FocusChartProps) {
  const sortedData = [...data].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Max should be at least 1 hour for visual purposes
  const maxSeconds = Math.max(...sortedData.map((d) => d.active_seconds), 3600);

  return (
    <div className="space-y-2">
      <p className="brutalist-label">Last 7 Days</p>
      <div className="flex items-end justify-between gap-1 h-20">
        {sortedData.map((day) => {
          const heightPercent = (day.active_seconds / maxSeconds) * 100;
          const isToday =
            new Date(day.date).toDateString() === new Date().toDateString();

          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center gap-1"
            >
              <div className="w-full h-16 flex items-end justify-center">
                <div
                  className={cn(
                    "w-full max-w-6 transition-all duration-300",
                    isToday ? "bg-primary" : "bg-primary/50",
                    day.active_seconds === 0 && "bg-muted h-0.5"
                  )}
                  style={{
                    height: day.active_seconds > 0 ? `${Math.max(heightPercent, 8)}%` : "2px",
                  }}
                  title={`${formatDuration(day.active_seconds)} active`}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] font-mono-display tracking-wider",
                  isToday
                    ? "font-semibold text-primary"
                    : "text-muted-foreground"
                )}
              >
                {formatDay(day.date)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-center text-muted-foreground uppercase tracking-wider">
        Active time per day
      </p>
    </div>
  );
}
