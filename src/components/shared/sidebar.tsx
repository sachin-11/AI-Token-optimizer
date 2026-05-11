import { SidebarNav } from "@/components/shared/sidebar-nav";

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 flex-col border-r bg-card">
      <SidebarNav />
    </aside>
  );
}
