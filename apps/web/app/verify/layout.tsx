import type { Metadata } from "next";
import { PayeeShell } from "@/components/claim/payee-shell";
import { MotionRoot } from "@/components/motion-root";

export const metadata: Metadata = {
  title: "Verified earnings · Fanout",
  robots: { index: false, follow: false },
};

export default function VerifyLayout({ children }: LayoutProps<"/verify">) {
  return (
    <MotionRoot>
      <PayeeShell>{children}</PayeeShell>
    </MotionRoot>
  );
}
