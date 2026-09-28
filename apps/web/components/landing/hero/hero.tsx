import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FanOut } from "./fan-out";

export function Hero() {
  return (
    <section className="mx-auto grid w-full max-w-[1280px] flex-1 items-center gap-10 px-6 py-10 lg:grid-cols-12 lg:gap-8 lg:py-6">
      <div className="flex flex-col items-start gap-6 lg:col-span-5">
        <h1 className="font-display text-[clamp(48px,8vw,96px)] leading-[1.02] tracking-[-0.03em] text-ink">
          Pay everyone.
          <br />
          <span className="text-cobalt">All at once.</span>
        </h1>
        <p className="max-w-[34ch] text-lg leading-normal font-medium text-pretty text-muted sm:text-xl">
          Fanout turns one deposit into hundreds of payouts that land in seconds, in dollars,
          anywhere. No bank wires, no five-day wait.
        </p>
        <div className="flex w-full flex-col gap-3 pt-2 sm:w-auto sm:flex-row">
          <Button asChild size="lg">
            <Link href="/dashboard">Try the demo</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <a href="#how-it-works">See how it works</a>
          </Button>
        </div>
      </div>
      <div className="lg:col-span-7">
        <FanOut />
      </div>
    </section>
  );
}
