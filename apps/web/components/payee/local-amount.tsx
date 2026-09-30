"use client";

import { ChevronDown } from "lucide-react";
import { currencyName, formatLocal, isLocalCurrency, LOCAL_CURRENCIES, rateAgeLabel } from "@/lib/fx";
import { useFxRates, useLocalCurrency } from "@/lib/use-local-currency";
import { cn } from "@/lib/utils";

/**
 * "≈ ₦74,000 at today's rate" under a dollar amount, with a picker for the currency.
 * Display only: the money stays in dollars. Renders nothing until rates load, or if they can't.
 */
export function LocalAmount({ cents, className }: { cents: number; className?: string }) {
  const { currency, setCurrency } = useLocalCurrency();
  const fx = useFxRates();
  if (!fx.data) return null;

  const rate = currency ? fx.data.rates[currency] : undefined;
  const picker = (
    <CurrencyPicker
      value={rate ? currency : null}
      available={LOCAL_CURRENCIES.filter((c) => fx.data.rates[c])}
      onChange={setCurrency}
    />
  );

  return (
    <p className={cn("flex flex-wrap items-center justify-center gap-x-1.5 text-sm text-muted", className)}>
      {currency && rate ? (
        <>
          <span>
            ≈ <span className="font-semibold text-foreground tabular-nums">{formatLocal(cents, rate, currency)}</span>{" "}
            {rateAgeLabel(fx.data.updatedAt)}
          </span>
          {picker}
        </>
      ) : (
        picker
      )}
    </p>
  );
}

/** A native select (the phone's own picker) dressed as a small text button. */
function CurrencyPicker({
  value,
  available,
  onChange,
}: {
  value: string | null;
  available: readonly (typeof LOCAL_CURRENCIES)[number][];
  onChange: (next: (typeof LOCAL_CURRENCIES)[number] | null) => void;
}) {
  return (
    <span className="relative -mx-1 inline-flex items-center gap-0.5 rounded-sm px-1 font-semibold text-foreground underline-offset-4 focus-within:ring-2 focus-within:ring-ring hover:underline">
      {value ?? "Show in your currency"}
      <ChevronDown aria-hidden className="size-3.5" />
      <select
        aria-label="Show amounts in"
        value={value ?? "USD"}
        onChange={(e) => onChange(isLocalCurrency(e.target.value) ? e.target.value : null)}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0"
      >
        <option value="USD">US dollars only</option>
        {available.map((code) => (
          <option key={code} value={code}>
            {currencyName(code)} ({code})
          </option>
        ))}
      </select>
    </span>
  );
}
