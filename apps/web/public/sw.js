const CACHE_VERSION = "veylta-shell-v1";
const SAFE_SHELL = ["/offline.html", "/icons/veylta-192.png", "/icons/veylta-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SAFE_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Never intercept API bytes or a document page (/<handle>/docs/<id>): a reader on a
  // document must see the network's truth, never anything a worker chose to serve.
  if (url.pathname.startsWith("/health-api/") || url.pathname.includes("/docs/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match("/offline.html");
        return offline ?? Response.error();
      }),
    );
  }
});
