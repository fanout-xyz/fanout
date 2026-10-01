import { cn } from "@/lib/utils";

// Desk research from the bounty plan (Sep 30, 2026); every figure is from the provider's own page.
type Row = { name: string; cost: string; needs: string; breaks: string; source?: string; fanout?: boolean };

const ROWS: Row[] = [
  {
    name: "PayPal Payouts",
    cost: "About 6% ($3.00): 2% fee plus about 4% FX",
    needs: "A PayPal account",
    breaks: "Not offered in Nigeria, Pakistan, Bangladesh or Ghana",
    source: "https://developer.paypal.com/docs/payouts/standard/reference/country-feature/",
  },
  {
    name: "Wise Business",
    cost: "1.5–2.6% ($0.75–$1.30), plus $31 setup",
    needs: "A local bank account",
    breaks: "Anyone without a supported bank",
    source: "https://wise.com/us/pricing/business/",
  },
  {
    name: "Trolley",
    cost: "10–22% ($5–$11) once the $2,399 yearly plan and per-payout fees are counted",
    needs: "A bank account",
    breaks: "Fixed fees swamp small payouts",
    source: "https://trolley.com/trolley-pricing/",
  },
  {
    name: "Fanout",
    cost: "The network fee only, shared by the whole batch",
    needs: "An email address",
    breaks: "Cash-out to local banks is on the roadmap",
    fanout: true,
  },
];

/** Paying one person $50 abroad, provider by provider. Lives in the always-dark race band. */
export function FeeTable() {
  return (
    <div className="mt-16 lg:mt-20">
      <h3 className="font-display text-[clamp(24px,3vw,32px)] leading-tight tracking-[-0.02em]">Paying one person $50 abroad</h3>
      <div role="table" aria-label="Paying one person $50 abroad" className="mt-6 text-[15px]">
        <div role="row" className="hidden gap-6 border-b border-cream/15 pb-3 text-[13px] font-semibold text-cream/60 md:grid md:grid-cols-[8rem_1.4fr_1fr_1.2fr] lg:grid-cols-[10rem_1.4fr_1fr_1.2fr]">
          <span role="columnheader">Provider</span>
          <span role="columnheader">Cost on $50</span>
          <span role="columnheader">What the payee needs</span>
          <span role="columnheader">Where it breaks</span>
        </div>
        {ROWS.map((r) => (
          <div
            key={r.name}
            role="row"
            className={cn(
              "grid gap-1 border-b border-cream/15 py-4 md:grid-cols-[8rem_1.4fr_1fr_1.2fr] lg:grid-cols-[10rem_1.4fr_1fr_1.2fr] md:gap-6",
              r.fanout && "-mx-3 rounded-lg border-transparent bg-cream/[0.06] px-3",
            )}
          >
            <span role="rowheader" className={cn("font-semibold", r.fanout && "text-mint")}>
              {r.name}
            </span>
            <span role="cell" className={cn(r.fanout ? "text-cream" : "text-cream/80")}>
              <span className="text-cream/60 md:hidden">Cost: </span>
              {r.cost}
            </span>
            <span role="cell" className="text-cream/80">
              <span className="text-cream/60 md:hidden">Payee needs: </span>
              {r.needs}
            </span>
            <span role="cell" className="text-cream/80">
              <span className="text-cream/60 md:hidden">Breaks: </span>
              {r.breaks}
              {r.source && (
                <>
                  {" "}
                  <a
                    href={r.source}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-sm text-cream/60 underline underline-offset-4 outline-none hover:text-cream focus-visible:ring-2 focus-visible:ring-cobalt-on-dark"
                  >
                    Source
                  </a>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
