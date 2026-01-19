import { cn } from "@/lib/utils";

interface StreakDisplayProps {
  currentStreak: number;
  bestStreak: number;
}

export function StreakDisplay({ currentStreak, bestStreak }: StreakDisplayProps) {
  const isOnFire = currentStreak >= 3;
  const isNewRecord = currentStreak > 0 && currentStreak >= bestStreak;

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-3xl transition-transform",
            isOnFire && "animate-pulse scale-110"
          )}
        >
          {currentStreak > 0 ? "🔥" : "❄️"}
        </span>
        <div>
          <p className="text-2xl font-bold text-foreground">
            {currentStreak}
            <span className="text-sm font-normal text-muted-foreground ml-1">
              day{currentStreak !== 1 ? "s" : ""}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">Current streak</p>
        </div>
      </div>

      {isNewRecord && currentStreak > 1 && (
        <span className="px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-full">
          New Record!
        </span>
      )}

      <div className="ml-auto text-right">
        <p className="text-lg font-semibold text-foreground">{bestStreak}</p>
        <p className="text-xs text-muted-foreground">Best streak</p>
      </div>
    </div>
  );
}
