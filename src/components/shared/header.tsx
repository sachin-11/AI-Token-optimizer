"use client";
import { Bell, Search } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  title: string;
  description?: string;
}

export function Header({ title, description }: HeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div>
        <h1 className="text-sm font-semibold text-foreground">{title}</h1>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Search">
          <Search className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-4 w-4" />
        </Button>
        <ThemeToggle />
        <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          U
        </div>
      </div>
    </header>
  );
}
