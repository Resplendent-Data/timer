import { Progress } from "@/components/ui/progress";

interface XPProgressBarProps {
  currentXp: number;
  level: number;
  xpForNextLevel: number;
  progressPercent: number;
}

export function XPProgressBar({
  currentXp,
  level,
  xpForNextLevel,
  progressPercent,
}: XPProgressBarProps) {
  const xpToGo = xpForNextLevel - currentXp;
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white font-bold text-lg shadow-lg">
            {level}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Level {level}</p>
            <p className="text-xs text-muted-foreground">
              {currentXp.toLocaleString()} XP
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-foreground">
            {xpToGo > 0 ? xpToGo.toLocaleString() : 0}
          </p>
          <p className="text-xs text-muted-foreground">XP to level {level + 1}</p>
        </div>
      </div>
      <Progress
        value={progressPercent}
        className="h-3 bg-gradient-to-r from-purple-500/20 to-indigo-600/20"
        indicatorClassName="bg-gradient-to-r from-purple-500 to-indigo-600 transition-all duration-500"
      />
      <p className="text-xs text-center text-muted-foreground">
        Earn 1 XP for every minute of active time
      </p>
    </div>
  );
}
