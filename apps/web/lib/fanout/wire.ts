/** JSON with bigint support: bigints travel as { __big: "123" }. Shared by the mock API and its client. */

export function toWire(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { __big: v.toString() } : v));
}

export function fromWire<T>(raw: string): T {
  return JSON.parse(raw, (_k, v) => (v && typeof v === "object" && typeof v.__big === "string" ? BigInt(v.__big) : v));
}
