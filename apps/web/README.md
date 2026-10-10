This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Trying a full 150-person payout

The New payout page takes up to 150 rows, all paid in one transaction. To make a test file:

```bash
# 150 plus-addressed copies of your own address: you+1@yourdomain.com ... you+150@yourdomain.com
pnpm --filter web demo-csv --to you@yourdomain.com

# or your own list (one address per line, or a CSV with the email first), 40 rows of $2.50
pnpm --filter web demo-csv --list team-emails.txt --rows 40 --amount 2.50
```

It writes `payout-<rows>.csv` where you ran it (`--out` to change that, `--out -` for stdout), with random amounts from $1.00 to $3.00 unless you pass `--amount` or `--min`/`--max`. All options are in the header of `scripts/demo-payout-csv.ts`.

Every row gets a claim email when the payout is sent, so only use inboxes you control. The script refuses made-up and reserved domains (example.com, `*.test`, ...) and domains without mail servers, so nothing bounces. Plus addresses (`you+1@...`) arrive in your own inbox with Gmail, Google Workspace, Fastmail, iCloud and Outlook; check your provider first. Each plus address is its own sign-in, so you claim each payment by signing in with that exact address.

Emails go out through Resend in batches of 100, so a full payout is two API calls. Resend's free plan sends at most 100 emails a day; a 150-person payout needs a paid plan, or you can copy the remaining links from the payout page.

The payout page shows "N of 150 claimed" with the dollars claimed so far. It refreshes every 2.5 seconds for the first two minutes after opening, then every 5 seconds, and stops once everyone has claimed or been returned. In demo mode (`NEXT_PUBLIC_USE_MOCK=true`), **Simulate people claiming** at the bottom of the payout page claims a few payments every second or so, so you can watch it fill up.

## "You've been paid" notifications

Payees can turn on a notification for when a platform pays them: from a prompt in the installed app or after a claim, or with the **Payment notifications** switch on the balance page. When the claim emails for a payout go out, every device a payee turned this on for gets "You've been paid" with "$25.00 from Acme. Tap to see it." (the platform's name and the amount). Tapping it opens their balance, which points them to the claim email. The notification never contains the claim link; the claim key only travels in the email.

- Subscribing needs the payee's signed-in session. The device is filed under a hash of the email(s) their sign-in has verified (the same hash the payout records), never the email itself, and never an email from the request.
- On iPhone and iPad, web notifications only work once Fanout is on the Home Screen (iOS 16.4 or later), so in Safari the app says "Add Fanout to your Home Screen first".
- Devices the push service reports as gone (404/410) are removed on the next send. Signing out turns notifications off on that device.
- Sending runs after the email response and never holds up or fails the emails.

The feature is off (no prompt, no switch, no sends) until it's configured:

1. Print a key pair with `pnpm --filter web vapid-keys` and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` address) in the Vercel project (and `.env.local` for local work). Keep the private key secret and keep the same pair afterwards: a new pair means every payee has to turn notifications on again.
2. In Vercel, add the **Upstash Redis** integration from the Marketplace (Storage > Create Database > Upstash for Redis) and connect it to this project. It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`; `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too. In the local demo (`NEXT_PUBLIC_USE_MOCK=true`) subscriptions are kept in memory instead, so only the VAPID values are needed.
3. Redeploy (the public key is baked in at build time).

Notifications need HTTPS (localhost is fine for desktop browsers; a phone needs the tunnel). The service worker is `public/sw.js`.

## AI assistance

The AI only proposes. It never signs, sends or approves anything: a person reviews every payout and presses Pay, and rows from the assistant go through the same checks as a CSV upload (`lib/csv.ts`) first. Every answer is JSON, checked against a schema (`lib/ai/validate.ts`) before it's used; anything unexpected is refused and nothing changes.

| Feature | What it does | What goes to the AI provider |
| --- | --- | --- |
| **Spreadsheet assistant** (New payout) | Drop a CSV/TSV/export with any columns, or paste rows from a spreadsheet. The assistant maps the columns (email, amount, name, note, country, language) and reads amounts written in words. Amounts like `$1,200.00`, `1.2k`, `1 200,50` are normalised in code; other currencies are flagged, never converted. Invalid emails, duplicates (with a merge), empty and total rows, and amounts far above the file's or that person's usual value are checked in code. The summary reads "48 people, $3,912 · 2 to check"; each flagged row is fixed, confirmed or left out before Pay is enabled. | The table: headers and cells (cut to 120 characters), **including email addresses**, which the UI says before anything is sent. Signed-in platforms only. |
| **Unusual-payout warning** (New payout) | Compares the payout with the platform's recent payouts: total far above usual, a large first payout, new payees with large amounts, the same amount to many people, mostly new payees. Any of these needs an extra tick. The rules are code (`lib/payout-risk.ts`); with AI on, the assistant may reword them. | Only the names of the rules that fired and their numbers. No emails or names. A wording with a dollar amount it wasn't given is refused. |
| **Claim page and email in the payee's language** | English, Spanish, Portuguese, French, Hindi, Urdu, Bengali, Yoruba, Hausa, Indonesian. The page uses the payout's `language` column (sent as `?lang=` on the emailed link), else Accept-Language, and has a switcher. Amounts and dates use the payee's format. | Nothing at view time: translations are static files in `lib/i18n/messages/`, machine-translated once with `pnpm --filter web translate` and committed (marked `machineTranslated`). |
| **Passport letter** (Earnings Passport) | "Write a letter" drafts a short income letter for a landlord or lender, in a chosen language, from a freshly signed passport. The payee edits it before copying or sharing. | Only the passport statement's period, monthly floor and number of platforms (the server checks its signatures first). No payments, name, email or account; the verify link is added by code. |

Limits: a 45-second timeout, request size caps (400 rows, 40 columns), per-IP and per-session (or per-passport) rate limits held in memory like the relay routes, and a signed-in session for the platform features. Nothing sent to the provider is stored or logged.

**Turning it on.** Set, server side only:

```bash
AI_API_KEY=...                          # unset = every AI feature is hidden
AI_BASE_URL=https://api.moonshot.ai/v1  # default
AI_MODEL=kimi-k3                        # default
```

Kimi's base URL and models are in Moonshot's docs: [Start using the Kimi API](https://platform.kimi.ai/docs/guide/start-using-kimi-api), [JSON mode](https://platform.kimi.ai/docs/guide/use-json-mode-feature-of-kimi-api), [chat completions reference](https://platform.kimi.ai/docs/api/chat). Requests use `response_format: { type: "json_object" }`; on Moonshot, Kimi K3 is asked for `reasoning_effort: "low"` and Kimi K2 models get thinking turned off, since every answer is a short JSON object.

**Switching providers.** The client speaks the OpenAI-compatible `/chat/completions` API, so any compatible provider works by changing `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY`; the Moonshot-only fields are sent only to Moonshot hosts.

**Mock mode.** With `NEXT_PUBLIC_USE_MOCK=true` and no key, a deterministic stand-in answers instead (a header heuristic for spreadsheets, fixed templates for wording and letters), labelled "Demo mode" in the UI, so every flow works and can be tested without a provider.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
