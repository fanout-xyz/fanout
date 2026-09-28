import type { Metadata } from "next";
import { PayeeShell } from "@/components/claim/payee-shell";
import { MotionRoot } from "@/components/motion-root";

export const metadata: Metadata = {
  title: "Your balance · Fanout",
  robots: { index: false, follow: false },
};

export default function WalletLayout({ children }: LayoutProps<"/wallet">) {
  return (
    <MotionRoot>
      <PayeeShell>{children}</PayeeShell>
    </MotionRoot>
  );
}
