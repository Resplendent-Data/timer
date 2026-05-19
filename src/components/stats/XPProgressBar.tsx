import { Badge } from "@/components/ui/badge";
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
          <Badge className="flex h-8 w-8 items-center justify-center rounded-lg p-0 font-mono-display text-sm">
            {level}
          </Badge>
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
      
      <Progress value={progressPercent} className="h-3" />
      
      <p className="text-[10px] text-center text-muted-foreground uppercase tracking-wider">
        1 XP per minute active
      </p>
    </div>
  );
}
