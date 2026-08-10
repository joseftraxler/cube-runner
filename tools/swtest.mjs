/**
 * Test service workeru: hlídá, že hra běží offline, ale zároveň se **nedrží
 * staré verze souborů**. Přesně kvůli tomu vznikl – cache-first service worker
 * způsoboval, že se upravený level po reloadu vůbec nenačetl.
 *
 * Test dočasně změní rychlost v `js/levels/level3.js` a zase ji vrátí zpátky.
 *
 * Vyžaduje Node.js a balíček `playwright` (`npm i -D playwright`).
 *
 * Použití:
 *     node tools/swtest.mjs
 */
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LEVEL = join(ROOT, 'js/levels/level3.js');
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml',
};

// Statický server. Ve výchozím stavu posílá `no-store`, aby se testovala cache
// service workeru a ne cache prohlížeče; druhé kolo testu si vyžádá `max-age`,
// kterým se ohání GitHub Pages.
function serve(cacheControl = 'no-store') {
    const server = createServer(async (req, res) => {
        let rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
        if (rel === '/') rel = '/index.html';
        try {
            const body = await readFile(join(ROOT, rel));
            res.writeHead(200, {
                'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream',
                'Cache-Control': cacheControl,
            });
            res.end(body);
        } catch {
            res.writeHead(404).end('404');
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Rychlost levelu 3 ze zdrojáku – test tak nezávisí na tom, co je zrovna v plánu.
// Level s tématem má místo čísla `{speed: 112, theme: 'desert'}`, bereme obojí.
function bumpSpeed(source) {
    const found = source.match(/^ {4}(?:\{speed: )?(\d+)/m);
    if (!found) throw new Error('v level3.js jsem nenašel rychlost');
    const bumped = Number(found[1]) + 1;
    return {bumped, source: source.replace(found[0], found[0].replace(found[1], String(bumped)))};
}

let failed = 0;
const check = (ok, message) => {
    console.log(`  ${ok ? '✓' : '✗'} ${message}`);
    if (!ok) failed++;
};

const {chromium} = createRequire(import.meta.url)('playwright');
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const context = await browser.newContext({viewport: {width: 1024, height: 600}});
const page = await context.newPage();
const original = await readFile(LEVEL, 'utf8');

try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.cubeRunner);
    await page.evaluate(() => navigator.serviceWorker.ready);
    check(true, 'hra se načetla a service worker je aktivní');

    // Úprava levelu se musí projevit hned po reloadu, ne až po zvýšení verze cache.
    const {bumped, source} = bumpSpeed(original);
    await writeFile(LEVEL, source);
    await page.reload();
    await page.waitForFunction(() => !!window.cubeRunner);
    const speed = await page.evaluate(() => window.cubeRunner.levels[2].speed);
    check(speed === bumped, `upravený level3 se načetl aktuální (rychlost ${speed}, čekáno ${bumped})`);
    await writeFile(LEVEL, original);

    // Offline musí hra pořád fungovat z cache
    await page.reload();
    await page.waitForFunction(() => !!window.cubeRunner);
    await context.setOffline(true);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.reload();
    let levels = 0;
    try {
        await page.waitForFunction(() => !!window.cubeRunner, null, {timeout: 10000});
        levels = await page.evaluate(() => window.cubeRunner.levels.length);
    } catch { /* níž se to projeví jako chyba */ }
    check(levels === 10 && errors.length === 0,
        `offline reload načetl všech 10 levelů${errors.length ? ' – chyby: ' + errors.join('; ') : ''}`);

    // Na stejné doméně můžou běžet i jiné appky – jejich cache nám nepatří
    await context.setOffline(false);
    const keys = await page.evaluate(async () => {
        await caches.open('jina-appka-v1').then(c => c.put('/x.txt', new Response('x')));
        const reg = await navigator.serviceWorker.getRegistration();
        await reg.update();
        await new Promise(r => setTimeout(r, 800));
        return caches.keys();
    });
    check(keys.includes('jina-appka-v1'), `cizí cache zůstala nedotčená (${keys.join(', ')})`);

    /*
     * Totéž ještě jednou proti serveru, který se chová jako GitHub Pages:
     * statické soubory s `Cache-Control: max-age=600`. „Network-first“ musí
     * platit doslova – kdyby service worker nechal `fetch` sáhnout do cache
     * prohlížeče, čerstvě nasazená verze by se na telefonu objevila až za deset
     * minut. Vlastní kontext = čistý profil, aby se nemíchal s prvním kolem.
     */
    const pagesServer = await serve('max-age=600');
    const pagesContext = await browser.newContext({viewport: {width: 1024, height: 600}});
    const pagesPage = await pagesContext.newPage();
    try {
        await pagesPage.goto(`http://127.0.0.1:${pagesServer.address().port}/`);
        // Až když stránku řídí service worker, jdou další požadavky přes něj
        await pagesPage.waitForFunction(() => navigator.serviceWorker.controller !== null,
            null, {timeout: 15000});

        await writeFile(LEVEL, source);     // „nasazení“ během platnosti max-age
        await pagesPage.reload();
        await pagesPage.waitForFunction(() => !!window.cubeRunner);
        const cached = await pagesPage.evaluate(() => window.cubeRunner.levels[2].speed);
        check(cached === bumped,
            `nasazená verze se načte hned i při max-age (rychlost ${cached}, čekáno ${bumped})`);
    } finally {
        await writeFile(LEVEL, original);
        await pagesContext.close();
        pagesServer.close();
    }
} finally {
    await writeFile(LEVEL, original);
    await browser.close();
    server.close();
}

if (failed) {
    console.log(`\nNeprošlo ${failed} kontrol.`);
    process.exit(1);
}
console.log('\nService worker je v pořádku.');
