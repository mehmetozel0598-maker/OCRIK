/*
 * Tarama → Metin — service worker
 * Önbellek adları bu uygulamaya özgü önekle başlar; aynı alan adındaki
 * (ör. kullanici.github.io) diğer uygulamaların önbelleklerine dokunulmaz.
 */
const PREFIX = 'tarama-metin-ocr-kopru-';
const VERSION = 'v1';
const SHELL = PREFIX + 'kabuk-' + VERSION;
const LIBS = PREFIX + 'kutuphane-' + VERSION;

const SHELL_FILES = [
  './', './index.html', './app.js', './core.js', './toc.js', './manifest.webmanifest',
  './fonts/DejaVuSans.ttf', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith(PREFIX) && k !== SHELL && k !== LIBS) // yalnız kendi eski önbelleklerimiz
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // CDN kütüphaneleri ve OCR dil verisi: önce önbellek (sürüm sabit olduğu için güvenli)
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(LIBS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Uygulama dosyaları (yalnızca bu uygulamanın kapsamı): önce ağ, olmazsa önbellek
  if (url.origin === location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.open(SHELL).then(c => c.match(req, { ignoreSearch: true }).then(r => r || c.match('./index.html'))))
    );
  }
});
