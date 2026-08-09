/**
 * Test zvuku: měří, jestli z hry opravdu leze signál.
 *
 * Zvuk se nedá „přečíst“ jako obrázek, proto se na výstup hry pověsí
 * analyzátor a měří se špička signálu – při hře musí být slyšet, po ztlumení
 * (klávesa M) musí být ticho a v pauze nesmí běžet sekvencer hudby.
 *
 * Vyžaduje Node.js a balíček `playwright` (`npm i -D playwright`).
 *
 * Použití:
 *     node tools/audiotest.mjs
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml',
};

function serve() {
    const server = createServer(async (req, res) => {
        let rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
        if (rel === '/') rel = '/index.html';
        try {
            const body = await readFile(join(ROOT, rel));
            res.writeHead(200, {'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream'});
            res.end(body);
        } catch {
            res.writeHead(404).end('404');
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Změří nejhlasitější vzorek na výstupu hry za `ms` milisekund
function measureInPage(ms) {
    const sound = window.cubeRunner.sound;
    if (!sound.ctx) return Promise.resolve(-1);

    const analyser = sound.ctx.createAnalyser();
    analyser.fftSize = 2048;
    sound.master.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    const start = performance.now();
    let peak = 0;

    return new Promise(resolve => {
        const tick = () => {
            analyser.getFloatTimeDomainData(samples);
            for (const v of samples) peak = Math.max(peak, Math.abs(v));
            if (performance.now() - start < ms) setTimeout(tick, 25);
            else {
                sound.master.disconnect(analyser);
                resolve(+peak.toFixed(4));
            }
        };
        tick();
    });
}

let failed = 0;
const check = (ok, message) => {
    console.log(`  ${ok ? '✓' : '✗'} ${message}`);
    if (!ok) failed++;
};

const {chromium} = createRequire(import.meta.url)('playwright');
const server = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1024, height: 600}});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));

try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!window.cubeRunner);

    // Před interakcí nesmí AudioContext vůbec vzniknout (autoplay policy)
    check(await page.evaluate(() => window.cubeRunner.sound.ctx === null),
        'před stiskem klávesy se AudioContext nevytváří');

    // Stiskem se hra rozjede a zvuk naběhne
    await page.evaluate(() => { window.cubeRunner.sound.muted = false; });
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => window.cubeRunner.sound.ctx.state);
    check(state === 'running', `po stisku klávesy AudioContext běží (stav "${state}")`);

    const playing = await page.evaluate(measureInPage, 1600);
    check(playing > 0.01, `při hře je slyšet hudba (špička ${playing})`);

    const stepped = await page.evaluate(() => window.cubeRunner.sound.step > 0);
    check(stepped, 'sekvencer hudby postoupil');

    // Pauza hudbu zastaví
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => window.cubeRunner.sound.step);
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => window.cubeRunner.sound.step);
    check(before === after, `v pauze se sekvencer nehýbe (krok ${before})`);

    // Ztlumení musí umlčet i efekty
    await page.keyboard.press('KeyP');           // zpět do hry
    await page.keyboard.press('KeyM');           // ztlumit
    const muted = await page.evaluate(measureInPage, 1200);
    check(muted === 0, `po ztlumení je ticho (špička ${muted})`);

    check(errors.length === 0, `bez chyb v konzoli${errors.length ? ': ' + errors.join('; ') : ''}`);
} finally {
    await browser.close();
    server.close();
}

if (failed) {
    console.log(`\nNeprošlo ${failed} kontrol.`);
    process.exit(1);
}
console.log('\nZvuk je v pořádku.');
