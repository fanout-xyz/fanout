// Illustrative numbers for the race. Every displayed amount is derived from these.

export const SENT_CENTS = 8_000; // $80.00

export type Fee = {
  label: string;
  /** Where along the week (0..1) the fee peels off; days sit at 0.1, 0.3, 0.5, 0.7, 0.9. */
  at: number;
} & ({ kind: "fixed"; cents: number } | { kind: "percent"; percent: number });

export const WIRE_FEES: Fee[] = [
  { label: "−$25 wire fee", at: 0.1, kind: "fixed", cents: 2_500 },
  { label: "−$15 intermediary", at: 0.5, kind: "fixed", cents: 1_500 },
  { label: "−2.5% FX", at: 0.7, kind: "percent", percent: 2.5 },
];

/** Fanout's only cost in the example: one small network fee. */
export const FANOUT_NETWORK_FEE_CENTS = 10;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** Amount left after the first `applied` fees, applied in order (FX on what's left at that point). */
export function afterFees(applied: number, fees: Fee[] = WIRE_FEES, start = SENT_CENTS): number {
  return fees.slice(0, applied).reduce((left, fee) => {
    const cut = fee.kind === "fixed" ? fee.cents : Math.round((left * fee.percent) / 100);
    return left - cut;
  }, start);
}

export const WIRE_RESULT_CENTS = afterFees(WIRE_FEES.length);
export const FANOUT_RESULT_CENTS = SENT_CENTS - FANOUT_NETWORK_FEE_CENTS;
