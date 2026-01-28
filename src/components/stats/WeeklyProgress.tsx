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
      return "First week tracking";
    }
    const percentChange = Math.round((weekDeltaSeconds / activeSecondsLastWeek) * 100);
    if (percentChange >= 50) {
      return "Major boost";
    }
    if (percentChange >= 20) {
      return "Improvement";
    }
    if (percentChange >= 0) {
      return "Consistent";
    }
    if (percentChange >= -20) {
      return "Slightly down";
    }
    return "Taking it easy";
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-lg font-mono-display font-semibold">
          {formatDuration(activeSecondsWeek)}
          <span className="text-xs font-normal text-muted-foreground ml-2 uppercase tracking-wider">active</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {getInsight()}
        </p>
      </div>
      <div className={cn(
        "flex items-center gap-1 px-2 py-1 text-xs font-mono-display font-medium",
        isUp && "bg-emerald-500/20 text-emerald-500",
        isDown && "bg-destructive/20 text-destructive",
        isSteady && "bg-muted text-muted-foreground"
      )}>
        {isUp && <span>+{formatDelta(weekDeltaSeconds)}</span>}
        {isDown && <span>-{formatDelta(weekDeltaSeconds)}</span>}
        {isSteady && <span>=</span>}
        <span className="text-[10px] opacity-75 uppercase">vs last</span>
      </div>
    </div>
  );
}
