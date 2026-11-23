/*
 * Service worker офлайна (критерий приёмки SPEC §7.6: «офлайн после первой
 * загрузки»). Регистрируется только в prod (main.ts, import.meta.env.PROD).
 *
 *  - install: precache оболочки «/» (index.html);
 *  - статика same-origin GET (бандл, стили, иконки — имена хэшированы):
 *    cache-first — после первого захода живут в кэше;
 *  - навигации: network-first с фолбэком на кэш «/» — новый деплой
 *    подхватывается, офлайн открывает последнюю оболочку;
 *  - cross-origin (CDN сэмплов smplr) НЕ перехватывается — сэмплы держит
 *    HTTP-кэш браузера после первой загрузки.
 */
const CACHE_NAME = "piano-static-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add("/"))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // сэмплы CDN — мимо

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      // Свежая оболочка кэшируется и по своему URL, и как фолбэк «/».
      await cache.put("/", response.clone());
    }
    return response;
  } catch {
    return (await caches.match("/")) ?? new Response("Offline", { status: 504, statusText: "Offline" });
  }
}
