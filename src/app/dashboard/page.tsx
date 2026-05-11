import { BarChart3, DollarSign, TrendingDown, Zap } from "lucide-react";
import { Header } from "@/components/shared/header";
import { StatCard } from "@/components/features/analytics/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const RECENT_OPTIMIZATIONS = [
  { id: "1", prompt: "Write a Python function that...", model: "gpt-4o-mini", saved: 142, reduction: "28%", status: "completed", time: "2m ago" },
  { id: "2", prompt: "You are a helpful assistant...", model: "gpt-4o",      saved: 89,  reduction: "19%", status: "completed", time: "15m ago" },
  { id: "3", prompt: "Analyze the following code...", model: "gpt-4o-mini", saved: 203, reduction: "41%", status: "completed", time: "1h ago" },
  { id: "4", prompt: "Generate a comprehensive...",   model: "gpt-4-turbo", saved: 0,   reduction: "0%",  status: "failed",    time: "2h ago" },
  { id: "5", prompt: "Create a detailed plan for...", model: "gpt-4o-mini", saved: 167, reduction: "33%", status: "completed", time: "3h ago" },
];

export default function DashboardPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header title="Dashboard" description="Overview of your optimization activity" />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Optimizations"
              value="1,284"
              change="+12% this week"
              changeType="positive"
              icon={Zap}
            />
            <StatCard
              title="Tokens Saved"
              value="284K"
              change="+8.2% this week"
              changeType="positive"
              icon={TrendingDown}
            />
            <StatCard
              title="Cost Savings"
              value="$4.82"
              change="+15% this week"
              changeType="positive"
              icon={DollarSign}
            />
            <StatCard
              title="Avg Compression"
              value="31.4%"
              change="-2.1% this week"
              changeType="negative"
              icon={BarChart3}
            />
          </div>

          {/* Recent activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent Optimizations</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {RECENT_OPTIMIZATIONS.map((item) => (
                  <div key={item.id} className="flex items-center gap-4 px-6 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.prompt}</p>
                      <p className="text-xs text-muted-foreground">{item.model} · {item.time}</p>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      {item.status === "completed" ? (
                        <>
                          <div>
                            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                              -{item.reduction}
                            </p>
                            <p className="text-xs text-muted-foreground">{item.saved} tokens</p>
                          </div>
                          <Badge variant="success" className="text-xs">Done</Badge>
                        </>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Failed</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick start */}
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <p className="mt-3 text-sm font-medium">Start optimizing</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Go to the Playground to compress your first prompt
              </p>
              <a
                href="/dashboard/optimize"
                className="mt-4 inline-flex h-8 items-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Open Playground
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
