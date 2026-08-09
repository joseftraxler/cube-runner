/**
 * Automatický průchod všemi levely v opravdovém prohlížeči.
 *
 * Skript si nechá od `tools/gen_levels.py` spočítat, ve kterých x-souřadnicích
 * stačí skočit, spustí hru v Chromiu a odehraje každý level krok po kroku
 * skutečným kódem hry (`Game.update`). Když někde kostka umře, test spadne –
 * odhalí to jak rozbitou fyziku, tak neprůchodný level.
 *
 * Vyžaduje Node.js a balíček `playwright` (`npm i -D playwright`), proto to
 * není součást hry samotné, ale nástroj pro vývoj.
 *
 * Použití:
 *     node tools/playtest.mjs
 *     node tools/playtest.mjs --headed     # ať je vidět, co se děje
 */
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {dirname, extname, join, normalize} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};

// Statický server – ES moduly se přes file:// nenačtou
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

/**
 * Odehraje jeden level uvnitř stránky: před každým snímkem případně skočí
 * a pak posune hru o pevný krok. Nečeká se na requestAnimationFrame, takže
 * je celý průchod hotový během chvilky.
 */
function playInPage([levelIndex, jumps, dt]) {
    const game = window.cubeRunner;
    game.levelIndex = levelIndex;
    game.attempts = 1;
    game.best = 0;
    game.loadLevel();
    game.state = 'playing';

    let next = 0;

    for (let frame = 0; frame < 100000; frame++) {
        if (next < jumps.length && frame === jumps[next]) {
            game.handleAction('jump');
            game.handleRelease('jump');
            next++;
        }
        game.update(dt);

        if (game.state === 'levelComplete' || game.state === 'won') {
            return {ok: true, state: game.state, coins: game.coins,
                    total: game.level.coinCount, seconds: +(frame * dt).toFixed(1)};
        }
        if (game.state === 'dying') {
            return {ok: false, reason: 'kostka zemřela',
                    progress: Math.round(game.best * 100), x: +game.player.x.toFixed(2)};
        }
    }
    return {ok: false, reason: 'level nedoběhl do konce'};
}

const paths = JSON.parse(execFileSync('python3', [join(ROOT, 'tools/gen_levels.py'), '--paths', '-'],
    {encoding: 'utf8', maxBuffer: 1 << 24}));

// require (na rozdíl od importu) najde playwright i v globálních modulech
const {chromium} = createRequire(import.meta.url)('playwright');
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({headless: !process.argv.includes('--headed')});
const page = await browser.newPage({viewport: {width: 1280, height: 720}});

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => !!window.cubeRunner);

let failed = 0;
for (const {level, speed, jumps, dt} of paths) {
    const r = await page.evaluate(playInPage, [level - 1, jumps, dt]);
    if (r.ok) {
        console.log(`level${String(level).padEnd(2)} rychlost ${String(speed).padStart(3)} %  ` +
            `DOBĚHNUTO za ${r.seconds} s, mince ${r.coins}/${r.total}`);
    } else {
        failed++;
        console.log(`level${String(level).padEnd(2)} rychlost ${String(speed).padStart(3)} %  ` +
            `SELHALO – ${r.reason}` + (r.progress !== undefined ? ` (${r.progress} %, x=${r.x})` : ''));
    }
}

await browser.close();
server.close();

if (errors.length) {
    console.log('\nChyby v konzoli prohlížeče:');
    errors.forEach(e => console.log('  ' + e));
}

if (failed || errors.length) {
    console.log(`\nNeprošlo ${failed} z ${paths.length} levelů.`);
    process.exit(1);
}
console.log(`\nVšech ${paths.length} levelů prošlo.`);
