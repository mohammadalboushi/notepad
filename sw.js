const CACHE_NAME = 'vault-cache-v7';

const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './icon.png',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});