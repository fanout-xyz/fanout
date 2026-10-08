import { getAusdOnMonad, getFanoutStats } from "@/lib/landing-stats-server";
import { AGORA_METRICS_URL, formatCount, formatDollars, unitsToDollars } from "@/lib/landing-stats";

const ONCHAIN_PROOF_URL = "https://github.com/fanout-xyz/fanout#onchain-proof";

type Stat = { value: string; label: string; source: string; href: string };

/** Live numbers under the hero. Each one links to where it comes from; any that can't be fetched is left out. */
export async function ProofStrip() {
  const [ausd, fanout] = await Promise.all([getAusdOnMonad(), getFanoutStats()]);

  const stats: Stat[] = [];
  if (ausd !== null) {
    stats.push({ value: formatDollars(ausd), label: "AUSD on Monad", source: "Live from Agora", href: AGORA_METRICS_URL });
  }
  if (fanout) {
    const fromFanout = { source: "Fanout on Monad testnet", href: ONCHAIN_PROOF_URL };
    const paidOut = unitsToDollars(fanout.paidOut);
    if (paidOut > 0) stats.push({ value: formatDollars(paidOut), label: "paid out", ...fromFanout });
    if (fanout.payouts > 0) stats.push({ value: formatCount(fanout.payouts), label: fanout.payouts === 1 ? "payout sent" : "payouts sent", ...fromFanout });
    if (fanout.peoplePaid > 0) stats.push({ value: formatCount(fanout.peoplePaid), label: fanout.peoplePaid === 1 ? "person paid" : "people paid", ...fromFanout });
    if (fanout.claimed > 0) stats.push({ value: formatCount(fanout.claimed), label: fanout.claimed === 1 ? "claim completed" : "claims completed", ...fromFanout });
  }
  if (stats.length === 0) return null;

  return (
    <section aria-labelledby="proof-title" className="border-y border-line bg-background">
      <div className="mx-auto w-full max-w-[1280px] px-6 py-8 lg:py-10">
        <h2 id="proof-title" className="flex items-center gap-2 text-[13px] font-bold tracking-[0.12em] text-muted uppercase">
          <span aria-hidden className="size-2 rounded-full bg-success motion-safe:animate-pulse" />
          Live numbers
        </h2>
        <ul className="mt-5 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
          {stats.map((s) => (
            <li key={s.label} className="min-w-0">
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
              >
                <span className="block font-display text-[clamp(28px,3.4vw,40px)] leading-none tracking-[-0.02em] text-foreground tabular-nums">
                  {s.value}
                </span>
                <span className="mt-2 block text-sm font-semibold text-foreground">{s.label}</span>
                <span className="mt-1 block text-xs text-muted underline-offset-4 group-hover:text-foreground group-hover:underline">
                  {s.source}
                  <span className="sr-only"> (opens in a new tab)</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
