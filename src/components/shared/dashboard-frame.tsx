"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "@/components/shared/sidebar";
import { SidebarNav } from "@/components/shared/sidebar-nav";

export function DashboardFrame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <div className="hidden h-full shrink-0 md:block">
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open menu">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[min(100vw-2rem,20rem)] flex-col p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <div className="flex h-full flex-col">
                <SidebarNav onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold text-foreground">Prompt Optimizer</span>
        </div>
        {children}
      </div>
    </div>
  );
}
