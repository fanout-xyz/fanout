import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { MotionRoot } from "@/components/motion-root";

export const metadata: Metadata = { title: "Dashboard · Fanout" };

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <MotionRoot>
      <DashboardShell>{children}</DashboardShell>
    </MotionRoot>
  );
}
