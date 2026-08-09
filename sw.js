// Service worker pro PWA – hra funguje offline a jde nainstalovat.
// Cesty jsou relativní ke scope (umístění tohoto souboru).
const PREFIX = 'cube-runner-';
const CACHE = PREFIX + 'v3';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './css/styles.css',
    './js/scripts.js',
    './js/game.js',
    './js/level.js',
    './js/audio.js',
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
            // Mazat smíme jen svoje cache – na stejné doméně (např. GitHub Pages)
            // můžou běžet i jiné appky a jejich cache nám nepatří
            .then((keys) => Promise.all(
                keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    /*
     * Network-first: online se vždycky vezme aktuální soubor a jen se uloží
     * stranou, offline se sáhne do cache. Kdyby to bylo naopak (cache-first),
     * upravený level by se po reloadu vůbec nenačetl – hrála by se stará verze
     * z cache, dokud se nezvýší číslo `CACHE`.
     */
    e.respondWith(
        fetch(req)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.open(CACHE).then((c) => c.match(req).then((cached) =>
                // Na chybějící modul se nesmí vrátit HTML – rozbilo by to import
                cached ?? (req.mode === 'navigate' ? c.match('./index.html') : Response.error())
            )))
    );
});
