"use client";

import { Share2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * The action row under the passport cover. Share is always first; further passport actions sit
 * beside it as more buttons in `children`, two per row on a phone.
 */
export function PassportActions({ onShare, children }: { onShare: () => void; children?: ReactNode }) {
  return (
    <nav aria-label="Passport actions" className="grid grid-cols-2 gap-2">
      <Button size="lg" className={children ? "h-12 w-full" : "col-span-2 h-12 w-full"} onClick={onShare}>
        <Share2 aria-hidden className="size-4" /> Share
      </Button>
      {children}
    </nav>
  );
}
