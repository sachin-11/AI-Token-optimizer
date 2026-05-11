import { Header } from "@/components/shared/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const HISTORY = Array.from({ length: 12 }, (_, i) => ({
  id: String(i + 1),
  prompt: [
    "Write a Python function that calculates fibonacci numbers...",
    "You are a helpful AI assistant. Please help me with...",
    "Analyze the following code and identify potential bugs...",
    "Create a comprehensive marketing plan for a SaaS product...",
    "Explain the concept of machine learning to a beginner...",
  ][i % 5] ?? "Sample prompt",
  model:     ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"][i % 3] ?? "gpt-4o",
  mode:      ["balanced", "safe", "aggressive"][i % 3] ?? "balanced",
  original:  Math.floor(Math.random() * 400) + 200,
  optimized: Math.floor(Math.random() * 200) + 100,
  quality:   Math.floor(Math.random() * 30) + 70,
  status:    i === 3 ? "failed" : "completed",
  date:      new Date(Date.now() - i * 3_600_000).toLocaleString(),
}));

export default function HistoryPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header title="Prompt History" description="All your past optimizations" />

      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Prompt</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Model</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Mode</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Tokens</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Reduction</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Quality</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {HISTORY.map((row) => {
                    const reduction = Math.round((1 - row.optimized / row.original) * 100);
                    return (
                      <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                        <td className="max-w-[200px] truncate px-4 py-3 font-medium">{row.prompt}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.model}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs capitalize">{row.mode}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {row.original} → {row.optimized}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.status === "completed" ? (
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              -{reduction}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-xs">{row.status === "completed" ? `${row.quality}/100` : "—"}</td>
                        <td className="px-4 py-3">
                          <Badge variant={row.status === "completed" ? "success" : "destructive"} className="text-xs">
                            {row.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{row.date}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
