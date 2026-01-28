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

function formatDay(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
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
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Max should be at least 1 hour for visual purposes
  const maxSeconds = Math.max(...sortedData.map((d) => d.active_seconds), 3600);

  const hoveredDay = hoveredIndex !== null ? sortedData[hoveredIndex] : null;

  return (
    <div className="space-y-2">
      <p className="brutalist-label">Last 7 Days</p>
      
      {/* Tooltip */}
      <div className="h-16 flex items-center justify-center">
        {hoveredDay ? (
          <div className="text-center space-y-1 animate-in fade-in duration-150">
            <p className="text-xs font-medium text-foreground">
              {formatFullDate(hoveredDay.date)}
            </p>
            <div className="flex items-center justify-center gap-3 text-[11px]">
              <span>
                <span className="text-primary font-semibold font-mono-display">
                  {formatDuration(hoveredDay.active_seconds)}
                </span>
                <span className="text-muted-foreground ml-1">active</span>
              </span>
              <span className="text-muted-foreground">·</span>
              <span>
                <span className="text-muted-foreground font-mono-display">
                  {formatDuration(hoveredDay.idle_seconds)}
                </span>
                <span className="text-muted-foreground ml-1">idle</span>
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {hoveredDay.session_count} session{hoveredDay.session_count !== 1 ? "s" : ""}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Hover over a day to see details
          </p>
        )}
      </div>

      {/* Chart Bars */}
      <div className="flex items-end justify-between gap-1 h-20">
        {sortedData.map((day, index) => {
          const heightPercent = (day.active_seconds / maxSeconds) * 100;
          const isToday =
            new Date(day.date).toDateString() === new Date().toDateString();
          const isHovered = hoveredIndex === index;

          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div className="w-full h-16 flex items-end justify-center">
                <div
                  className={cn(
                    "w-full max-w-6 transition-all duration-150",
                    isToday ? "bg-primary" : "bg-primary/50",
                    isHovered && "bg-primary scale-x-110",
                    day.active_seconds === 0 && "bg-muted h-0.5"
                  )}
                  style={{
                    height: day.active_seconds > 0 ? `${Math.max(heightPercent, 8)}%` : "2px",
                  }}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] font-mono-display tracking-wider transition-colors",
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
      
      <p className="text-[10px] text-center text-muted-foreground uppercase tracking-wider">
        Active time per day
      </p>
    </div>
  );
}
