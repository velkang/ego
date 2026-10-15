const CACHE = "__BUILD_CACHE__";
const BUILD_ASSETS = __BUILD_ASSETS__;
const SHELL = [
  ...BUILD_ASSETS,
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
  "/coin/front.png",
  "/coin/tilt.png",
  "/tokens/usdc.svg",
  "/tokens/eurc.svg",
];
const validAsset = (response, path) => {
  if (!response?.ok) return false;
  const type = response.headers.get("content-type") || "";
  if (path.endsWith(".js")) return /(?:java|ecma)script/i.test(type);
  if (path.endsWith(".css")) return /^text\/css\b/i.test(type);
  return !/text\/html/i.test(type);
};
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map(async (path) => {
          const response = await fetch(path, { cache: "reload" });
          const html = path === "/" ? await response.clone().text() : "";
          const valid = path === "/"
            ? response.ok &&
              /text\/html/i.test(response.headers.get("content-type") || "") &&
              BUILD_ASSETS.filter((asset) => /\/index-[^/]+\.js$/.test(asset))
                .every((asset) => html.includes(asset))
            : validAsset(response, path);
          if (!valid) throw new Error(`Invalid app asset: ${path}`);
          await cache.put(path, response);
        }),
      ),
    ).then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          // Retain the preceding build for already-open tabs and their lazy chunks.
          keys
            .filter((key) => key.startsWith("ego-shell-") && key !== CACHE)
            .slice(0, -1)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/v1/") ||
    url.pathname === "/health"
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        // A fully installed update serves its matching shell on the next navigation.
        return (
          (await cache.match("/")) ||
          fetch(event.request, { cache: "no-cache" })
        );
      })(),
    );
    return;
  }
  if (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const saved = await cache.match(event.request) ||
          (url.pathname.startsWith("/assets/") ? await caches.match(event.request) : undefined);
        if (saved && validAsset(saved, url.pathname)) return saved;
        if (saved) await cache.delete(event.request);
        const response = await fetch(event.request);
        // Cloudflare SPA fallback may return index.html with status 200 for a
        // missing asset. Never cache or serve that as JavaScript/CSS.
        if (!validAsset(response, url.pathname)) return Response.error();
        await cache.put(event.request, response.clone());
        return response;
      })(),
    );
  }
});
