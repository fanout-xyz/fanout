"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Small pieces shared by the wallet's screens (send, receive, request, scan). */

export function BackButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-fit rounded-sm text-sm font-semibold text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      ← {label}
    </button>
  );
}

/** "0x5290 8400 0985 …": grouped in fours so it's easy to compare by eye. */
export function groupAddress(address: string): string {
  return `0x ${(address.slice(2).match(/.{1,4}/g) ?? []).join(" ")}`;
}

/** Dark-on-white in both themes, with a quiet zone, so every phone camera can read it. */
export function PayQr({ value, title }: { value: string; title: string }) {
  return (
    <div className="mx-auto w-fit rounded-xl bg-white p-5 shadow-[var(--shadow-float)]">
      <QRCodeSVG value={value} size={232} level="M" marginSize={0} title={title} />
    </div>
  );
}

export function CopyButton({ text, label, copiedLabel = "Copied" }: { text: string; label: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy. Press and hold to copy instead.");
    }
  }
  return (
    <Button type="button" variant="secondary" className="h-12 flex-1" onClick={() => void copy()} aria-live="polite">
      {copied ? <Check /> : <Copy />}
      {copied ? copiedLabel : label}
    </Button>
  );
}

/** The phone's share sheet (WhatsApp, Telegram, Messages…), or copy where there isn't one. */
export function ShareButton({ url, text, title }: { url: string; text: string; title: string }) {
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // Closing the share sheet isn't an error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast.success("Link copied. Paste it in any chat.");
    } catch {
      toast.error("Couldn't share. Copy the link instead.");
    }
  }
  return (
    <Button type="button" className="h-12 flex-1" onClick={() => void share()}>
      <Share2 />
      Share
    </Button>
  );
}
