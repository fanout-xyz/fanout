import Link from "next/link";

const linkClass =
  "rounded-sm underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 focus-visible:ring-offset-cream";

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 py-12 text-sm text-muted md:flex-row md:items-center md:justify-between">
      <Link href="/" className={linkClass}>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo SVG from the brand kit */}
        <img src="/brand/svg/lockup/fanout-lockup-primary.svg" alt="Fanout" width={117} height={24} className="h-6 w-auto" />
      </Link>
      <p>Built at Monad Metropolis 2026 · Testnet prototype</p>
      <div className="flex items-center gap-6">
        {/* TODO: real repo URL */}
        <a href="#" className={linkClass}>
          GitHub
        </a>
        <span>© 2026 Fanout</span>
      </div>
    </footer>
  );
}
