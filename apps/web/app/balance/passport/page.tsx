import type { Metadata } from "next";
import { PassportWithLetter } from "@/components/passport/passport-letter";

export const metadata: Metadata = {
  title: "Your Earnings Passport · Fanout",
  robots: { index: false, follow: false },
};

export default function PassportPage() {
  return <PassportWithLetter />;
}
