// Prints a fresh VAPID key pair for "You've been paid" notifications (lib/push/config.ts).
// Nothing is written to disk: copy the lines into your environment (Vercel project settings, or
// .env.local for local development). Keep the private key secret, and keep the same pair once
// payees have subscribed: a new pair means every device has to turn notifications on again.
//
// Usage: pnpm --filter web vapid-keys

import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@yourdomain.com");
