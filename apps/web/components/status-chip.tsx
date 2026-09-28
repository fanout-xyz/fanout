import { cn } from "@/lib/utils";

export type ChipStatus = "sent" | "claimed" | "refunded" | "failed";

// FANOUT_UI_GUIDELINES §6 plus the dark-mode chip mapping.
const STYLES: Record<ChipStatus, string> = {
  sent: "bg-line text-foreground dark:bg-card-raised",
  claimed: "bg-mint-surface text-on-mint",
  refunded: "bg-tangerine/15 text-refunded-fg dark:bg-tangerine/16",
  failed: "bg-danger/10 text-danger dark:bg-danger/16",
};

const LABELS: Record<ChipStatus, string> = {
  sent: "Sent",
  claimed: "Claimed",
  refunded: "Refunded",
  failed: "Failed",
};

/** Status pill: always a word, never just a colour. */
export function StatusChip({ status, className }: { status: ChipStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold whitespace-nowrap",
        STYLES[status],
        className,
      )}
    >
      {LABELS[status]}
    </span>
  );
}
