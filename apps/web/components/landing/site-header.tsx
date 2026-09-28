import Link from "next/link";
import { SignInCta } from "@/components/sign-in-cta";

export function SiteHeader() {
  return (
    <header className="relative z-10 mx-auto flex h-18 w-full max-w-[1280px] items-center justify-between px-6">
      <Link
        href="/"
        className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- logo SVG from the brand kit */}
        <img src="/brand/svg/lockup/fanout-lockup-primary.svg" alt="Fanout" width={136} height={28} className="h-7 w-auto" />
      </Link>
      <SignInCta variant="secondary" size="sm" />
    </header>
  );
}
