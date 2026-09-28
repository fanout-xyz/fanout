import { explorerTxUrl } from "@/lib/chains";
import { cn } from "@/lib/utils";

export type TxStage = "preparing" | "confirming" | "done";

const STEPS: { key: TxStage; label: string }[] = [
  { key: "preparing", label: "Preparing" },
  { key: "confirming", label: "Confirming" },
  { key: "done", label: "Done" },
];

/**
 * Three-step transaction progress (guidelines §6). Cobalt progress line, success check.
 * `showTxLink` is for the dashboard side only; payee screens never show it.
 */
export function TxProgress({ stage, txHash, showTxLink = false }: { stage: TxStage; txHash?: string; showTxLink?: boolean }) {
  const current = STEPS.findIndex((s) => s.key === stage);
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex items-center" aria-label="Transaction progress">
        {STEPS.map((step, i) => {
          const complete = i < current || stage === "done";
          const active = i === current && stage !== "done";
          return (
            <li key={step.key} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                    complete && "border-success bg-success text-background",
                    active && "border-primary text-primary",
                    !complete && !active && "border-line text-muted",
                  )}
                  aria-hidden
                >
                  {complete ? <Check /> : active ? <Spinner /> : i + 1}
                </span>
                <span className={cn("text-sm font-semibold", complete || active ? "text-foreground" : "text-muted")}>
                  {step.label}
                  <span className="sr-only">{complete ? " (complete)" : active ? " (in progress)" : ""}</span>
                </span>
              </span>
              {i < STEPS.length - 1 && (
                <span className="mx-3 h-0.5 flex-1 rounded-full bg-line" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: i < current || stage === "done" ? "100%" : "0%" }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {showTxLink && txHash && stage === "done" && (
        <a
          href={explorerTxUrl(txHash)}
          target="_blank"
          rel="noreferrer"
          className="w-fit rounded-sm text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          View transaction
        </a>
      )}
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-3.5 animate-spin", className)} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
