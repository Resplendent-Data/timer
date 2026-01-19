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
              {currentXp.toLocaleString()} XP total
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Next level</p>
          <p className="text-sm font-medium text-foreground">
            {xpForNextLevel.toLocaleString()} XP
          </p>
        </div>
      </div>
      <Progress
        value={progressPercent}
        className="h-3 bg-gradient-to-r from-purple-500/20 to-indigo-600/20"
        indicatorClassName="bg-gradient-to-r from-purple-500 to-indigo-600 transition-all duration-500"
      />
      <p className="text-xs text-center text-muted-foreground">
        {progressPercent.toFixed(0)}% to Level {level + 1}
      </p>
    </div>
  );
}
