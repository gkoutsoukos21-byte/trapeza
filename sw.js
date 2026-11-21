// Service worker: κρατά τα αρχεία της εφαρμογής, φέρνει πάντα τη νεότερη έκδοση όταν υπάρχει internet.
const CACHE = 'trapeza-v5';
const SHELL = ['./', 'index.html', 'config.js', 'app.js', 'data.js', 'concepts.js', 'logo-k.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo-header-sm.png', 'logo-header.png', 'font.ttf', 'font-bold.ttf'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
