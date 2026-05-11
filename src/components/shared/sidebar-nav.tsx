"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap } from "lucide-react";
import { cn } from "@/utils/cn";
import { DASHBOARD_NAV } from "@/components/shared/nav-config";

interface SidebarNavProps {
  onNavigate?: () => void;
  showFooter?: boolean;
}

export function SidebarNav({ onNavigate, showFooter = true }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-semibold text-sm">Prompt Optimizer</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {DASHBOARD_NAV.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              {...(onNavigate ? { onClick: () => onNavigate() } : {})}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {showFooter && (
        <div className="shrink-0 border-t p-3">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium text-foreground">Free Plan</p>
            <p className="mt-0.5 text-xs text-muted-foreground">100 optimizations/mo</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-border">
              <div className="h-1.5 w-2/5 rounded-full bg-primary" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">40 / 100 used</p>
          </div>
        </div>
      )}
    </>
  );
}
