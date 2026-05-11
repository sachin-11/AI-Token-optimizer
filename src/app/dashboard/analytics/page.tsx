"use client";

import { BarChart3, DollarSign, TrendingDown, Zap } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Header } from "@/components/shared/header";
import { StatCard } from "@/components/features/analytics/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TOKEN_DATA = [
  { date: "May 5",  saved: 12400, original: 44000 },
  { date: "May 6",  saved: 18200, original: 52000 },
  { date: "May 7",  saved: 9800,  original: 31000 },
  { date: "May 8",  saved: 22100, original: 61000 },
  { date: "May 9",  saved: 15600, original: 48000 },
  { date: "May 10", saved: 28400, original: 72000 },
  { date: "May 11", saved: 19200, original: 55000 },
];

const MODEL_DATA = [
  { model: "gpt-4o-mini", requests: 842, savings: 2.14 },
  { model: "gpt-4o",      requests: 312, savings: 1.89 },
  { model: "gpt-4-turbo", requests: 98,  savings: 0.62 },
  { model: "gpt-3.5",     requests: 32,  savings: 0.17 },
];

export default function AnalyticsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header title="Analytics" description="Token usage and cost savings over time" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Tokens Saved" value="284K"  change="+8.2% vs last week" changeType="positive" icon={Zap} />
          <StatCard title="Avg Compression"    value="31.4%" change="-2.1% vs last week" changeType="negative" icon={TrendingDown} />
          <StatCard title="Total Cost Saved"   value="$4.82" change="+15% vs last week"  changeType="positive" icon={DollarSign} />
          <StatCard title="Requests"           value="1,284" change="+12% vs last week"  changeType="positive" icon={BarChart3} />
        </div>

        {/* Token savings chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Token Savings — Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={TOKEN_DATA} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="savedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [v.toLocaleString(), ""]}
                />
                <Area type="monotone" dataKey="saved" stroke="hsl(var(--primary))" fill="url(#savedGrad)" strokeWidth={2} name="Tokens Saved" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Model usage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Requests by Model</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={MODEL_DATA} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="model" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="requests" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Requests" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
