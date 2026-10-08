"use client";

import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useId } from "react";
import { useAiPost } from "@/lib/ai/use-ai";
import { riskSignature, type RiskReason } from "@/lib/payout-risk";

type Props = {
  reasons: RiskReason[];
  /** Ask the assistant to word the explanation (AI on). The rules and this box work without it. */
  aiWording: boolean;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  disabled: boolean;
};

/** Shown before approval when a payout looks different from this platform's usual ones. */
export function UnusualPayoutWarning({ reasons, aiWording, confirmed, onConfirm, disabled }: Props) {
  const aiPost = useAiPost();
  const checkboxId = useId();
  const wording = useQuery({
    queryKey: ["ai", "explain-risk", riskSignature(reasons)],
    queryFn: () =>
      aiPost<{ explanation: string }>("/api/ai/explain-risk", { reasons: reasons.map(({ kind, facts }) => ({ kind, facts })) }),
    enabled: aiWording && reasons.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/10 p-3">
      <p className="flex items-center gap-2 text-sm font-bold text-warning">
        <TriangleAlert aria-hidden className="size-4 shrink-0" /> This payout looks unusual
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {reasons.map((r) => (
          <li key={r.kind} className="break-words">
            {r.message}
          </li>
        ))}
      </ul>
      {wording.data && (
        <p className="text-sm text-muted">
          {wording.data.explanation} <span className="text-xs">(Written by our assistant.)</span>
        </p>
      )}
      <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-2 text-sm font-semibold">
        <input
          id={checkboxId}
          type="checkbox"
          checked={confirmed}
          disabled={disabled}
          onChange={(e) => onConfirm(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        I&apos;ve checked it. Pay these amounts.
      </label>
    </div>
  );
}
