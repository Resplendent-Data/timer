import { cn } from "@/lib/utils";

interface WeeklyRankProps {
  rank: number;
  trend: number;
}

const rankLabels: Record<number, string> = {
  1: "Top 25%",
  2: "Top 50%",
  3: "Top 75%",
  4: "Bottom 25%",
};

const rankColors: Record<number, string> = {
  1: "from-yellow-400 to-amber-500 text-amber-900",
  2: "from-slate-300 to-slate-400 text-slate-800",
  3: "from-orange-400 to-orange-500 text-orange-900",
  4: "from-stone-400 to-stone-500 text-stone-800",
};

const rankEmojis: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
  4: "📈",
};

export function WeeklyRank({ rank, trend }: WeeklyRankProps) {
  const clampedRank = Math.max(1, Math.min(4, rank));

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br shadow-md",
          rankColors[clampedRank]
        )}
      >
        <span className="text-2xl">{rankEmojis[clampedRank]}</span>
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          {rankLabels[clampedRank]}
        </p>
        <div className="flex items-center gap-1">
          {trend > 0 && (
            <span className="text-green-500 text-xs font-medium flex items-center">
              ↑ Up
            </span>
          )}
          {trend < 0 && (
            <span className="text-red-500 text-xs font-medium flex items-center">
              ↓ Down
            </span>
          )}
          {trend === 0 && (
            <span className="text-muted-foreground text-xs">→ Steady</span>
          )}
          <span className="text-xs text-muted-foreground">vs last week</span>
        </div>
      </div>
    </div>
  );
}
