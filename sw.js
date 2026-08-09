// Service worker pro PWA – hra funguje offline a jde nainstalovat.
// Cesty jsou relativní ke scope (umístění tohoto souboru).
const CACHE = 'cube-runner-v1';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './css/styles.css',
    './js/scripts.js',
    './js/game.js',
    './js/level.js',
    './js/physics.js',
    './js/input.js',
    './js/entities/entity.js',
    './js/entities/player.js',
    './js/entities/saw.js',
    ...Array.from({length: 10}, (_, i) => `./js/levels/level${i + 1}.js`),
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;

    // Cache-first, s doplněním cache ze sítě; fallback na index.html
    e.respondWith(
        caches.match(req).then((cached) =>
            cached || fetch(req).then((res) => {
                if (res.ok && new URL(req.url).origin === self.location.origin) {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, copy));
                }
                return res;
            }).catch(() => caches.match('./index.html'))
        )
    );
});
