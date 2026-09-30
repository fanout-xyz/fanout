import posthog, { type CaptureResult } from "posthog-js";
import { scrubClaimKeys } from "@/lib/analytics/scrub";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

const onClaimPage = () => window.location.pathname.startsWith("/claim");

function beforeSend(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  // Replays of the claim page would record its URL, fragment included; skip them entirely.
  if (event.event === "$snapshot" && onClaimPage()) return null;
  return scrubClaimKeys(event);
}

if (projectToken && host) {
  posthog.init(projectToken, {
    api_host: host,
    defaults: "2026-01-30",
    capture_exceptions: true,
    before_send: beforeSend,
    // Claim links usually open in a fresh tab, so this keeps the recorder off for payees.
    disable_session_recording: onClaimPage(),
    session_recording: { maskAllInputs: true },
    debug: process.env.NODE_ENV === "development",
  });
} else if (process.env.NODE_ENV !== "production") {
  console.warn("PostHog is off: set NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN and NEXT_PUBLIC_POSTHOG_HOST in .env.local.");
}
