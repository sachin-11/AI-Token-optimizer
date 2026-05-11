import { DashboardFrame } from "@/components/shared/dashboard-frame";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardFrame>{children}</DashboardFrame>;
}
