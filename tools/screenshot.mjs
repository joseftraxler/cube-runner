/**
 * Vyrobí náhled hry do README – opravdový snímek obrazovky z Chromia.
 *
 * Hra se spustí, přetočí se na zadané místo v levelu (odehráním skoků z
 * `tools/gen_levels.py`) a v tu chvíli se plátno vyfotí.
 *
 * Vyžaduje Node.js a balíček `playwright` (`npm i -D playwright`).
 *
 * Použití:
 *     node tools/screenshot.mjs                          # docs/preview.png
 *     node tools/screenshot.mjs --level 9 --x 38 --out docs/gravitace.png
 */
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml',
};

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name);
    return i === -1 ? fallback : process.argv[i + 1];
}

function serve() {
    const server = createServer(async (req, res) => {
        const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
        const path = join(ROOT, rel === '/' ? 'index.html' : rel);
        try {
            const body = await readFile(path);
            res.writeHead(200, {'Content-Type': MIME[extname(path)] ?? 'application/octet-stream'});
            res.end(body);
        } catch {
            res.writeHead(404).end('404');
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Odehraje level do zadané x-souřadnice a pak hru zmrazí, ať jde vyfotit
function seekInPage([levelIndex, jumps, dt, stopX]) {
    const game = window.cubeRunner;
    game.levelIndex = levelIndex;
    game.attempts = 1;
    game.loadLevel();
    game.state = 'playing';

    let next = 0;
    for (let frame = 0; frame < 100000 && game.player.x < stopX; frame++) {
        if (next < jumps.length && frame === jumps[next]) {
            game.handleAction('jump');
            game.handleRelease('jump');
            next++;
        }
        game.update(dt);
        if (game.state !== 'playing') break;
    }

    const x = game.player.x;
    game.update = () => {};   // zmrazíme obraz, ať smyčka jen překresluje
    return {x: +x.toFixed(2), state: game.state};
}

const level = Number(arg('level', 5));
const stopX = Number(arg('x', 52));
const out = resolve(ROOT, arg('out', 'docs/preview.png'));

const paths = JSON.parse(execFileSync('python3', [join(ROOT, 'tools/gen_levels.py'), '--paths', '-'],
    {encoding: 'utf8', maxBuffer: 1 << 24}));
const plan = paths.find(p => p.level === level);
if (!plan) throw new Error(`level ${level} neexistuje`);

const {chromium} = createRequire(import.meta.url)('playwright');
const server = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 640}, deviceScaleFactor: 1.5});

await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => !!window.cubeRunner);
const info = await page.evaluate(seekInPage, [level - 1, plan.jumps, plan.dt, stopX]);
await page.waitForTimeout(120);
await page.screenshot({path: out});

await browser.close();
server.close();
console.log(`level ${level}, x=${info.x} (${info.state}) -> ${out}`);
