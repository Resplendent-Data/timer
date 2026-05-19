import { Progress } from "@/components/ui/progress";

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
          <span className="text-success font-medium uppercase text-xs tracking-wider">Active</span>
          <span className="font-mono-display font-semibold">{formatDuration(activeSeconds)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono-display font-semibold text-muted-foreground">{formatDuration(idleSeconds)}</span>
          <span className="text-muted-foreground uppercase text-xs tracking-wider">Idle</span>
        </div>
      </div>

      <div className="relative">
        <Progress value={activePercent} className="h-4" />
        <div className="absolute inset-y-0 right-2 flex items-center">
          <span className="text-[10px] font-mono-display font-bold text-foreground mix-blend-difference">
            {activePercent}%
          </span>
        </div>
      </div>
    </div>
  );
}
