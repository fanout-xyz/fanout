"use client";

import posthog from "posthog-js";
import { toast } from "sonner";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { StoredClaim } from "@/lib/fanout/claim-link-store";
import { useEmailClaimLinks } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";

/** Don't email the same person twice within this window. */
export const EMAIL_COOLDOWN_MS = 10 * 60 * 1000;

export const recentlyEmailed = (c: StoredClaim, now = Date.now()) => !!c.emailedAt && now - c.emailedAt < EMAIL_COOLDOWN_MS;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function emailedLabel(c: StoredClaim, now = Date.now()): string {
  if (!c.emailedAt) return "Not emailed yet";
  const minutes = Math.round((now - c.emailedAt) / 60_000);
  if (minutes < 1) return "Emailed just now";
  if (minutes < 60) return `Emailed ${relative.format(-minutes, "minute")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Emailed ${relative.format(-hours, "hour")}`;
  return `Emailed ${relative.format(-Math.round(hours / 24), "day")}`;
}

function reportResult(result: { sent: unknown[]; failed: { reason: string }[] }, asked: number) {
  if (result.failed.length === 0) {
    toast.success(asked === 1 ? "Email sent" : `Emailed ${result.sent.length} people`);
  } else {
    toast.warning(`Emailed ${result.sent.length} of ${asked}`, { description: result.failed[0].reason, duration: 10_000 });
  }
}

/** "N people haven't claimed" with one button to remind them all. */
export function UnclaimedReminder({ waiting, total }: { waiting: StoredClaim[]; total: bigint }) {
  const email = useEmailClaimLinks();
  const due = waiting.filter((c) => !recentlyEmailed(c));
  // Only call it a reminder if everyone it goes to already got the link once.
  const reminder = due.length > 0 && due.every((c) => c.emailedAt);
  if (waiting.length === 0) return null;

  function remind() {
    email.mutate(
      { claims: due, reminder },
      {
        onSuccess: (result) => {
          reportResult(result, due.length);
          posthog.capture("claim_reminders_sent", { recipient_count: result.sent.length, failed_count: result.failed.length });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-card-raised px-4 py-3">
      <p className="text-sm">
        <span className="font-semibold">{people(waiting.length)} haven&apos;t claimed yet</span>{" "}
        <span className="text-muted">({formatUsd(total)} waiting)</span>
      </p>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm" disabled={due.length === 0 || email.isPending}>
            {email.isPending ? <Spinner className="size-4" /> : null}
            {due.length === 0
              ? "Everyone was just emailed"
              : reminder
                ? `Email a reminder to ${people(due.length)}`
                : `Email links to ${people(due.length)}`}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-[-0.015em]">{reminder ? "Send a reminder?" : "Email their links?"}</DialogTitle>
            <DialogDescription>
              {people(due.length)} will get an email with their link.
              {due.length < waiting.length && ` ${people(waiting.length - due.length)} emailed in the last 10 minutes will be skipped.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button onClick={remind}>{reminder ? "Send reminder" : "Send emails"}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Per-row "Email" / "Resend" button. */
export function EmailLinkButton({ claim, amount }: { claim: StoredClaim; amount: bigint }) {
  const email = useEmailClaimLinks();
  const cooling = recentlyEmailed(claim);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={cooling || email.isPending}
      title={cooling ? "Emailed in the last 10 minutes" : undefined}
      aria-label={`${claim.emailedAt ? "Resend" : "Email"} the ${formatUsd(amount)} claim link to ${claim.email}`}
      onClick={() =>
        email.mutate(
          { claims: [claim], reminder: !!claim.emailedAt },
          { onSuccess: (result) => reportResult(result, 1), onError: (err) => toast.error(err.message) },
        )
      }
    >
      {email.isPending ? <Spinner className="size-4" /> : claim.emailedAt ? "Resend" : "Email"}
    </Button>
  );
}
