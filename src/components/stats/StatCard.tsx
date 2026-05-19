import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  variant?: "default" | "highlight" | "muted";
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  variant = "default",
}: StatCardProps) {
  return (
    <Card
      className={cn(
        "gap-0 py-0 transition-colors",
        variant === "default" && "bg-muted/50",
        variant === "highlight" && "bg-primary/10 border border-primary/20",
        variant === "muted" && "bg-muted/30"
      )}
    >
      <CardContent className="flex items-start justify-between px-4 py-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            {title}
          </p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {icon && <span className="text-2xl">{icon}</span>}
      </CardContent>
    </Card>
  );
}
