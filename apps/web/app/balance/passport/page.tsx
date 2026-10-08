import type { Metadata } from "next";
import { PassportView } from "@/components/passport/passport-view";

export const metadata: Metadata = {
  title: "Your Earnings Passport · Fanout",
  robots: { index: false, follow: false },
};

export default function PassportPage() {
  return <PassportView />;
}
