import type { Address } from "viem";
import type { PayeeHistoryItem } from "@/lib/fanout/types";
import { decodePassport, verifyPassport, type Passport } from "./passport";
import { decodeFields, encodeFields, type ShareFields } from "./passport-share";

/**
 * The verified earnings badge: a small image a payee can put on their own pages, linking to the
 * verify page for their passport.
 *
 * Every word on it comes from the signed statement, and only after the server has checked it the
 * same way the verify page does (both signatures, then the payouts on record). The fields follow
 * the payee's share choices; the total is never shown, because it isn't part of what's signed.
 * Anything that doesn't check out, or doesn't parse, gets the same neutral "not verified" badge.
 */

export type BadgeTheme = "light" | "dark";

export type BadgeRequest = { passport: Passport; fields: ShareFields; theme: BadgeTheme };

/** Encoded passports are a few hundred characters; anything far larger isn't one. */
const MAX_PASSPORT_CHARS = 4_000;

export function parseBadgeRequest(params: { get(name: string): string | null }): { theme: BadgeTheme; request: BadgeRequest | null } {
  const rawTheme = params.get("theme");
  const theme: BadgeTheme = rawTheme === "dark" ? "dark" : "light";
  const p = params.get("p");
  const show = params.get("show");
  if (!p || p.length > MAX_PASSPORT_CHARS || (show !== null && !/^[apt]{0,3}$/.test(show))) return { theme, request: null };
  const passport = decodePassport(p);
  return { theme, request: passport ? { passport, fields: decodeFields(show), theme } : null };
}

export type BadgeModel = { verified: boolean; label: string; message: string };

export const UNVERIFIED: BadgeModel = { verified: false, label: "Earnings", message: "Not verified" };

/** Words for a verified passport, from the signed statement and the payee's choices only. */
export function badgeModel(passport: Passport, fields: ShareFields): BadgeModel {
  const s = passport.statement;
  const parts = [
    ...(fields.amount ? [`at least $${s.minMonthlyUsd.toLocaleString("en-US")}/mo`] : ["paid every month"]),
    `${s.months.length} ${s.months.length === 1 ? "month" : "months"}`,
    ...(fields.platforms ? [`${s.platforms} ${s.platforms === 1 ? "platform" : "platforms"}`] : []),
  ];
  return { verified: true, label: "Verified", message: parts.join(" · ") };
}

/** Checks the passport against the payouts on record; the neutral badge for anything else. */
export async function resolveBadge(
  request: BadgeRequest | null,
  history: (account: Address) => Promise<PayeeHistoryItem[] | null>,
  now: number,
): Promise<BadgeModel> {
  if (!request) return UNVERIFIED;
  try {
    const records = await history(request.passport.statement.account);
    if (!records) return UNVERIFIED;
    const verdict = await verifyPassport(request.passport, records, now);
    return verdict.ok ? badgeModel(request.passport, request.fields) : UNVERIFIED;
  } catch {
    return UNVERIFIED;
  }
}

/**
 * A verified badge stays verified (payouts already on record don't go away), so it caches for a
 * day. The neutral one caches briefly, in case the records were just behind. The SVG may not run
 * anything, and any site may embed it.
 */
export function badgeResponseHeaders(model: BadgeModel): Record<string, string> {
  return {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": model.verified
      ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
      : "public, max-age=300, s-maxage=300",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  };
}

// --- Drawing ---

const THEMES = {
  light: {
    verified: { left: "#1B1B2F", leftText: "#FFF6EA", mark: "#C9F2DC", right: "#FFF6EA", rightText: "#1B1B2F", border: "#E8DFD0" },
    neutral: { left: "#E8DFD0", leftText: "#1B1B2F", mark: "#6B645A", right: "#FFFFFF", rightText: "#6B645A", border: "#E8DFD0" },
  },
  dark: {
    verified: { left: "#C9F2DC", leftText: "#131211", mark: "#12805C", right: "#1D1B18", rightText: "#F4EEE4", border: "#34302B" },
    neutral: { left: "#272420", leftText: "#F4EEE4", mark: "#A8A196", right: "#1D1B18", rightText: "#A8A196", border: "#34302B" },
  },
} as const;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Rough width of system sans text at 12px; text is then fitted to it exactly with textLength. */
export function textWidth(s: string, bold = false): number {
  let w = 0;
  for (const ch of s) {
    w += /[ .·,/]/.test(ch) ? 3.6 : /[il1|]/.test(ch) ? 3.4 : /[mwMW]/.test(ch) ? 10 : /[A-Z$0-9]/.test(ch) ? 7.6 : 6.5;
  }
  return Math.ceil(w * (bold ? 1.06 : 1));
}

export function badgeSvg(model: BadgeModel, theme: BadgeTheme): string {
  const c = THEMES[theme][model.verified ? "verified" : "neutral"];
  const h = 28;
  const icon = 18;
  const lw = textWidth(model.label, true);
  const mw = textWidth(model.message);
  const left = 10 + icon + 6 + lw + 10;
  const width = left + 10 + mw + 12;
  const alt = `${model.label}: ${model.message}. Fanout Earnings Passport`;
  const font = `font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12"`;
  // A check for verified, a dash otherwise, inside a small round seal.
  const glyph = model.verified
    ? `<path d="M${10 + 5} 14.2l2.6 2.6 5.2-5.6" fill="none" stroke="${c.left}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M${10 + 5.5} 14h7" stroke="${c.left}" stroke-width="2" stroke-linecap="round"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="${escape(alt)}">`,
    `<title>${escape(alt)}</title>`,
    `<clipPath id="r"><rect width="${width}" height="${h}" rx="8"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${width}" height="${h}" fill="${c.right}"/>`,
    `<rect width="${left}" height="${h}" fill="${c.left}"/>`,
    `</g>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${h - 1}" rx="7.5" fill="none" stroke="${c.border}"/>`,
    `<circle cx="${10 + icon / 2}" cy="14" r="${icon / 2}" fill="${c.mark}"/>`,
    glyph,
    `<g ${font}>`,
    `<text x="${10 + icon + 6}" y="18" fill="${c.leftText}" font-weight="700" textLength="${lw}" lengthAdjust="spacingAndGlyphs">${escape(model.label)}</text>`,
    `<text x="${left + 10}" y="18" fill="${c.rightText}" font-weight="600" textLength="${mw}" lengthAdjust="spacingAndGlyphs">${escape(model.message)}</text>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

// --- What the payee copies ---

export function badgeImageUrl(origin: string, encodedPassport: string, fields: ShareFields, theme: BadgeTheme): string {
  const q = new URLSearchParams({ p: encodedPassport, show: encodeFields(fields), theme });
  return `${origin}/api/passport/badge?${q.toString()}`;
}

export function badgeAlt(passport: Passport, fields: ShareFields): string {
  const m = badgeModel(passport, fields);
  return `Verified earnings: ${m.message}, checked by Fanout`;
}

export function badgeSnippets(imageUrl: string, linkUrl: string, alt: string) {
  const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return {
    html: `<a href="${attr(linkUrl)}"><img src="${attr(imageUrl)}" alt="${attr(alt)}" height="28"></a>`,
    markdown: `[![${alt.replace(/[[\]]/g, "")}](${imageUrl})](${linkUrl})`,
    link: linkUrl,
  };
}
