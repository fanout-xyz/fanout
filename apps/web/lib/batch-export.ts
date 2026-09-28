import { formatUnits } from "viem";
import { config } from "./config";

export type ExportRow = {
  email?: string;
  amount: bigint;
  note?: string;
  status: string;
  claimLink?: string;
};

/**
 * One CSV cell. Quotes when needed, and neutralises spreadsheet formulas
 * (cells starting with = + - @ tab or CR) since notes come from user uploads.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Base units -> "156.50": at least two decimals, never rounds away sub-cent digits. */
function plainAmount(amount: bigint): string {
  const [whole, frac = ""] = formatUnits(amount, config.stablecoin.decimals).split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

export function batchToCsv(rows: ExportRow[], { includeLinks = false } = {}): string {
  const header = ["email", "amount", "note", "status", ...(includeLinks ? ["claim_link"] : [])];
  const lines = rows.map((r) =>
    [
      r.email ?? "",
      plainAmount(r.amount),
      r.note ?? "",
      r.status,
      ...(includeLinks ? [r.claimLink ?? ""] : []),
    ].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}
