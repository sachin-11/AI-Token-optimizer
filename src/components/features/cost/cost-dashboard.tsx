"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COST_SERIES } from "@/lib/dashboard-demo-data";
import { cn } from "@/utils/cn";

interface CostDashboardProps {
  className?: string;
}

export function CostDashboard({ className }: CostDashboardProps) {
  const total = COST_SERIES.reduce((acc, x) => acc + x.spend, 0);

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <CardTitle className="text-base">Cost dashboard</CardTitle>
            <CardDescription>Spend by model (last 30 days, demo data).</CardDescription>
          </div>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            ${total.toFixed(1)}
            <span className="text-sm font-normal text-muted-foreground"> total</span>
          </p>
        </div>
      </CardHeader>
      <CardContent className="h-[240px] w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={COST_SERIES} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis
              type="category"
              dataKey="name"
              width={96}
              tick={{ fontSize: 11 }}
              stroke="hsl(var(--muted-foreground))"
            />
            <Tooltip
              formatter={(v: number) => [`$${v.toFixed(2)}`, "Spend"]}
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
            />
            <Bar dataKey="spend" name="Spend" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
