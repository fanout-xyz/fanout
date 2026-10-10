import { config } from "@/lib/config";
import { DEFAULT_LANG, languageInfo, type Lang } from "@/lib/i18n/languages";
import { formatDollarsFromUnits, translator } from "@/lib/i18n/messages";

/**
 * The email a payee gets with their claim link. Payee copy: plain money words only (no wallet,
 * token, chain or gas), amounts as $1,234.56 in the payee's number format. The language comes from
 * the payout's optional language column (English by default); strings are in lib/i18n/messages/.
 */
export type ClaimEmailInput = {
  platformName: string;
  amount: bigint;
  link: string;
  /** Where the payee checks their balance later (e.g. https://wallet.fanout.tech). */
  balanceUrl?: string;
  /** Optional note from the platform's CSV (e.g. "September payout"). Escaped, never trusted. */
  note?: string;
  /** When unclaimed money goes back to the platform, unix seconds. */
  expiresAt?: number;
  /** A follow-up for someone who hasn't claimed yet. */
  reminder?: boolean;
  /** The payee's language. */
  language?: Lang;
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Notes come from a CSV the platform uploaded. Keep them short and on one line, and drop anything
// that looks like a link so a note can't pose as a second "claim here" button.
export function cleanNote(note: string | undefined): string | undefined {
  const flat = note?.replace(/\s+/g, " ").trim().slice(0, 140);
  if (!flat || /https?:\/\/|www\./i.test(flat)) return undefined;
  return flat;
}

/** A payout can give as little as minutes to claim; then the date alone isn't enough, so add the time. */
const SHOW_TIME_WITHIN_MS = 2 * 24 * 60 * 60 * 1000;

function formatDate(unixSeconds: number, now: number, locale: string): string {
  const at = new Date(unixSeconds * 1000);
  const date = at.toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (at.getTime() - now >= SHOW_TIME_WITHIN_MS) return date;
  return `${date}, ${at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

export function claimEmail({ platformName, amount, link, balanceUrl, note, expiresAt, reminder, language }: ClaimEmailInput, now = Date.now()) {
  const lang = language ?? DEFAULT_LANG;
  const { locale, dir } = languageInfo(lang);
  const t = translator(lang);
  const usd = formatDollarsFromUnits(lang, amount, config.stablecoin.decimals);
  const safeNote = cleanNote(note);
  const by = expiresAt ? formatDate(expiresAt, now, locale) : null;
  const balanceHost = balanceUrl ? new URL(balanceUrl).host : null;
  const subject = t(reminder ? "emailSubjectReminder" : "emailSubject", { platform: platformName, amount: usd });

  const text = [
    t(reminder ? "emailStillWaiting" : "emailSentYou", { platform: platformName, amount: usd }),
    safeNote ? t("emailNote", { note: safeNote }) : null,
    "",
    t("emailGetMoneyHere"),
    link,
    "",
    t("emailSignIn"),
    by ? t("emailClaimBy", { date: by, platform: platformName }) : null,
    balanceUrl ? t("emailBalance", { url: balanceUrl }) : null,
    "",
    t("emailOnlyForYou"),
    t("emailFooter"),
  ]
    .filter((line) => line !== null)
    .join("\n");

  // Escape the translated text first, then put escaped values in, so neither can inject markup.
  const h = (key: Parameters<typeof t>[0], vars: Record<string, string> = {}, raw: Record<string, string> = {}) =>
    escapeHtml(t(key)).replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in raw ? raw[name] : name in vars ? escapeHtml(vars[name]) : whole,
    );
  const align = dir === "rtl" ? "right" : "left";
  const p = (content: string, style = "") =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#14142A;text-align:${align};${style}">${content}</p>`;

  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}"><body style="margin:0;padding:0;background:#FFF6EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF6EA;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:480px;background:#FFFFFF;border-radius:16px;padding:32px;">
<tr><td>
${p(h("emailHeadline", { platform: platformName }), "color:#5A5A70;margin-bottom:4px;")}
<p dir="ltr" style="margin:0 0 24px;font-size:40px;line-height:48px;font-weight:700;color:#14142A;text-align:${align};">${escapeHtml(usd)}</p>
${reminder ? p(h("emailStillWaitingShort"), "color:#5A5A70;") : ""}
${safeNote ? p(escapeHtml(safeNote), "color:#5A5A70;") : ""}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:999px;background:#3355FF;">
<a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;">${h("emailButton")}</a>
</td></tr></table>
${p(h("emailSignIn"))}
${by ? p(h("emailClaimBy", { date: by, platform: platformName })) : ""}
${balanceUrl && balanceHost ? p(`${h("emailBalance", {}, { url: `<a href="${escapeHtml(balanceUrl)}" style="color:#3355FF;">${escapeHtml(balanceHost)}</a>` })}.`) : ""}
<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#5A5A70;text-align:${align};">${h("emailOnlyForYou")} ${h("emailFooter")}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
