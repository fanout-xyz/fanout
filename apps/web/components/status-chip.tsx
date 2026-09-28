import { cn } from "@/lib/utils";

export type ChipStatus = "sent" | "claimed" | "refunded" | "failed";

const STYLES: Record<ChipStatus, string> = {
  sent: "bg-line text-ink",
  claimed: "bg-mint text-ink",
  refunded: "bg-tangerine/15 text-ink",
  failed: "bg-danger/10 text-danger",
};

const LABELS: Record<ChipStatus, string> = {
  sent: "Sent",
  claimed: "Claimed",
  refunded: "Refunded",
  failed: "Failed",
};

/** Status pill per FANOUT_UI_GUIDELINES §6: always a word, never just a colour. */
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
