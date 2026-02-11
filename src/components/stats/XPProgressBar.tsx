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
          <div className="flex items-center justify-center w-8 h-8 bg-primary text-primary-foreground font-mono-display font-bold text-sm">
            {level}
          </div>
          <div>
            <p className="text-sm font-medium">Lv.{level}</p>
            <p className="text-xs text-muted-foreground font-mono-display">
              {currentXp.toLocaleString()} XP
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-mono-display font-medium">
            {xpToGo > 0 ? xpToGo.toLocaleString() : 0}
          </p>
          <p className="text-xs text-muted-foreground">to Lv.{level + 1}</p>
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="relative h-3 bg-muted brutalist-border">
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      
      <p className="text-[10px] text-center text-muted-foreground uppercase tracking-wider">
        1 XP per minute active
      </p>
    </div>
  );
}
