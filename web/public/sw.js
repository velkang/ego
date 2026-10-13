const CACHE = 'jovva-shell-v1';
const SHELL = ['/', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/v1/') || url.pathname === '/health') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/'))); return;
  }
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) event.respondWith(caches.open(CACHE).then(async cache => {
    const saved = await cache.match(event.request); if (saved) return saved;
    const response = await fetch(event.request); if (response.ok) await cache.put(event.request, response.clone()); return response;
  }));
});
