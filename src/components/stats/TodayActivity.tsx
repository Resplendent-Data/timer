interface TodayActivityProps {
  activeSeconds: number;
  idleSeconds: number;
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

export function TodayActivity({ activeSeconds, idleSeconds }: TodayActivityProps) {
  const totalSeconds = activeSeconds + idleSeconds;
  const activePercent = totalSeconds > 0 ? Math.round((activeSeconds / totalSeconds) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="text-emerald-500 font-medium uppercase text-xs tracking-wider">Active</span>
          <span className="font-mono-display font-semibold">{formatDuration(activeSeconds)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono-display font-semibold text-muted-foreground">{formatDuration(idleSeconds)}</span>
          <span className="text-muted-foreground uppercase text-xs tracking-wider">Idle</span>
        </div>
      </div>

      {/* Brutalist progress bar */}
      <div className="relative h-4 bg-muted brutalist-border">
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-all duration-300"
          style={{ width: `${activePercent}%` }}
        />
        <div className="absolute inset-y-0 right-2 flex items-center">
          <span className="text-[10px] font-mono-display font-bold text-foreground mix-blend-difference">
            {activePercent}%
          </span>
        </div>
      </div>
    </div>
  );
}
