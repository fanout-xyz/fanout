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
