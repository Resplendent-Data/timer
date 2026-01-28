interface StreakDisplayProps {
  currentStreak: number;
  bestStreak: number;
}

export function StreakDisplay({ currentStreak, bestStreak }: StreakDisplayProps) {
  const isNewRecord = currentStreak > 0 && currentStreak >= bestStreak;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-mono-display font-bold">
            {currentStreak}
            <span className="text-sm font-normal text-muted-foreground ml-1">
              day{currentStreak !== 1 ? "s" : ""}
            </span>
          </p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Current</p>
        </div>

        {isNewRecord && currentStreak > 1 && (
          <span className="px-2 py-0.5 text-[10px] font-semibold bg-primary/20 text-primary uppercase tracking-wider">
            Record
          </span>
        )}

        <div className="text-right">
          <p className="text-lg font-mono-display font-semibold">{bestStreak}</p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Best</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {currentStreak === 0
          ? "Open the app daily to build your streak"
          : currentStreak === 1
          ? "Keep going tomorrow"
          : `${currentStreak} days in a row`}
      </p>
    </div>
  );
}
