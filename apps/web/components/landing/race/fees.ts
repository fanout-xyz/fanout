// Illustrative numbers for the race. Every displayed amount is derived from these.

export const SENT_CENTS = 50_000; // $500.00

export type Fee = { label: string; type: "flat" | "pct"; value: number };

/** Wire fees, applied in order: flat values in dollars, pct on what's left at that point. */
export const WIRE_FEES: Fee[] = [
  { label: "−$25 wire fee", type: "flat", value: 25 },
  { label: "−$15 intermediary", type: "flat", value: 15 },
  { label: "−2.5% FX", type: "pct", value: 2.5 },
];

/** Where each fee peels off along the week (0..1); days sit at 0.1, 0.3, 0.5, 0.7, 0.9. */
export const FEE_AT = [0.1, 0.5, 0.7] as const;

/** Fanout's only cost in the example: one small network fee. */
export const FANOUT_NETWORK_FEE_CENTS = 10;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** Amount left after the first `applied` fees. */
export function afterFees(applied: number, fees: Fee[] = WIRE_FEES, start = SENT_CENTS): number {
  return fees.slice(0, applied).reduce((left, fee) => {
    const cut = fee.type === "flat" ? Math.round(fee.value * 100) : Math.round((left * fee.value) / 100);
    return left - cut;
  }, start);
}

export const WIRE_RESULT_CENTS = afterFees(WIRE_FEES.length); // 44_850 -> $448.50
export const FANOUT_RESULT_CENTS = SENT_CENTS - FANOUT_NETWORK_FEE_CENTS; // $499.90
