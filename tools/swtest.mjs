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

// Statický server. Posílá `no-store`, aby se testovala cache service workeru
// a ne cache prohlížeče.
function serve() {
    const server = createServer(async (req, res) => {
        let rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
        if (rel === '/') rel = '/index.html';
        try {
            const body = await readFile(join(ROOT, rel));
            res.writeHead(200, {
                'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream',
                'Cache-Control': 'no-store',
            });
            res.end(body);
        } catch {
            res.writeHead(404).end('404');
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
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
    // Rychlost si přečteme ze souboru, ať test nezávisí na tom, co je v plánu.
    // Level s tématem má místo čísla `{speed: 112, theme: 'desert'}` – bereme obojí
    const before = original.match(/^ {4}(?:\{speed: )?(\d+)/m);
    if (!before) throw new Error('v level3.js jsem nenašel rychlost');
    const bumped = Number(before[1]) + 1;
    await writeFile(LEVEL, original.replace(before[0], before[0].replace(before[1], String(bumped))));
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
