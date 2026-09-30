"use client";

import { QRCodeSVG } from "qrcode.react";
import posthog from "posthog-js";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatUsd } from "@/lib/money";

type Props = { link: string; email: string; amount: bigint };

const isLocalOrigin = (link: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(link);

export function ClaimLinkActions({ link, email, amount }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      posthog.capture("claim_link_copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the link in the QR view and copy it by hand.");
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={() => void copy()} aria-label={`Copy claim link for ${email}`}>
        {copied ? "Copied" : "Copy link"}
      </Button>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Show QR code for ${email}`}>
            QR
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-[-0.015em]">{formatUsd(amount)} for {email}</DialogTitle>
            <DialogDescription>Scan to open the claim page. Anyone with this link can claim the money, so share it only with {email}.</DialogDescription>
          </DialogHeader>
          {/* QR stays dark-on-white in both themes so every phone camera can read it. */}
          <div className="ph-no-capture mx-auto rounded-md bg-white p-4">
            <QRCodeSVG value={link} size={224} level="M" marginSize={0} title={`Claim link for ${email}`} />
          </div>
          {isLocalOrigin(link) && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning" role="note">
              This link points to localhost, which a phone can&apos;t open. For the phone demo, open the dashboard from your
              computer&apos;s network address or an HTTPS tunnel, then show the QR again.
            </p>
          )}
          <input
            readOnly
            value={link}
            aria-label="Claim link"
            onFocus={(e) => e.currentTarget.select()}
            className="ph-no-capture h-10 w-full rounded-sm border border-line bg-card-raised px-3 font-mono text-xs text-muted"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
