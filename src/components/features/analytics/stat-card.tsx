import { type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/utils/cn";

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  iconColor?: string;
  description?: string;
}

export function StatCard({
  title, value, change, changeType = "neutral", icon: Icon, iconColor, description,
}: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {change && (
              <p className={cn(
                "text-xs font-medium",
                changeType === "positive" && "text-emerald-600 dark:text-emerald-400",
                changeType === "negative" && "text-red-600 dark:text-red-400",
                changeType === "neutral" && "text-muted-foreground",
              )}>
                {change}
              </p>
            )}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg",
            iconColor ?? "bg-primary/10",
          )}>
            <Icon className={cn("h-5 w-5", iconColor ? "text-white" : "text-primary")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
