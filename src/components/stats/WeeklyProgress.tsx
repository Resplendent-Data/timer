import { cn } from "@/lib/utils";

interface WeeklyProgressProps {
  activeSecondsWeek: number;
  activeSecondsLastWeek: number;
  weekDeltaSeconds: number;
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

function formatDelta(seconds: number): string {
  const absSeconds = Math.abs(seconds);
  if (absSeconds < 60) return "0m";
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function WeeklyProgress({ 
  activeSecondsWeek, 
  activeSecondsLastWeek,
  weekDeltaSeconds 
}: WeeklyProgressProps) {
  const isUp = weekDeltaSeconds > 0;
  const isDown = weekDeltaSeconds < 0;
  const isSteady = weekDeltaSeconds === 0;

  // Determine insight message
  const getInsight = () => {
    if (activeSecondsLastWeek === 0) {
      return "First week of tracking!";
    }
    const percentChange = Math.round((weekDeltaSeconds / activeSecondsLastWeek) * 100);
    if (percentChange >= 50) {
      return "Major productivity boost!";
    }
    if (percentChange >= 20) {
      return "Nice improvement from last week";
    }
    if (percentChange >= 0) {
      return "Consistent with last week";
    }
    if (percentChange >= -20) {
      return "Slightly less than last week";
    }
    return "Taking it easier this week";
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-lg font-semibold text-foreground">
          {formatDuration(activeSecondsWeek)}
          <span className="text-sm font-normal text-muted-foreground ml-2">active</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {getInsight()}
        </p>
      </div>
      <div className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium",
        isUp && "bg-green-500/10 text-green-600 dark:text-green-400",
        isDown && "bg-red-500/10 text-red-600 dark:text-red-400",
        isSteady && "bg-muted text-muted-foreground"
      )}>
        {isUp && <span>+{formatDelta(weekDeltaSeconds)}</span>}
        {isDown && <span>-{formatDelta(weekDeltaSeconds)}</span>}
        {isSteady && <span>same</span>}
        <span className="text-xs opacity-75">vs last wk</span>
      </div>
    </div>
  );
}
