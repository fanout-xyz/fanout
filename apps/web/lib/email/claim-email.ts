import { formatUsd } from "@/lib/money";

/**
 * The email a payee gets with their claim link. Payee copy: plain money words only (no wallet,
 * token, chain or gas), amounts as $1,234.56.
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

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function claimEmail({ platformName, amount, link, balanceUrl, note, expiresAt, reminder }: ClaimEmailInput) {
  const usd = formatUsd(amount);
  const safeNote = cleanNote(note);
  const by = expiresAt ? formatDate(expiresAt) : null;
  const balanceHost = balanceUrl ? new URL(balanceUrl).host : null;
  const subject = `${reminder ? "Reminder: " : ""}${platformName} sent you ${usd}`;

  const text = [
    reminder ? `${platformName} sent you ${usd}, and it's still waiting for you.` : `${platformName} sent you ${usd}.`,
    safeNote ? `Note: ${safeNote}` : null,
    "",
    "Get your money here:",
    link,
    "",
    "Sign in with this email address to receive it. It takes about a minute.",
    by ? `Claim it by ${by}. After that, the money goes back to ${platformName}.` : null,
    balanceUrl ? `Check your balance anytime at ${balanceUrl}` : null,
    "",
    "This link is only for you. Don't forward it.",
    "Fanout sends payouts for platforms. You didn't expect this? You can ignore this email.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const p = (content: string, style = "") =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#14142A;${style}">${content}</p>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#FFF6EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF6EA;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:16px;padding:32px;">
<tr><td>
${p(`${escapeHtml(platformName)} sent you`, "color:#5A5A70;margin-bottom:4px;")}
<p style="margin:0 0 24px;font-size:40px;line-height:48px;font-weight:700;color:#14142A;">${escapeHtml(usd)}</p>
${reminder ? p("It's still waiting for you.", "color:#5A5A70;") : ""}
${safeNote ? p(escapeHtml(safeNote), "color:#5A5A70;") : ""}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:999px;background:#3355FF;">
<a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;">Get your money</a>
</td></tr></table>
${p("Sign in with this email address to receive it. It takes about a minute.")}
${by ? p(`Claim it by ${escapeHtml(by)}. After that, the money goes back to ${escapeHtml(platformName)}.`) : ""}
${balanceUrl && balanceHost ? p(`Check your balance anytime at <a href="${escapeHtml(balanceUrl)}" style="color:#3355FF;">${escapeHtml(balanceHost)}</a>.`) : ""}
<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#5A5A70;">This link is only for you. Don't forward it. Fanout sends payouts for platforms. You didn't expect this? You can ignore this email.</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
