/**
 * The site's public origin, for links that leave the browser (claim emails, social cards).
 * NEXT_PUBLIC_SITE_URL wins; on Vercel it falls back to the project's production domain
 * (e.g. fanout.tech), which Vercel sets on every deployment; locally, localhost.
 * Server only: VERCEL_PROJECT_PRODUCTION_URL isn't exposed to the browser.
 */
export function siteOrigin(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || (vercel ? `https://${vercel}` : "http://localhost:3000");
  return origin.replace(/\/$/, "");
}

/** The live payee address. Same app as the platform side, under its own name (see next.config.ts). */
export const WALLET_ORIGIN = "https://wallet.fanout.tech";

/**
 * Where payees go: claim links and "check your balance". wallet.fanout.tech whenever the site runs
 * on fanout.tech; elsewhere (localhost, Vercel previews) the site itself. NEXT_PUBLIC_WALLET_URL wins.
 */
export function walletOrigin(): string {
  if (process.env.NEXT_PUBLIC_WALLET_URL) return process.env.NEXT_PUBLIC_WALLET_URL.replace(/\/$/, "");
  const site = siteOrigin();
  const host = new URL(site).hostname;
  return host === "fanout.tech" || host.endsWith(".fanout.tech") ? WALLET_ORIGIN : site;
}
