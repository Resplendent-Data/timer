import { cn } from "@/lib/utils";
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

  // Determine status message based on activity
  const getStatusMessage = () => {
    if (totalSeconds < 60) {
      return "Just getting started...";
    }
    if (activePercent >= 90) {
      return "Excellent focus today!";
    }
    if (activePercent >= 75) {
      return "Great productivity!";
    }
    if (activePercent >= 50) {
      return "Decent balance of work and breaks";
    }
    return "Taking it easy today";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="text-green-500 font-medium">Active</span>
          <span className="text-foreground font-semibold">{formatDuration(activeSeconds)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-semibold">{formatDuration(idleSeconds)}</span>
          <span className="text-muted-foreground">Idle</span>
        </div>
      </div>

      <div className="relative">
        <Progress 
          value={activePercent} 
          className={cn(
            "h-3",
            activePercent >= 75 && "bg-green-100 dark:bg-green-950",
            activePercent >= 50 && activePercent < 75 && "bg-yellow-100 dark:bg-yellow-950",
            activePercent < 50 && "bg-muted"
          )}
        />
        <div className="absolute inset-y-0 right-2 flex items-center">
          <span className="text-xs font-medium text-muted-foreground">
            {activePercent}%
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {getStatusMessage()}
      </p>
    </div>
  );
}
