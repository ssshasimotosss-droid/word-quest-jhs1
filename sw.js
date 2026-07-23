const CACHE_VERSION = "word-quest-v4";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SCOPE = new URL("./", self.location.href);
const appUrl = (path = "") => new URL(String(path).replace(/^\//u, ""), APP_SCOPE).href;
const CORE_ASSETS = [
  "",
  "index.html",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "assets/quest-world.jpg",
  "data/content.json",
].map(appUrl);

async function cacheCoreAssets() {
  const cache = await caches.open(STATIC_CACHE);
  const cacheOne = async (url) => {
    const response = await fetch(new Request(url, { cache: "reload" }));
    if (response.ok) await cache.put(url, response.clone());
    return response;
  };
  await Promise.allSettled(
    CORE_ASSETS.map((url) => cacheOne(url)),
  );

  // Vite assigns hashed names to built JavaScript and CSS. Discover those
  // names from index.html so a freshly installed app is immediately offline-ready.
  const indexResponse = await cache.match(appUrl("index.html"));
  if (!indexResponse) return;
  const html = await indexResponse.text();
  const discoveredAssets = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => `${url.pathname}${url.search}`);
  await Promise.allSettled([...new Set(discoveredAssets)].map((url) => cacheOne(url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheCoreAssets());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("word-quest-") &&
                ![STATIC_CACHE, RUNTIME_CACHE].includes(key),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function canCache(response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  return !/no-store/i.test(response.headers.get("Cache-Control") || "");
}

async function trimRuntimeCache(maxEntries = 100) {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (canCache(response)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(appUrl("index.html"), response.clone());
    }
    return response;
  } catch {
    const cached =
      (await caches.match(appUrl("index.html"))) ||
      (await caches.match(appUrl()));
    if (cached) return cached;
    return new Response(
      "<!doctype html><html lang=\"ja\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>WORD QUEST</title><body style=\"font-family:sans-serif;background:#071a35;color:white;padding:2rem\"><h1>WORD QUEST</h1><p>オフラインです。通信が戻ってから、もう一度開いてください。</p></body></html>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (canCache(response)) {
        await cache.put(request, response.clone());
        await trimRuntimeCache();
      }
      return response;
    })
    .catch(() => null);
  return cached || (await network) || new Response("Offline", { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/.netlify/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) await client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    }),
  );
});
