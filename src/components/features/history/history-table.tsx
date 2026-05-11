"use client";

import { format, parseISO } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HISTORY_ROWS } from "@/lib/dashboard-demo-data";
import { cn } from "@/utils/cn";

interface HistoryTableProps {
  className?: string;
}

export function HistoryTable({ className }: HistoryTableProps) {
  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Prompt history</CardTitle>
        <CardDescription>Recent optimization runs across your workspace.</CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="hidden sm:table-cell">Model</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="hidden text-right md:table-cell">Saved</TableHead>
              <TableHead className="hidden text-right lg:table-cell">When</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {HISTORY_ROWS.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-[180px]">
                  <span className="line-clamp-2 font-medium">{row.title}</span>
                  <span className="mt-0.5 block font-mono text-xs text-muted-foreground sm:hidden">
                    {row.model}
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-[140px] truncate font-mono text-xs sm:table-cell">
                  {row.model}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {row.tokensIn.toLocaleString()} / {row.tokensOut.toLocaleString()}
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  {row.savedPct > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">{row.savedPct}%</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden text-right text-xs text-muted-foreground lg:table-cell">
                  {format(parseISO(row.createdAt), "MMM d, HH:mm")}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={row.status === "success" ? "success" : "destructive"} className="text-[10px]">
                    {row.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
