// Claim links carry the payee's claim key in the fragment (/claim#k=...). Anyone holding it can
// take the money, so it must never leave the browser: not in $current_url, autocapture's element
// hrefs, exception messages or replays.
const CLAIM_KEY = /((?:#|%23)k(?:=|%3D))[0-9a-fA-F]+/g;

/** Deep-copies `value` with every claim key replaced by "redacted". */
export function scrubClaimKeys<T>(value: T): T {
  if (typeof value === "string") return value.replace(CLAIM_KEY, "$1redacted") as T;
  if (Array.isArray(value)) return value.map(scrubClaimKeys) as T;
  // Plain objects only: rebuilding a Date (the event timestamp) or other class instance breaks it.
  const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (proto === Object.prototype || proto === null) {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, scrubClaimKeys(v)])) as T;
  }
  return value;
}
