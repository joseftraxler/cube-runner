/**
 * Měření výkonu kreslení: kolik stojí jeden snímek v každém tématu.
 *
 * Hra se v Chromiu postaví na pět míst každého měřeného levelu a změří se
 * `Game.render()`. Na konci každé série se z plátna přečte pixel – tím se
 * počká na dokreslení, jinak by se měřilo jen zadávání příkazů a rasterizace
 * (ta je na slabých zařízeních to hlavní) by se do čísel nedostala.
 *
 * Kreslí se do dvou rozlišení: telefon na výšku a okno na desktopu. Čísla jsou
 * relativní – záleží na tom, jestli se téma proti ostatním (a proti minulému
 * měření) nezhoršilo, ne na jejich absolutní výši.
 *
 * Vyžaduje Node.js a balíček `playwright` (`npm i -D playwright`), proto to
 * není součást hry samotné, ale nástroj pro vývoj.
 *
 * Použití:
 *     node tools/perftest.mjs
 *     node tools/perftest.mjs --calls    # i počty kreslicích volání na snímek
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

// Level, na kterém se měří dané téma (stačí jeden za každé)
const THEME_LEVEL = {'bez tématu': 1, 'ice': 5, 'desert': 3, 'fire': 8, 'math': 11};

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

// Postaví hru na dané místo levelu – kreslení závisí jen na poloze kamery
function place(game, levelIndex, frac) {
    if (game.levelIndex !== levelIndex) {
        game.levelIndex = levelIndex;
        game.loadLevel();
    }
    game.state = 'playing';
    const view = game.viewTiles();
    game.camX = Math.max(0, game.level.width - view) * frac;
    game.player.x = game.camX + view * 0.3;
    game.player.y = game.level.height - 2.5;
    game.progress = frac;
}

function measureInPage([levelIndex, frames, spots]) {
    const game = window.cubeRunner;
    const times = [];

    for (const frac of spots) {
        window.__place(game, levelIndex, frac);
        for (let i = 0; i < 8; i++) game.render();        // zahřátí
        game.ctx.getImageData(0, 0, 1, 1);

        const start = performance.now();
        for (let i = 0; i < frames; i++) {
            game.clock += 1 / 60;
            game.render();
        }
        game.ctx.getImageData(0, 0, 1, 1);                // počkat na dokreslení
        times.push((performance.now() - start) / frames);
    }

    const sum = times.reduce((a, b) => a + b, 0);
    return {theme: game.level.theme ?? 'bez tématu',
            avg: +(sum / times.length).toFixed(2),
            max: +Math.max(...times).toFixed(2)};
}

// Spočítá, kolikrát za snímek hra sáhne na kreslicí příkaz plátna. Na skutečné
// grafice váží počet volání víc než počet přemalovaných pixelů, takže je to
// druhý pohled na tutéž věc.
function countInPage([levelIndex, spots]) {
    const proto = CanvasRenderingContext2D.prototype;
    const originals = {};
    let calls = 0;

    for (const name of Object.getOwnPropertyNames(proto)) {
        const desc = Object.getOwnPropertyDescriptor(proto, name);
        if (typeof desc?.value !== 'function' || name === 'constructor') continue;
        originals[name] = desc.value;
        proto[name] = function (...args) {
            calls++;
            return originals[name].apply(this, args);
        };
    }

    const game = window.cubeRunner;
    for (const frac of spots) {
        window.__place(game, levelIndex, frac);
        game.render();
    }

    for (const [name, fn] of Object.entries(originals)) proto[name] = fn;
    return Math.round(calls / spots.length);
}

const {chromium} = createRequire(import.meta.url)('playwright');
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const withCalls = process.argv.includes('--calls');
const SPOTS = [0.1, 0.3, 0.5, 0.7, 0.9];

for (const [label, viewport] of [['telefon 390×844', {width: 390, height: 844}],
                                 ['okno 1280×720', {width: 1280, height: 720}]]) {
    const page = await browser.newPage({viewport});
    await page.goto(url);
    await page.waitForFunction(() => !!window.cubeRunner);
    // Vlastní smyčka hry by do měření mluvila – uspíme ji
    await page.evaluate(() => { window.cubeRunner.state = 'paused'; });
    await page.evaluate(`window.__place = ${place}`);

    console.log(`\n${label}`);
    for (const [theme, level] of Object.entries(THEME_LEVEL)) {
        const r = await page.evaluate(measureInPage, [level - 1, 120, SPOTS]);
        const calls = withCalls ? await page.evaluate(countInPage, [level - 1, SPOTS]) : null;
        console.log(`  ${theme.padEnd(11)} level ${String(level).padStart(2)}  ` +
            `snímek ${String(r.avg).padStart(6)} ms   nejhorší místo ${String(r.max).padStart(6)} ms` +
            (calls === null ? '' : `   ${String(calls).padStart(5)} volání`));
    }
    await page.close();
}

await browser.close();
server.close();
