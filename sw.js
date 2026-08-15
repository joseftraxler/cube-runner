// Service worker pro PWA – hra funguje offline a jde nainstalovat.
// Cesty jsou relativní ke scope (umístění tohoto souboru).
const PREFIX = 'cube-runner-';
const CACHE = PREFIX + 'v9';

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
    './js/haptics.js',
    './js/physics.js',
    './js/input.js',
    './js/draw.js',
    './js/theme.js',
    './js/themes/registry.js',
    './js/themes/default.js',
    './js/themes/ice.js',
    './js/themes/fire.js',
    './js/themes/desert.js',
    './js/themes/math.js',
    './js/themes/jungle.js',
    './js/entities/entity.js',
    './js/entities/player.js',
    './js/entities/saw.js',
    './js/entities/orbiter.js',
    ...Array.from({length: 20}, (_, i) => `./js/levels/level${i + 1}.js`),
];

/**
 * Stažení mimo cache prohlížeče. Samotné `fetch(req)` totiž smí sáhnout do
 * HTTP cache, a GitHub Pages posílá u statických souborů `max-age=600` – čerstvě
 * nasazená verze by se tak na telefonu objevila klidně až za deset minut,
 * přestože je service worker network-first. `no-cache` si u serveru pokaždé
 * ověří ETag; když se soubor nezměnil, odbaví se to odpovědí 304, takže to
 * nestojí skoro nic.
 */
function fresh(url) {
    return fetch(new Request(url, {cache: 'no-cache', credentials: 'same-origin'}));
}

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE)
            // I přednačtení musí jít na síť, jinak se do cache uloží to staré.
            // Chybějící soubor instalaci shodí (jako dřív `addAll`) – půlka
            // aplikace v cache je horší než žádná, offline by se rozsypala.
            .then((c) => Promise.all(ASSETS.map((url) => fresh(url).then((res) => {
                if (!res.ok) throw new Error(`${url} → ${res.status}`);
                return c.put(url, res);
            }))))
            .then(() => self.skipWaiting())
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
     *
     * „Ze sítě“ musí platit doslova, proto `fresh()` obchází cache prohlížeče –
     * jinak by se nová verze na mobilu objevila až po vypršení `max-age`.
     */
    e.respondWith(
        fresh(req.url)
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
