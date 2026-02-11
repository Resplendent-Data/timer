import { useState } from "react";
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

function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDay(dateStr: string): string {
  const date = parseDate(dateStr);
  return date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

function formatFullDate(dateStr: string): string {
  const date = parseDate(dateStr);
  return date.toLocaleDateString("en-US", { 
    weekday: "short", 
    month: "short", 
    day: "numeric" 
  });
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
  const sortedData = [...data].sort(
    (a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime()
  );

  const maxTotalSeconds = Math.max(
    ...sortedData.map((d) => d.active_seconds + d.idle_seconds),
    3600
  );

  const hoveredDay = hoveredIndex !== null ? sortedData[hoveredIndex] : null;
  const weekActiveSeconds = sortedData.reduce(
    (sum, day) => sum + day.active_seconds,
    0
  );
  const weekTrackedSeconds = sortedData.reduce(
    (sum, day) => sum + day.session_seconds,
    0
  );
  const bestDay = sortedData.reduce<DailyActivity | null>((best, day) => {
    if (!best || day.active_seconds > best.active_seconds) return day;
    return best;
  }, null);
  const today = new Date().toDateString();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="brutalist-label">7-Day Activity Radar</p>
        <p className="text-xs text-muted-foreground">
          {formatDuration(weekActiveSeconds)} active
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="brutalist-border bg-background/60 px-2 py-1.5">
          <p className="text-muted-foreground">Tracked Sessions</p>
          <p className="font-mono-display font-semibold">
            {formatDuration(weekTrackedSeconds)}
          </p>
        </div>
        <div className="brutalist-border bg-background/60 px-2 py-1.5">
          <p className="text-muted-foreground">Best Day</p>
          <p className="font-mono-display font-semibold">
            {bestDay ? formatDay(bestDay.date) : "--"}
          </p>
        </div>
      </div>

      <div className="flex h-16 items-center justify-center brutalist-border bg-background/40">
        {hoveredDay ? (
          <div className="text-center space-y-1 animate-in fade-in duration-150">
            <p className="text-xs font-medium text-foreground">
              {formatFullDate(hoveredDay.date)}
            </p>
            <div className="flex items-center justify-center gap-3 text-[11px]">
              <span>
                <span className="font-mono-display font-semibold text-primary">
                  {formatDuration(hoveredDay.active_seconds)}
                </span>
                <span className="text-muted-foreground ml-1">active</span>
              </span>
              <span className="text-muted-foreground">·</span>
              <span>
                <span className="font-mono-display text-muted-foreground">
                  {formatDuration(hoveredDay.idle_seconds)}
                </span>
                <span className="text-muted-foreground ml-1">idle</span>
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono-display">
              {formatDuration(hoveredDay.session_seconds)} tracked ·{" "}
              {hoveredDay.session_count} session
              {hoveredDay.session_count !== 1 ? "s" : ""}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Hover over a day to see details
          </p>
        )}
      </div>

      <div className="flex h-24 items-end justify-between gap-1.5">
        {sortedData.map((day, index) => {
          const totalSeconds = day.active_seconds + day.idle_seconds;
          const dayHeightPercent = (totalSeconds / maxTotalSeconds) * 100;
          const activeFillPercent =
            totalSeconds > 0 ? (day.active_seconds / totalSeconds) * 100 : 0;
          const idleFillPercent =
            totalSeconds > 0 ? (day.idle_seconds / totalSeconds) * 100 : 0;
          const isToday = parseDate(day.date).toDateString() === today;
          const isHovered = hoveredIndex === index;

          return (
            <div
              key={day.date}
              className="flex flex-1 cursor-pointer flex-col items-center gap-1"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={() =>
                setHoveredIndex((current) => (current === index ? null : index))
              }
            >
              <div className="flex h-20 w-full items-end justify-center">
                <div
                  className={cn(
                    "relative w-full max-w-7 overflow-hidden brutalist-border bg-muted/20 transition-all duration-150",
                    isHovered && "scale-x-105",
                    isToday && "border-primary",
                    totalSeconds === 0 && "h-1"
                  )}
                  style={{
                    height: totalSeconds > 0 ? `${Math.max(dayHeightPercent, 8)}%` : "4px",
                  }}
                >
                  {totalSeconds > 0 && (
                    <>
                      <div
                        className="absolute bottom-0 left-0 w-full bg-primary transition-all duration-150"
                        style={{
                          height: `${activeFillPercent}%`,
                          minHeight: day.active_seconds > 0 ? "2px" : "0",
                        }}
                      />
                      <div
                        className="absolute left-0 w-full bg-muted-foreground/40 transition-all duration-150"
                        style={{
                          bottom: `${activeFillPercent}%`,
                          height: `${idleFillPercent}%`,
                          minHeight: day.idle_seconds > 0 ? "2px" : "0",
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
              <span
                className={cn(
                  "font-mono-display text-[10px] tracking-wider transition-colors",
                  isToday || isHovered
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
      
      <p className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">
        Purple = active, gray = idle
      </p>
    </div>
  );
}
