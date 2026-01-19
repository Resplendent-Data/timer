import { cn } from "@/lib/utils";

interface DailyStats {
  date: string;
  focus_minutes: number;
  idle_count: number;
  longest_focus_mins: number;
}

interface FocusChartProps {
  data: DailyStats[];
}

function formatDay(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function FocusChart({ data }: FocusChartProps) {
  const sortedData = [...data].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const maxMinutes = Math.max(...sortedData.map((d) => d.focus_minutes), 60);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">This Week</p>
      <div className="flex items-end justify-between gap-1 h-24">
        {sortedData.map((day) => {
          const heightPercent = (day.focus_minutes / maxMinutes) * 100;
          const isToday =
            new Date(day.date).toDateString() === new Date().toDateString();

          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center gap-1"
            >
              <div className="w-full h-20 flex items-end justify-center">
                <div
                  className={cn(
                    "w-full max-w-8 rounded-t-sm transition-all duration-300",
                    isToday
                      ? "bg-gradient-to-t from-purple-500 to-indigo-500"
                      : "bg-primary/60",
                    day.focus_minutes === 0 && "bg-muted h-1"
                  )}
                  style={{
                    height: day.focus_minutes > 0 ? `${heightPercent}%` : "4px",
                  }}
                  title={`${formatHours(day.focus_minutes)} focus time`}
                />
              </div>
              <span
                className={cn(
                  "text-xs",
                  isToday
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {formatDay(day.date)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
