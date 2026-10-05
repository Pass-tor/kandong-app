const CACHE = 'kandong-v1.2.1';

const CORE = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/config.js',
  './js/supabase-client.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never cache Supabase API or third-party CDNs for dynamic data
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('jsdelivr.net')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => cached || caches.match('./offline.html'));

      return cached || network;
    })
  );
});
