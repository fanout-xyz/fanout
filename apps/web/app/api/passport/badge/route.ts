import { badgeResponseHeaders, badgeSvg, parseBadgeRequest, resolveBadge } from "@/lib/payee/passport-badge";
import { serverPayeeHistory } from "@/lib/payee/passport-history-server";

/**
 * GET /api/passport/badge?p=<signed passport>&show=<fields>&theme=light|dark
 * The verified earnings badge. Each request checks the passport the same way the verify page
 * does; anything that doesn't check out gets the neutral badge.
 */
export async function GET(request: Request) {
  const { theme, request: badge } = parseBadgeRequest(new URL(request.url).searchParams);
  const model = await resolveBadge(badge, serverPayeeHistory, Date.now());
  return new Response(badgeSvg(model, theme), { headers: badgeResponseHeaders(model) });
}
