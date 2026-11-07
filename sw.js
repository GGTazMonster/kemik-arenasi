// =====================================================
//  Service worker: oyunu telefonda "uygulama" gibi ve İNTERNETSİZ çalıştırır.
//  - Kod (html/js/css): önce ağ, yoksa önbellek → güncellemeler hemen gelir
//  - Modeller, dokular, Three.js (CDN), fontlar: önce önbellek → hızlı ve internetsiz
//  Yeni sürüm yayınlayınca VERSION'ı artır.
// =====================================================
const VERSION = 'kemik-20261107-221433';
// Modeller/görseller/Three.js ayrı ve KALICI önbellekte: güncellemede yeniden inmez (20 MB). Bir görseli değiştirirsen adını da değiştir.
const ASSETS = 'kemik-assets-v1';
const CORE = ['./', './index.html', './style.css', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== ASSETS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isCode = url => /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = /cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.host);
  if (!sameOrigin && !cdn) return;

  if (sameOrigin && isCode(url)) {
    // Önce ağ (güncel kod), çevrimdışıysa önbellek
    // cache:'no-cache' → tarayıcının HTTP önbelleğini atla (GitHub Pages 10 dk önbellekliyor), güncellemeler hemen gelsin
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
    return;
  }
  // Önce önbellek (modeller, Three.js, fontlar)
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(ASSETS).then(c => c.put(req, copy)); }
    return res;
  })));
});
