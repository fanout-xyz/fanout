import type { Metadata } from "next";
import { PayeeShell } from "@/components/claim/payee-shell";
import { MotionRoot } from "@/components/motion-root";

export const metadata: Metadata = {
  title: "You've been paid · Fanout",
  robots: { index: false, follow: false },
};

export default function ClaimLayout({ children }: LayoutProps<"/claim">) {
  return (
    <MotionRoot>
      <PayeeShell>{children}</PayeeShell>
    </MotionRoot>
  );
}
