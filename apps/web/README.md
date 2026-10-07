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
