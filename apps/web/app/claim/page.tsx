import { headers } from "next/headers";
import { ClaimFlow } from "@/components/claim/claim-flow";
import { claimPageLanguage } from "@/lib/i18n/messages";

/**
 * The claim page opens in the payee's language: the one the platform set for this payout (?lang=,
 * added to emailed links), else the browser's Accept-Language. A choice made on the page wins (ClaimFlow).
 */
export default async function ClaimPage(props: PageProps<"/claim">) {
  const query = await props.searchParams;
  const lang = Array.isArray(query.lang) ? query.lang[0] : query.lang;
  const initialLang = claimPageLanguage({ query: lang, acceptLanguage: (await headers()).get("accept-language") });
  return <ClaimFlow initialLang={initialLang} />;
}
