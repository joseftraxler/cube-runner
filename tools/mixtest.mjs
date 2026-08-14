/**
 * Porovnání hlasitosti hudby mezi tématy.
 *
 * `audiotest.mjs` hlídá, že zvuk vůbec hraje; tenhle nástroj měří, jak nahlas.
 * Na výstup hry se pověsí analyzátor a v každém tématu se změří špička a RMS
 * (efektivní hodnota – té odpovídá vnímaná hlasitost líp než špička).
 * Motivy se skládají z různých nástrojů, takže se hlasitosti samy od sebe
 * rozejdou a jedno prostředí pak působí potichu; čísla ukážou o kolik.
 *
 * Měří se v nejvyšším stupni instrumentace (`setIntensity`), protože tam hraje
 * všechno naráz. Hra se přitom nekrokuje – měřila by se náhodná smrt kostky.
 *
 * Vyžaduje Node.js a balíček `playwright` (`npm i -D playwright`).
 *
 * Použití:
 *     node tools/mixtest.mjs
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

// Level, na kterém se dané téma měří (stejná tabulka jako v perftest.mjs)
const THEME_LEVEL = {'bez tématu': 1, 'ice': 2, 'desert': 3, 'fire': 4, 'math': 5,
                     'jungle': 6};

// Jak dlouho se každé téma poslouchá (ms). Dvě smyčky bicích i s akordy.
const LISTEN_MS = 7000;

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

/**
 * Přepne hru na daný level a změří hlasitost jeho hudby.
 *
 * Hra se zmrazí (`update` se vyprázdní), ale zůstane ve stavu `playing`, takže
 * herní smyčka drží hudbu zapnutou; postup se nastaví natvrdo, aby hrál nejvyšší
 * stupeň instrumentace.
 */
function measureInPage([levelIndex, ms]) {
    const game = window.cubeRunner;
    game.update = () => {};
    game.levelIndex = levelIndex;
    game.loadLevel();
    game.state = 'playing';
    game.progress = 0.9;

    const sound = game.sound;
    const analyser = sound.ctx.createAnalyser();
    analyser.fftSize = 2048;
    sound.master.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    const start = performance.now();
    let peak = 0;
    let sum = 0;
    let count = 0;

    return new Promise(resolve => {
        const tick = () => {
            analyser.getFloatTimeDomainData(samples);
            for (const v of samples) {
                peak = Math.max(peak, Math.abs(v));
                sum += v * v;
                count++;
            }
            if (performance.now() - start < ms) {
                setTimeout(tick, 25);
            } else {
                sound.master.disconnect(analyser);
                resolve({peak, rms: Math.sqrt(sum / count), theme: game.level.theme ?? 'bez tématu'});
            }
        };
        tick();
    });
}

const server = await serve();
const {chromium} = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => !!window.cubeRunner);
// AudioContext smí naběhnout až po interakci uživatele
await page.keyboard.press('Space');
await page.waitForFunction(() => window.cubeRunner.sound.ctx?.state === 'running');

const results = [];
for (const [theme, level] of Object.entries(THEME_LEVEL)) {
    results.push({theme, level, ...await page.evaluate(measureInPage, [level - 1, LISTEN_MS])});
}

await browser.close();
server.close();

// Odchylku počítáme proti průměru všech témat – zajímá nás, které vybočuje
const mean = results.reduce((a, r) => a + r.rms, 0) / results.length;
const dB = v => (20 * Math.log10(v / mean)).toFixed(1).padStart(5);

for (const r of results) {
    console.log(`  ${r.theme.padEnd(11)} level ${String(r.level).padStart(2)}  ` +
        `RMS ${r.rms.toFixed(4)}  špička ${r.peak.toFixed(3)}  ${dB(r.rms)} dB proti průměru`);
}

// Rozdíl do 3 dB je v mixu ještě únosný, víc už je slyšet jako „tenhle svět je potichu“
const spread = 20 * Math.log10(Math.max(...results.map(r => r.rms))
    / Math.min(...results.map(r => r.rms)));
console.log(`\nRozptyl mezi nejhlasitějším a nejtišším tématem: ${spread.toFixed(1)} dB`);
if (spread > 6) {
    console.log('To je moc – nejtišší téma bude působit jako chyba, dorovnej mu hlasitost.');
    process.exit(1);
}
