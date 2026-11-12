// MedAI Hospital service worker.
// Privacy: this app handles medical data, so ONLY same-origin static app files
// are cached. API calls, uploads, downloads and anything cross-origin are never
// touched or stored.
// Tapping a medicine reminder opens (or focuses) MedAI on the tracker.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification?.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin)) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : null;
    })
  );
});

const CACHE = "medai-shell-v6";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/branding/medai-logo.svg"];

/** Shown when the phone is offline and nothing was cached yet (first ever visit). */
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MedAI Hospital - offline</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f9fc;color:#0f172a;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
div{max-width:420px;text-align:center}h1{font-size:1.2rem;margin:0 0 8px}p{color:#475569;line-height:1.6;margin:0 0 16px;font-size:.95rem}
a{display:inline-block;min-height:48px;line-height:48px;padding:0 22px;border-radius:12px;background:#0b5ed6;color:#fff;
text-decoration:none;font-weight:700}</style></head><body><div>
<h1>You are offline</h1><p>MedAI needs a connection for the first load. Your saved screens open again as soon as you are back online.</p>
<a href="/">Try again</a></div></body></html>`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // API is on another origin: skip
  if (url.pathname.startsWith("/api")) return;           // never cache API
  if (req.headers.has("range")) return;                  // media/video

  // Page loads: network first, fall back to cached shell when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); }
        return res;
      }).catch(async () => {
        const hit = await caches.match("/");
        if (hit) return hit;
        return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      })
    );
    return;
  }

  // Static assets (hashed JS/CSS/images): cache first, fill on miss.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === "basic" && !/text\/html/i.test(res.headers.get("content-type") || "")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => Response.error());
    })
  );
});
