import { useState } from "react";
import { formatChartDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DailyActivity } from "@/types/timer";

interface FocusChartProps {
  data: DailyActivity[];
}

function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDay(dateStr: string): string {
  return parseDate(dateStr)
    .toLocaleDateString("en-US", { weekday: "short" })
    .slice(0, 3);
}

function formatFullDate(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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
  const todayStr = new Date().toDateString();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="section-eyebrow">7-Day Activity</span>
        <span className="font-mono-display text-xs text-muted-foreground">
          {formatChartDuration(weekActiveSeconds)} active
        </span>
      </div>

      {/* Summary / Hover inspector */}
      <div className="flex min-h-[3.25rem] items-center justify-between rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2 text-xs">
        {hoveredDay ? (
          <>
            <div>
              <p className="font-semibold text-foreground">
                {formatFullDate(hoveredDay.date)}
              </p>
              <p className="font-mono-display text-[11px] text-muted-foreground">
                {formatChartDuration(hoveredDay.session_seconds)} tracked ·{" "}
                {hoveredDay.session_count} session
                {hoveredDay.session_count !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="text-right font-mono-display">
              <p className="font-semibold text-primary">
                {formatChartDuration(hoveredDay.active_seconds)} active
              </p>
              <p className="text-[11px] text-muted-foreground">
                {formatChartDuration(hoveredDay.idle_seconds)} idle
              </p>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="text-[11px] text-muted-foreground">7d Tracked</p>
              <p className="font-mono-display text-sm font-semibold text-foreground">
                {formatChartDuration(weekTrackedSeconds)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">Best Day</p>
              <p className="font-mono-display text-sm font-semibold text-foreground">
                {bestDay && bestDay.active_seconds > 0
                  ? `${formatDay(bestDay.date)} · ${formatChartDuration(bestDay.active_seconds)}`
                  : "--"}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Bars */}
      <div className="flex h-28 items-end justify-between gap-2 pt-1">
        {sortedData.map((day, index) => {
          const totalSeconds = day.active_seconds + day.idle_seconds;
          const heightPct = (totalSeconds / maxTotalSeconds) * 100;
          const activePct =
            totalSeconds > 0 ? (day.active_seconds / totalSeconds) * 100 : 0;
          const idlePct =
            totalSeconds > 0 ? (day.idle_seconds / totalSeconds) * 100 : 0;
          const isToday = parseDate(day.date).toDateString() === todayStr;
          const isHovered = hoveredIndex === index;

          return (
            <button
              key={day.date}
              type="button"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={() =>
                setHoveredIndex((curr) => (curr === index ? null : index))
              }
              className="flex flex-1 flex-col items-center gap-1.5 outline-none"
            >
              <div className="flex h-20 w-full items-end justify-center">
                <div
                  className={cn(
                    "relative w-full max-w-8 overflow-hidden rounded-lg border transition-all duration-200",
                    isHovered
                      ? "border-primary/70 scale-x-105"
                      : isToday
                      ? "border-primary/45"
                      : "border-white/[0.08]",
                    totalSeconds === 0 ? "h-1 bg-white/[0.06]" : "bg-white/[0.04]"
                  )}
                  style={{
                    height:
                      totalSeconds > 0 ? `${Math.max(heightPct, 10)}%` : "4px",
                  }}
                >
                  {totalSeconds > 0 && (
                    <>
                      <div
                        className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-primary to-[#b794ff] transition-all duration-200"
                        style={{
                          height: `${activePct}%`,
                          minHeight: day.active_seconds > 0 ? "2px" : "0",
                        }}
                      />
                      <div
                        className="absolute left-0 w-full bg-white/15 transition-all duration-200"
                        style={{
                          bottom: `${activePct}%`,
                          height: `${idlePct}%`,
                          minHeight: day.idle_seconds > 0 ? "2px" : "0",
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
              <span
                className={cn(
                  "font-mono-display text-[10px] transition-colors",
                  isToday || isHovered
                    ? "font-semibold text-primary"
                    : "text-muted-foreground"
                )}
              >
                {formatDay(day.date)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary" />
          Active
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-white/25" />
          Idle
        </span>
      </div>
    </div>
  );
}
