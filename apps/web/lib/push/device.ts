/**
 * Can this browser get "You've been paid" notifications, and if not, what would fix it?
 * iPhone and iPad only deliver web push to an app added to the Home Screen (iOS 16.4+), so there
 * the answer is often "install first".
 */
export type PushSupport = "ready" | "ios-install" | "unsupported";

export type DeviceInfo = {
  userAgent: string;
  maxTouchPoints: number;
  /** Running as the installed app (display-mode: standalone, or iOS navigator.standalone). */
  standalone: boolean;
  /** serviceWorker, PushManager and Notification all exist. */
  hasPushApis: boolean;
};

export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (userAgent.includes("Macintosh") && maxTouchPoints > 1);
}

export function pushSupport(d: DeviceInfo): PushSupport {
  if (isIos(d.userAgent, d.maxTouchPoints)) {
    // In Safari (not installed) iOS hides the push APIs entirely; installed on 16.4+ they appear.
    if (!d.standalone) return "ios-install";
    return d.hasPushApis ? "ready" : "unsupported";
  }
  return d.hasPushApis ? "ready" : "unsupported";
}

/** The VAPID public key (base64url) as the bytes PushManager.subscribe wants. */
export function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
