"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TOKEN_USAGE_SERIES } from "@/lib/dashboard-demo-data";
import { cn } from "@/utils/cn";

interface TokenAnalyticsProps {
  className?: string;
}

export function TokenAnalytics({ className }: TokenAnalyticsProps) {
  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Token analytics</CardTitle>
        <CardDescription>Input vs. completion tokens over the last 7 days.</CardDescription>
      </CardHeader>
      <CardContent className="h-[280px] w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={TOKEN_USAGE_SERIES} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fillIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fillOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
            />
            <Area
              type="monotone"
              dataKey="input"
              name="Input"
              stroke="hsl(var(--chart-1))"
              fill="url(#fillIn)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="output"
              name="Output"
              stroke="hsl(var(--chart-2))"
              fill="url(#fillOut)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
