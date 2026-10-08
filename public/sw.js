/* Only the public app shell is cached. Private trip snapshots are session-scoped by the client. */
const SHELL_CACHE = "nossa-viagem-shell-88af1ccf5016830421b6";
const SHELL_FILES = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-192.png", "/icons/maskable-512.png", "/logo.png"];

function isStaticAsset(url) {
  return url.origin === self.location.origin && !url.search && (
    url.pathname.startsWith("/_next/static/") ||
    SHELL_FILES.slice(1).includes(url.pathname)
  );
}

async function storeShell(cache, response) {
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return;
  // '/' is a public client shell and contains no authorized trip records.
  await cache.put("/", response.clone());
  const html = await response.clone().text();
  const assets = [...new Set(html.match(/\/_next\/static\/[A-Za-z0-9_./%~-]+\.(?:js|css|woff2?)/g) || [])];
  await Promise.all(assets.map(async (asset) => {
    try {
      const result = await fetch(asset, { credentials: "omit" });
      if (result.ok) await cache.put(asset, result);
    } catch { /* A failed optional asset will be retried when requested online. */ }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // This clean URL cannot contain an invitation, session or user-specific query.
    const shell = await fetch("/", { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!shell.ok) throw new Error("The public app shell could not be loaded.");
    await storeShell(cache, shell);
    await Promise.all(SHELL_FILES.slice(1).map(async (path) => {
      try {
        const response = await fetch(path, { credentials: "omit" });
        if (response.ok) await cache.put(path, response);
      } catch { /* The core offline shell is still usable. */ }
    }));
    // An updated worker remains waiting until the user chooses to reload safely.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("nossa-viagem-shell-") && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Never intercept auth, API, Google, requests with credentials, queries or non-GET writes.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || request.headers.has("authorization") || request.headers.has("cookie")) return;
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch("/", { credentials: "omit", cache: "no-store", redirect: "error" });
        if (response.ok) {
          // Use waitUntil so the current response is not blocked by caching static chunks.
          event.waitUntil(storeShell(cache, response.clone()));
          return response;
        }
        throw new Error("Offline shell requested.");
      } catch {
        return (await cache.match("/")) || new Response("Conecte-se à internet e abra Nossa Viagem uma vez para preparar a consulta offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }
  if (!isStaticAsset(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const stored = await cache.match(request);
    if (stored) return stored;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  })());
});
