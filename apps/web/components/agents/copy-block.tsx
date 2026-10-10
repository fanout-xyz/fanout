"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** A code snippet with a Copy button. */
export function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the text is selectable.
    }
  }
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <Button variant="secondary" size="xs" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-sm border border-line bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre">{code}</pre>
    </div>
  );
}
