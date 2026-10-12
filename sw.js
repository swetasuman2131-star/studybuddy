/* StudyBuddy service worker — offline app shell */
const CACHE = "studybuddy-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache API calls.
  if (url.hostname.indexOf("api.sarvam.ai") !== -1 || url.hostname.indexOf("api.openai.com") !== -1) return;

  // Cross-origin (CDN reader libraries): network, fall back to cache if present.
  if (url.origin !== location.origin) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Same-origin: cache-first, then network, updating the cache.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        fetch(req).then((res) => { if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); }).catch(() => {});
        return hit;
      }
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === "basic") caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match("index.html"));
    })
  );
});
