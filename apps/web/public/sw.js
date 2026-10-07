// Fanout service worker: shows "You've been paid" notifications and opens the app when one is tapped.
// The payload is built by lib/push/payload.ts: { title, body, url, tag }. It never holds a claim link.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: fall back to the defaults below.
  }
  const title = typeof data.title === "string" ? data.title : "You've been paid";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "Tap to see your balance.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: typeof data.tag === "string" ? data.tag : "fanout-paid",
      renotify: true,
      data: { url: typeof data.url === "string" ? data.url : "/balance" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever open a page on this site.
  const target = new URL(event.notification.data?.url || "/balance", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : new URL("/balance", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        try {
          await open.focus();
          // navigate() only works on pages this worker controls; otherwise open a fresh window.
          if (await open.navigate(url)) return;
        } catch {
          // fall through
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
