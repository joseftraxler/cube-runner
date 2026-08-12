import {Level} from "./level.js";
import {Player} from "./entities/player.js";
import {Saw, SAW_RADIUS} from "./entities/saw.js";
import {Orbiter, BALL_RADIUS} from "./entities/orbiter.js";
import {BASE_SPEED, CUBE, HIT, PAD_BOOST} from "./physics.js";
import {buildKeyMap, actionForEvent} from "./input.js";
import {Sound} from "./audio.js";
import {Haptics} from "./haptics.js";

// Výška horního pruhu s ukazatelem postupu a statistikami (px)
const HUD = 54;

// Minimální počet políček viditelných na šířku – aby šlo reagovat na překážky
const MIN_VIEW_TILES = 18;

// Šířka pruhu jednoho přepínače vpravo nahoře (px) – v rohu je zvuk,
// hned vedle vibrace. Ikona se kreslí do stejného pruhu, do kterého se ťuká.
const ICON_ZONE = 44;

const TAU = Math.PI * 2;

// Kolik vloček sněhu / jisker nad lávou má prostředí v pozadí
const WEATHER_COUNT = 90;

// Odkud dolů se obraz vlní horkým vzduchem (podíl výšky plátna). Horko stoupá
// od lávy a od písku, takže horní část obrazu se vlnit nemusí – a nemusí se
// tam ani přepočítávat, což je na slabších zařízeních to hlavní.
const HAZE_FROM = 0.45;

// Kolik symbolů plave v hloubce matematického světa a kolik je v něm obrazců
const MATH_SYMBOL_COUNT = 14;
const MATH_FIGURES = 4;

// Kolik různých podob bloku se předkreslí do dlaždic. Podoba se vybírá ze
// souřadnic políčka, takže je pro dané místo stálá (jako dřív šum) – jen se
// po dvanácti blocích opakuje, což mezi sousedy není poznat.
const BLOCK_VARIANTS = 12;

/*
 * Matematické symboly se kreslí čarami (`mathGlyph`), ne písmem. Znaky jako
 * ∑ nebo ∮ nemá každé zařízení ve fontu a místo symbolu by byl vidět prázdný
 * obdélníček – navíc rýsované tahy sedí k rýsovacímu papíru v pozadí.
 */
const MATH_GLYPHS = ['sum', 'product', 'integral', 'contour', 'root', 'pi',
    'infinity', 'nabla', 'delta', 'partial', 'lambda', 'phi'];

// Do bloků se rýsují jen jednoduché symboly – složité by se v políčku slily
const BLOCK_GLYPHS = ['pi', 'sum', 'integral', 'root', 'delta', 'infinity',
    'partial', 'lambda'];

export class Game {
    constructor(canvas, levels, controls) {
        this.c = canvas;
        this.ctx = canvas.getContext('2d');
        this.levels = levels;
        this.levelIndex = 0;
        this.keyMap = buildKeyMap(controls);

        this.score = 0;
        this.attempts = 1;
        this.best = 0;          // nejlepší postup v aktuálním levelu (0–1)
        // ready | playing | paused | dying | levelComplete | won
        this.state = 'ready';
        this.stateTimer = 0;

        this.clock = 0;         // běží pořád, pro animace pozadí a překážek
        this.holdJump = false;  // drží hráč tlačítko skoku? (GD: drženým skáče dál)
        this.particles = [];

        // Předkreslené kusy obrazu – co se mezi snímky nemění, se kreslí jednou
        // a pak už jen kopíruje. Platí pro dané téma a velikost políčka, takže
        // se to zahazuje při `resize()` (ten se volá i po načtení levelu).
        this.blockTiles = new Map();   // dlaždice bloků podle podoby
        this.backdrop = null;          // nehybné pozadí (obloha s mřížkou / papír)
        this.textWidths = new Map();   // změřené šířky textů v HUD
        this.sound = new Sound();
        this.haptics = new Haptics();

        this.loadLevel();
        this.bindInput();
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.lastTime = performance.now();
        requestAnimationFrame(t => this.loop(t));
    }

    loadLevel() {
        // Znovu rozparsujeme level, aby se po smrti obnovily mince i prstence
        const base = this.levels[this.levelIndex];
        this.level = new Level({speed: base.speed, theme: base.theme}, ...base.rows);

        const speed = BASE_SPEED * this.level.speed / 100;
        this.player = new Player(this, this.level.playerSpawn.x + 0.5, this.level.playerSpawn.y + 0.5, speed);
        this.saws = this.level.sawSpawns.map(s => new Saw(this, s.x + 0.5, s.y + 0.5));
        this.orbiters = this.level.orbiterSpawns.map(o => new Orbiter(this, o.x + 0.5, o.y + 0.5));

        this.usedRings = new Set();  // "x,y" prstenců využitých v tomto pokusu
        this.coins = 0;
        this.startX = this.player.x;
        this.progress = 0;
        this.particles.length = 0;
        this.camX = 0;
        this.padKey = null;     // odrazová plošina, na které kostka právě stojí

        // Motiv hudby se řídí tématem prostředí – led zní jinak než oheň
        this.sound.setTrack(this.levelIndex, this.level.speed, this.level.theme);

        if (this.tile) this.resize();
    }

    // ---- Vstup ----
    bindInput() {
        window.addEventListener('keydown', e => {
            if (e.repeat) return;
            const action = actionForEvent(this.keyMap, e);
            if (!action) return;
            e.preventDefault();
            this.handleAction(action);
        });

        window.addEventListener('keyup', e => {
            const action = actionForEvent(this.keyMap, e);
            if (!action) return;
            this.handleRelease(action);
        });

        this.bindPointer();
    }

    /**
     * Zpracuje stisk jedné akce (jump/pause/restart/mute/haptics) – společné pro
     * klávesy, dotyk i myš. Nové vstupy směruj sem, ať se logika neduplikuje.
     */
    handleAction(action) {
        // Zvuk smí naběhnout až po interakci uživatele (autoplay policy)
        this.sound.unlock();

        if (action === 'mute') {
            this.sound.toggleMute();
            return;
        }

        if (action === 'haptics') {
            // Zapnutí potvrdí vibrace – na ztlumeném telefonu je to jediná
            // odezva, podle které hráč pozná, že přepínač zabral
            if (this.haptics.toggle()) this.haptics.play('ring');
            return;
        }

        if (action === 'restart') {
            if (this.state === 'playing' || this.state === 'paused') this.retry();
            return;
        }

        if (action === 'pause' && (this.state === 'playing' || this.state === 'paused')) {
            this.state = this.state === 'playing' ? 'paused' : 'playing';
            return;
        }

        switch (this.state) {
            case 'ready':
                // Skok se nepředává dál, aby hra hned po startu nevyskočila
                this.state = 'playing';
                break;
            case 'playing':
                this.holdJump = true;
                this.tryJump();
                break;
            case 'paused':
                this.state = 'playing';
                break;
            case 'levelComplete':
                this.nextLevel();
                break;
            case 'won':
                this.restartGame();
                break;
        }
    }

    handleRelease(action) {
        if (action === 'jump') this.holdJump = false;
    }

    // Dotyk i myš: v horním pruhu = pauza, jinde = skok (držením se skáče dál)
    bindPointer() {
        const press = (clientX, clientY) => {
            if (clientY >= HUD) return this.handleAction('jump');
            // pravý roh pruhu = zvuk, vedle něj vibrace, zbytek pruhu = pauza
            const fromRight = this.c.width - clientX;
            if (fromRight < ICON_ZONE) return this.handleAction('mute');
            if (this.haptics.supported && fromRight < ICON_ZONE * 2) return this.handleAction('haptics');
            this.handleAction('pause');
        };

        this.c.addEventListener('touchstart', e => {
            e.preventDefault();
            press(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        }, {passive: false});

        this.c.addEventListener('touchmove', e => e.preventDefault(), {passive: false});

        this.c.addEventListener('touchend', e => {
            e.preventDefault();
            this.handleRelease('jump');
        }, {passive: false});

        this.c.addEventListener('mousedown', e => press(e.clientX, e.clientY));
        window.addEventListener('mouseup', () => this.handleRelease('jump'));
    }

    /**
     * Ohlásí událost všem zpětným vazbám naráz – zvuku i vibracím. Obě znají
     * stejná jména událostí, takže je vždycky cítit přesně to, co je slyšet
     * (a u nové události se nedá na jednu z nich zapomenout).
     */
    feedback(name) {
        this.sound.play(name);
        this.haptics.play(name);
    }

    // Skok ze země, nebo ve vzduchu z prstence
    tryJump() {
        if (this.player.onGround) {
            this.player.jump();
            this.feedback('jump');
            return;
        }

        const ring = this.ringUnderPlayer();
        if (ring) {
            this.usedRings.add(ring);
            this.player.jump();
            this.feedback('ring');
        }
    }

    // ---- Průběh hry ----
    retry() {
        this.attempts++;
        this.loadLevel();
        this.state = 'playing';
    }

    nextLevel() {
        this.levelIndex++;
        this.attempts = 1;
        this.best = 0;
        this.loadLevel();
        this.state = 'ready';
    }

    restartGame() {
        this.levelIndex = 0;
        this.score = 0;
        this.attempts = 1;
        this.best = 0;
        this.loadLevel();
        this.state = 'ready';
    }

    die() {
        this.feedback('death');
        this.spawnExplosion();
        this.state = 'dying';
        this.stateTimer = 0.75;
    }

    resize() {
        this.c.width = window.innerWidth;
        this.c.height = window.innerHeight;

        const availH = this.c.height - HUD;
        // Kreslí se jen využitá část mapy (bez prázdného nebe nad překážkami),
        // ale zároveň musí být vidět dost políček dopředu na reakci
        const rows = this.level.height - this.level.viewTop;
        this.tile = Math.max(1, Math.min(availH / rows, this.c.width / MIN_VIEW_TILES));
        this.offsetY = HUD + (availH - this.tile * rows) / 2 - this.level.viewTop * this.tile;

        this.#dropStaleCaches();

        // Horká témata si odkládají stranou spodek obrazu, který se vlní
        if (this.hazy) {
            const {from} = this.hazeGeometry();
            this.haze ??= document.createElement('canvas');
            this.haze.width = this.c.width;
            this.haze.height = Math.max(1, this.c.height - from);
            this.hazeCtx = this.haze.getContext('2d');
        }
    }

    /**
     * Zahodí předkreslené kusy obrazu, když už neplatí. Kreslí se do nich podle
     * tématu, odstínu a velikosti políčka – dokud se ani jedno nezměnilo, není
     * proč je zahazovat. `resize()` se totiž volá i po každé smrti (level se
     * načítá znovu) a překreslovat kvůli tomu dlaždice by bylo zbytečné.
     */
    #dropStaleCaches() {
        const key = `${this.level.theme}|${this.hue}|${this.tile}|${this.c.width}×${this.c.height}`;
        if (key === this.cacheKey) return;

        this.cacheKey = key;
        this.blockTiles.clear();
        this.textWidths.clear();
        this.backdrop = null;
    }

    loop(now) {
        const dt = Math.min((now - this.lastTime) / 1000, 0.05);
        this.lastTime = now;

        this.update(dt);
        this.render();
        this.sound.setMusicOn(this.state === 'playing');
        // Hudba houstne s tím, jak daleko se kostka dostala
        this.sound.setIntensity(this.state === 'playing' ? this.progress : 0);

        requestAnimationFrame(t => this.loop(t));
    }

    update(dt) {
        this.clock += dt;
        this.updateParticles(dt);

        if (this.state === 'dying') {
            this.stateTimer -= dt;
            if (this.stateTimer <= 0) {
                this.attempts++;
                this.loadLevel();
                this.state = 'playing';
            }
            return;
        }

        if (this.state !== 'playing') return;

        // Pohyblivé překážky se hýbou jen za hry. Jejich poloha tak závisí čistě
        // na odehraném čase, což potřebuje simulace v generátoru.
        this.saws.forEach(s => s.step(dt));
        this.orbiters.forEach(o => o.step(dt));

        // Držené tlačítko skáče znovu hned po dopadu (jako v Geometry Dash)
        if (this.holdJump && this.player.onGround) {
            this.player.jump();
            this.feedback('jump');
        }

        this.player.step(dt);

        if (this.player.crashed || this.outOfBounds()) {
            this.die();
            return;
        }

        this.applyTriggers();
        this.collectCoins();

        if (this.hazardHit()) {
            this.die();
            return;
        }

        const span = Math.max(this.level.finishX - this.startX, 1);
        this.progress = Math.min(1, Math.max(0, (this.player.x - this.startX) / span));
        this.best = Math.max(this.best, this.progress);

        if (this.player.x >= this.level.finishX) {
            this.progress = 1;
            this.best = 1;
            this.score += 1000;
            this.state = (this.levelIndex >= this.levels.length - 1) ? 'won' : 'levelComplete';
            this.feedback(this.state === 'won' ? 'win' : 'complete');
        }

        this.updateCamera();
    }

    // Vypadla kostka z mapy? (díra v podlaze nebo prolet nad stropem)
    outOfBounds() {
        return this.player.y > this.level.height + 2 || this.player.y < -3;
    }

    // Políčka, kterých se kostka může dotýkat (okolí jejího středu)
    *nearbyTiles() {
        const x0 = Math.floor(this.player.x - 1);
        const x1 = Math.floor(this.player.x + 1);
        const y0 = Math.floor(this.player.y - 1);
        const y1 = Math.floor(this.player.y + 1);

        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                yield {x, y};
            }
        }
    }

    // Překrývá se kostka (obdélníkem o straně `size`) s obdélníkem v mapě?
    overlaps(size, bx0, by0, bx1, by1) {
        const half = size / 2;
        return this.player.x - half < bx1 && this.player.x + half > bx0 &&
            this.player.y - half < by1 && this.player.y + half > by0;
    }

    // Odrazové plošiny a gravitační portály – hra mění stav kostky, ne naopak
    applyTriggers() {
        let pad = null;

        for (const {x, y} of this.nearbyTiles()) {
            const trigger = this.level.triggerAt(x, y);
            if (!trigger || !this.overlaps(CUBE, x, y, x + 1, y + 1)) continue;

            switch (trigger) {
                case 'pad':
                    pad = `${x},${y}`;
                    this.player.jump(PAD_BOOST);
                    break;
                case 'gravityDown':
                case 'gravityUp': {
                    const gravity = trigger === 'gravityUp' ? -1 : 1;
                    // Portál se drží stisknutý celý průlet – odezva jen při změně
                    if (this.player.gravity !== gravity) this.feedback('portal');
                    this.player.gravity = gravity;
                    break;
                }
                // 'ring' se aktivuje až stiskem – viz tryJump()
            }
        }

        // Plošina odrazí kostku každý snímek dotyku, zaznít má ale jen jednou
        if (pad && pad !== this.padKey) this.feedback('pad');
        this.padKey = pad;
    }

    // Klíč nevyužitého prstence, se kterým se kostka právě překrývá (nebo null)
    ringUnderPlayer() {
        for (const {x, y} of this.nearbyTiles()) {
            const key = `${x},${y}`;
            if (this.level.triggerAt(x, y) === 'ring' && !this.usedRings.has(key) &&
                this.overlaps(CUBE, x, y, x + 1, y + 1)) {
                return key;
            }
        }
        return null;
    }

    collectCoins() {
        for (const {x, y} of this.nearbyTiles()) {
            if (this.level.hasCoin(x, y) && this.overlaps(CUBE, x, y, x + 1, y + 1) &&
                this.level.takeCoin(x, y)) {
                this.coins++;
                this.score += 100;
                this.feedback('coin');
            }
        }
    }

    // Dotkla se kostka něčeho smrtícího? (hroty mají menší hitbox než políčko)
    hazardHit() {
        for (const {x, y} of this.nearbyTiles()) {
            const hazard = this.level.hazardAt(x, y);
            if (!hazard) continue;

            const hit = hazard === 'spikeUp'
                ? this.overlaps(HIT, x + 0.22, y + 0.35, x + 0.78, y + 1)
                : this.overlaps(HIT, x + 0.22, y, x + 0.78, y + 0.65);
            if (hit) return true;
        }

        // Pily i koule jsou kulaté – měříme vzdálenost od nejbližšího bodu hitboxu
        for (const saw of this.saws) {
            if (this.hitsCircle(saw.x, saw.y, SAW_RADIUS * 0.85)) return true;
        }
        for (const orbiter of this.orbiters) {
            if (this.hitsCircle(orbiter.ballX, orbiter.ballY, BALL_RADIUS * 0.9)) return true;
        }

        return false;
    }

    // Dotýká se hitbox kostky kruhu se středem [cx, cy]?
    hitsCircle(cx, cy, radius) {
        const half = HIT / 2;
        const dx = Math.max(Math.abs(cx - this.player.x) - half, 0);
        const dy = Math.max(Math.abs(cy - this.player.y) - half, 0);
        return dx * dx + dy * dy < radius * radius;
    }

    updateCamera() {
        const view = this.viewTiles();
        const target = this.player.x - view * 0.32;
        this.camX = Math.max(0, Math.min(target, Math.max(0, this.level.width - view)));
    }

    viewTiles() {
        return this.c.width / this.tile;
    }

    // ---- Částice (výbuch po smrti) ----
    spawnExplosion() {
        const colors = ['#7df9ff', '#1a7fd4', '#ffffff', '#ffd166'];
        for (let i = 0; i < 34; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 3 + Math.random() * 9;
            this.particles.push({
                x: this.player.x,
                y: this.player.y,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v,
                life: 0.5 + Math.random() * 0.4,
                max: 0.9,
                size: 0.1 + Math.random() * 0.16,
                color: colors[i % colors.length],
            });
        }
    }

    updateParticles(dt) {
        for (const p of this.particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 18 * dt;
            p.life -= dt;
        }
        this.particles = this.particles.filter(p => p.life > 0);
    }

    // ---- Vykreslování ----
    px(x) {
        return (x - this.camX) * this.tile;
    }

    py(y) {
        return this.offsetY + y * this.tile;
    }

    // Barevný odstín se s každým levelem posouvá – každý level vypadá jinak.
    // Level s tématem si odstín určuje sám (ledový studeně modrý, ohnivý rudý,
    // pouštní pískový). Matematické téma drží fialovou řadu, ale posouvá ji
    // s levelem – jinak by pět matematických kol vypadalo úplně stejně.
    get hue() {
        if (this.level.theme === 'ice') return 194;
        if (this.level.theme === 'fire') return 14;
        if (this.level.theme === 'desert') return 32;
        if (this.level.theme === 'math') return 258 + (this.levelIndex % 5) * 12;
        return (205 + this.levelIndex * 31) % 360;
    }

    // Témata, ve kterých je horko – obraz se rozvlní chvěním vzduchu
    get hazy() {
        return this.level.theme === 'fire' || this.level.theme === 'desert';
    }

    render() {
        this.drawWorld();
        // V horkých tématech se spodek hotového obrazu ještě rozvlní horkým
        // vzduchem. HUD a překryv jdou až po tom, ať se texty nevlní.
        if (this.hazy && this.hazeCtx) this.drawHeatHaze();

        this.drawHud();
        this.drawOverlay();
    }

    // Všechno, co patří do herního světa (a co se v ohnivém tématu vlní)
    drawWorld() {
        this.drawBackground();
        this.drawLevel();
        // Láva teče spodním řádkem mapy, takže se kreslí až přes bloky
        if (this.level.theme === 'fire') this.drawLava();
        this.saws.forEach(s => s.draw(this.ctx, this.px(s.x), this.py(s.y), this.tile));
        this.orbiters.forEach(o => o.draw(this.ctx, this.px(o.x), this.py(o.y), this.tile));

        if (this.state !== 'dying') {
            this.player.draw(this.ctx, this.px(this.player.x), this.py(this.player.y), this.tile);
        }

        this.drawParticles();
        // V ohnivém tématu je pod mapou láva, tmavý pruh by ji jen přikryl
        if (this.level.theme !== 'fire') this.drawGroundLine();
    }

    // Výška pruhu vlnění a řádek, odkud dolů se obraz vlní. Počítá se na jednom
    // místě, protože podle toho se v `resize()` měří i odkládací plátno.
    hazeGeometry() {
        const band = Math.max(4, Math.round(this.c.height / 110));
        return {band, from: Math.round(this.c.height * HAZE_FROM / band) * band};
    }

    /**
     * Rozvlní spodek hotového obrazu, jako by nad lávou nebo nad rozpáleným
     * pískem stoupal horký vzduch. Spodní část plátna se odloží stranou a vrátí
     * se po vodorovných pruzích, každý posunutý podle sinusovky. Výchylka roste
     * od nuly na horní hranici pruhů, aby tam nebyl vidět šev – horko stejně
     * stoupá zdola, takže se nahoře vlnit nemá co.
     *
     * Vlní se schválně jen spodek obrazu (`HAZE_FROM`) a **kopie se nezvětšují
     * ani neposouvají o zlomky pixelu**: roztažený pruh se musí přepočítat pixel
     * po pixelu a přenášet takhle celé plátno stokrát za snímek bylo zdaleka
     * nejdražší místo celé hry (přes 11 ms na snímek). Ze stejného důvodu se
     * svět kreslí rovnou na plátno a stranou jde jen ten vlnící se kus – cesta
     * přes pomocné plátno a zpátky stála víc než všechno vlnění dohromady.
     *
     * Výchylka je schválně sotva znatelná (do zlomku políčka): má to být pocit
     * horka na okraji vidění, ne rozostřená hra – hráč musí přesně vidět, kam skáče.
     */
    drawHeatHaze() {
        const ctx = this.ctx;
        const w = this.c.width;
        const h = this.c.height;
        const {band, from} = this.hazeGeometry();
        // Nad pouští se vzduch chvěje míň než nad ohněm
        const amp = Math.max(1, this.tile * (this.level.theme === 'desert' ? 0.014 : 0.022));

        this.hazeCtx.drawImage(this.c, 0, from, w, h - from, 0, 0, w, h - from);

        for (let y = from; y < h; y += band) {
            const src = Math.min(band, h - y);
            const rise = (y - from) / (h - from);      // dole plná výchylka, nahoře nulová
            const dx = Math.round(Math.sin(this.clock * 2 + y * 0.04) * amp * rise);
            if (dx) ctx.drawImage(this.haze, 0, y - from, w, src, dx, y, w, src);
        }
    }

    drawBackground() {
        const ctx = this.ctx;
        const h = this.hue;

        // Poušť má místo mřížky vlastní obzor – duny, stolové hory a slunce
        if (this.level.theme === 'desert') {
            this.drawDesert();
            return;
        }

        // Matematický svět má místo mřížky rýsovací papír s obrazci
        if (this.level.theme === 'math') {
            this.drawMathSpace();
            return;
        }

        // Obloha s mřížkou se nemění, jen posouvá – kreslí se z hotového obrazu
        this.drawBackdrop((img, width, period) => {
            const grad = img.createLinearGradient(0, 0, 0, this.c.height);
            grad.addColorStop(0, `hsl(${h}, 55%, 20%)`);
            grad.addColorStop(1, `hsl(${h}, 60%, 7%)`);
            img.fillStyle = grad;
            img.fillRect(0, 0, width, this.c.height);

            img.strokeStyle = `hsla(${h}, 70%, 65%, 0.10)`;
            img.lineWidth = 1;
            img.beginPath();
            for (let x = 0; x < width; x += period) {
                img.moveTo(x + 0.5, 0);
                img.lineTo(x + 0.5, this.c.height);
            }
            for (let y = wrap(this.offsetY, period); y < this.c.height; y += period) {
                img.moveTo(0, Math.round(y) + 0.5);
                img.lineTo(width, Math.round(y) + 0.5);
            }
            img.stroke();
        });

        if (this.level.theme === 'ice') this.drawWeather(false);
        if (this.level.theme === 'fire') this.drawWeather(true);
    }

    /**
     * Nehybné pozadí (obloha s mřížkou, rýsovací papír) se vykreslí jednou do
     * obrázku o periodu vzoru širšího než plátno a pak se každý snímek jen
     * posune a zkopíruje. Kreslit desítky čar přes celé plátno pokaždé znovu
     * je zbytečné – mění se u nich jen posun do strany.
     *
     * `paint(ctx, width, period)` dostane rozteč hrubé mřížky (celá čísla, ať
     * čáry po posunu nezešednou) a kreslí do obrázku od nuly; hra ho pak
     * posune o `shift` vlevo. Obrázek platí pro jedno téma a jednu velikost
     * políčka – zahazuje ho `resize()`.
     */
    drawBackdrop(paint) {
        const period = Math.max(2, Math.round(this.tile * 2));

        if (!this.backdrop) {
            const img = document.createElement('canvas');
            img.width = this.c.width + period;
            img.height = this.c.height;
            paint(img.getContext('2d'), img.width, period);
            this.backdrop = img;
            this.backdropPeriod = period;
        }

        // Parallax: pozadí se posouvá pomaleji než hra
        const shift = wrap(Math.round(this.camX * this.tile * 0.35), this.backdropPeriod);
        this.ctx.drawImage(this.backdrop, -shift, 0);
    }

    /**
     * Sníh (ledové téma), nebo jiskry stoupající od lávy (ohnivé téma).
     * Polohy se počítají z hodin a stálého šumu podle pořadí vločky, takže
     * není potřeba držet stav – přežije to i změnu velikosti okna.
     */
    drawWeather(rising) {
        const ctx = this.ctx;
        const w = this.c.width;
        const h = this.c.height;

        for (let i = 0; i < WEATHER_COUNT; i++) {
            // Bližší vločky jsou větší, rychlejší a víc se posouvají s kamerou
            const depth = 0.35 + noise(i) * 0.65;
            const speed = (rising ? 55 : 32) * depth;
            const travel = (noise(i + 101) * h + this.clock * speed) % h;
            const y = rising ? h - travel : travel;
            // Vločka se cestou dolů kolébá do stran (dvě sinusovky, ať to není
            // pravidelné kyvadlo), jiskra jen mírně uhýbá ve stoupavém proudu.
            // Do stran se vločka nesmí hnát rychleji, než padá – to už není sníh.
            const drift = rising
                ? Math.sin(this.clock * 1.6 + i) * 14 * depth
                : (Math.sin(this.clock * 0.75 + i) * 26 + Math.sin(this.clock * 1.9 + i * 1.7) * 7) * depth;
            const x = wrap(noise(i + 7) * w + drift - this.camX * this.tile * 0.12 * depth, w);
            const r = depth * Math.max(1.2, this.tile * (rising ? 0.028 : 0.038));

            // Jiskra ke konci cesty vyhasíná, vločka je pořád stejná
            const fade = rising ? Math.max(0, 1 - travel / h) : 1;
            ctx.globalAlpha = (0.25 + depth * 0.5) * fade;
            ctx.fillStyle = rising
                ? `hsl(${25 + noise(i + 55) * 20}, 100%, ${60 + depth * 20}%)`
                : '#ffffff';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    /**
     * Pouštní obzor. Nebe je nahoře tmavé (aby šel číst HUD) a u země rozpálené
     * do oranžova. Před ním stojí slunce v oparu, stolové hory a dvě vrstvy dun –
     * každá se posouvá jinou rychlostí (parallax) a ta vzdálenější je světlejší,
     * protože ji vybledne prach ve vzduchu.
     *
     * Všechno se opírá o horní hranu podlahy: níž už kreslí bloky, takže se tam
     * pozadí stejně neuvidí. Pod tou hranou je schválně tma – dírou v podlaze
     * musí být vidět, že se propadá do prázdna, ne do písku.
     */
    drawDesert() {
        const ctx = this.ctx;
        const w = this.c.width;
        const h = this.c.height;
        const ground = this.py(this.level.height - 2);

        const sky = ctx.createLinearGradient(0, 0, 0, Math.max(ground, 1));
        sky.addColorStop(0, 'hsl(22, 50%, 16%)');
        sky.addColorStop(0.5, 'hsl(30, 58%, 30%)');
        sky.addColorStop(1, 'hsl(38, 70%, 47%)');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        this.drawSun(ground);
        this.drawSkyVultures();
        this.drawMesas(ground);
        this.drawDunes(ground);
        this.drawSandDust();

        ctx.fillStyle = 'hsl(26, 45%, 6%)';
        ctx.fillRect(0, ground, w, h - ground);
    }

    // Slunce v prachovém oparu. Je daleko, takže se s kamerou neposouvá vůbec.
    drawSun(ground) {
        const ctx = this.ctx;
        const cx = this.c.width * 0.74;
        const cy = ground * 0.42;
        const r = Math.max(this.tile * 1.05, 18);

        const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 4.5);
        glow.addColorStop(0, 'rgba(255, 224, 150, 0.42)');
        glow.addColorStop(1, 'rgba(255, 190, 90, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 4.5, 0, TAU);
        ctx.fill();

        // Kotouč má měkký okraj – slunce prosvítá prachem, nemá ostrou hranu
        const disc = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
        disc.addColorStop(0, 'rgba(255, 244, 210, 0.92)');
        disc.addColorStop(0.75, 'rgba(255, 232, 180, 0.8)');
        disc.addColorStop(1, 'rgba(255, 220, 150, 0)');
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.fill();
    }

    /**
     * Supi kroužící vysoko na obloze. Je to jen kulisa, ne překážka – proto
     * jsou schválně malí, průsvitní a drží se u horního okraje, aby si je
     * hráč nespletl se supem visícím přímo v dráze kostky.
     */
    drawSkyVultures() {
        const ctx = this.ctx;
        const w = this.c.width;
        const h = this.c.height;

        ctx.strokeStyle = 'rgba(38, 22, 14, 0.45)';
        ctx.lineCap = 'round';

        for (let i = 0; i < 3; i++) {
            const depth = 0.5 + noise(i * 31 + 5) * 0.5;
            // Každý sup krouží po vlastní elipse a vlastní rychlostí
            const angle = this.clock * (0.2 + noise(i * 7) * 0.16) + noise(i * 13) * TAU;
            const cx = wrap(noise(i * 17 + 3) * w + Math.cos(angle) * w * 0.13
                - this.camX * this.tile * 0.05 * depth, w);
            const cy = h * (0.07 + noise(i * 23 + 9) * 0.15) + Math.sin(angle) * h * 0.025;
            const s = this.tile * 0.3 * depth;
            // Křídla se nikdy nesrovnají do roviny, jinak by z ptáka byla čárka
            const flap = 0.45 + 0.28 * Math.sin(this.clock * 2.4 + i * 2);

            ctx.lineWidth = Math.max(s * 0.16, 1);
            ctx.beginPath();
            ctx.moveTo(cx - s, cy);
            ctx.quadraticCurveTo(cx - s * 0.5, cy - s * flap, cx, cy);
            ctx.quadraticCurveTo(cx + s * 0.5, cy - s * flap, cx + s, cy);
            ctx.stroke();
        }

        ctx.lineCap = 'butt';
    }

    // Stolové hory na obzoru – nejvzdálenější vrstva, sotva odlišená od nebe
    drawMesas(ground) {
        const ctx = this.ctx;
        const span = this.c.width + this.tile * 14;
        const shift = this.camX * this.tile * 0.07;

        ctx.fillStyle = 'hsla(18, 38%, 30%, 0.55)';
        for (let i = 0; i < 8; i++) {
            const bw = this.tile * (2.4 + noise(i * 3 + 1) * 3.4);
            const bh = this.tile * (1.1 + noise(i * 7 + 5) * 1.7);
            const cx = wrap(noise(i * 11 + 3) * span - shift, span) - this.tile * 7;
            const top = ground - bh;

            ctx.beginPath();
            ctx.moveTo(cx - bw * 0.62, ground);
            ctx.lineTo(cx - bw * 0.42, top);
            ctx.lineTo(cx + bw * 0.42, top);
            ctx.lineTo(cx + bw * 0.62, ground);
            ctx.closePath();
            ctx.fill();
        }
    }

    // Dvě vrstvy dun – bližší je tmavší a posouvá se rychleji
    drawDunes(ground) {
        const ctx = this.ctx;
        const w = this.c.width;
        const layers = [
            {depth: 0.13, rise: 1.7, wave: 0.0052, color: 'hsl(32, 50%, 34%)'},
            {depth: 0.28, rise: 0.9, wave: 0.0088, color: 'hsl(26, 46%, 23%)'},
        ];

        for (const {depth, rise, wave, color} of layers) {
            const shift = this.camX * this.tile * depth;
            const crest = ground - this.tile * rise;

            ctx.beginPath();
            ctx.moveTo(0, ground + this.tile);
            for (let x = 0; x <= w; x += 8) {
                const s = (x + shift) * wave;
                ctx.lineTo(x, crest + Math.sin(s) * this.tile * 0.5
                    + Math.sin(s * 2.3 + 1.7) * this.tile * 0.24);
            }
            ctx.lineTo(w, ground + this.tile);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
        }
    }

    /**
     * Zrnka písku hnaná větrem kostce v zádech. Polohy se počítají z hodin
     * a stálého šumu podle pořadí zrnka, takže není potřeba držet stav.
     */
    drawSandDust() {
        const ctx = this.ctx;
        const w = this.c.width;
        const h = this.c.height;

        for (let i = 0; i < WEATHER_COUNT; i++) {
            // Bližší zrnka jsou větší, rychlejší a víc se posouvají s kamerou
            const depth = 0.35 + noise(i) * 0.65;
            const x = wrap(noise(i + 41) * w + this.clock * 130 * depth
                - this.camX * this.tile * 0.22 * depth, w);
            const y = wrap(noise(i + 73) * h + Math.sin(this.clock * 0.9 + i * 2.1) * 10 * depth, h);
            const r = depth * Math.max(1, this.tile * 0.022);

            ctx.globalAlpha = 0.12 + depth * 0.22;
            ctx.fillStyle = '#ffe6b0';
            // Zrnko se za letu rozmázne do vodorovné čárky
            ctx.fillRect(x, y, r * (3 + depth * 4), r);
        }

        ctx.globalAlpha = 1;
    }

    /**
     * Matematický svět. Pozadí je rýsovací papír – jemná mřížka se zvýrazněnými
     * osami – a nad ním se pomalu otáčejí geometrické obrazce, mezi kterými jsou
     * narýsované vztahy (shodné strany, úhly, zobrazení, promítnutí kružnice do
     * sinusovky). Úplně vzadu plují matematické symboly.
     *
     * Všechny vrstvy jsou stálou funkcí času a pořadí prvku (`noise`), takže se
     * s posunem kamery nic nepřeskládá, a jedou s malým parallaxem – pozadí má
     * být hloubka, ne rozptýlení. Proto je taky celé bledé: hráč musí i tak na
     * první pohled poznat, kde je blok a kde překážka.
     */
    drawMathSpace() {
        // Papír i s oblohou se posouvá jen do strany – kreslí se z hotového obrazu
        this.drawBackdrop((img, width, period) => this.paintGraphPaper(img, width, period));
        this.drawMathSymbols();
        this.drawMathFigures();
    }

    /**
     * Rýsovací papír: jemný rastr, přes něj hrubší a v místě mapy vodorovná osa
     * s ryskami. Kreslí se do předem připraveného obrazu (`drawBackdrop`), ten
     * se pak jen posouvá s kamerou – proto se tady s posunem nepočítá a rozteče
     * jsou celá čísla, aby čáry zůstaly ostré.
     */
    paintGraphPaper(ctx, width, period) {
        const h = this.c.height;
        const shade = this.hue;

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, `hsl(${shade}, 45%, 13%)`);
        grad.addColorStop(0.6, `hsl(${shade + 12}, 50%, 9%)`);
        grad.addColorStop(1, `hsl(${shade + 20}, 55%, 5%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, h);

        // Jemný rastr má čtvrtinovou rozteč hrubého, takže se opakují spolu
        for (const [step, alpha] of [[period / 4, 0.05], [period, 0.11]]) {
            ctx.strokeStyle = `hsla(${shade}, 75%, 70%, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0; x < width; x += step) {
                ctx.moveTo(Math.round(x) + 0.5, 0);
                ctx.lineTo(Math.round(x) + 0.5, h);
            }
            for (let y = wrap(this.offsetY, step); y < h; y += step) {
                ctx.moveTo(0, Math.round(y) + 0.5);
                ctx.lineTo(width, Math.round(y) + 0.5);
            }
            ctx.stroke();
        }

        // Vodorovná osa vede po úrovni země – rysky na ní odměřují políčka,
        // takže je vidět, jak daleko kostka doběhla
        const axis = Math.round(this.py(this.level.height - 2)) + 0.5;
        ctx.strokeStyle = `hsla(${shade}, 85%, 78%, 0.28)`;
        ctx.lineWidth = Math.max(this.tile * 0.03, 1);
        ctx.beginPath();
        ctx.moveTo(0, axis);
        ctx.lineTo(width, axis);
        for (let x = 0; x < width; x += period) {
            ctx.moveTo(Math.round(x) + 0.5, axis - this.tile * 0.12);
            ctx.lineTo(Math.round(x) + 0.5, axis + this.tile * 0.12);
        }
        ctx.stroke();
    }

    /**
     * Symboly plující v hloubce (∑, ∫, ∮, π …). Kreslí se čarami, ne písmem –
     * na cizím zařízení by z nefontovaného znaku byl prázdný obdélníček.
     */
    drawMathSymbols() {
        const ctx = this.ctx;
        const w = this.c.width;
        const h = this.c.height;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 0; i < MATH_SYMBOL_COUNT; i++) {
            // Bližší symboly jsou větší a víc se posouvají s kamerou
            const depth = 0.3 + noise(i * 5 + 1) * 0.7;
            // Symboly zůstávají menší než políčko: v pozadí mají být hloubka,
            // ne kulisa, přes kterou se hledají překážky
            const size = this.tile * (0.35 + depth * 0.55);
            const x = wrap(noise(i * 13 + 7) * (w + size * 2)
                - this.camX * this.tile * 0.09 * depth, w + size * 2) - size;
            const y = noise(i * 23 + 3) * h
                + Math.sin(this.clock * (0.2 + noise(i * 3) * 0.3) + i) * this.tile * 0.35;
            const glyph = MATH_GLYPHS[Math.floor(noise(i * 31 + 11) * MATH_GLYPHS.length)];

            ctx.strokeStyle = `hsla(${this.hue + 30}, 80%, 80%, ${0.05 + depth * 0.07})`;
            ctx.lineWidth = Math.max(size * 0.06, 1);
            mathGlyph(ctx, glyph, x, y, size);
            ctx.stroke();
        }

        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
    }

    /**
     * Geometrické obrazce a vztahy mezi nimi. Každý obrazec je kružnice
     * s vepsaným pravidelným mnohoúhelníkem, který se pomalu otáčí; k vrcholu
     * vede poloměr s obloučkem úhlu a strany mají rysky shodnosti.
     *
     * Sousední obrazce spojuje čárkovaná šipka zobrazení – „vztah mezi nimi“.
     * První obrazec je navíc jednotková kružnice, ze které se vodorovně promítá
     * sinusovka: to je na pohled ta nejzřejmější matematická souvislost.
     */
    drawMathFigures() {
        const ctx = this.ctx;
        const w = this.c.width;
        const h = this.c.height;
        const span = w + this.tile * 20;
        const shift = this.camX * this.tile * 0.16;

        ctx.lineJoin = 'round';

        const spot = i => ({
            x: wrap(noise(i * 17 + 5) * span - shift, span) - this.tile * 10,
            y: h * (0.12 + noise(i * 29 + 13) * 0.5),
            r: this.tile * (1.2 + noise(i * 11 + 3) * 1.5),
            turn: this.clock * (0.06 + noise(i * 7 + 1) * 0.12) + noise(i * 19) * TAU,
        });

        for (let i = 0; i < MATH_FIGURES; i++) {
            const a = spot(i);
            const b = spot(i + 1);
            // Vztah se kreslí jen mezi obrazci, které jsou zrovna vedle sebe –
            // přes celé plátno by z toho byla pavučina. A jen když je aspoň
            // jeden z nich vidět, jinak by se šipka rýsovala pro nic za nic.
            if (Math.abs(b.x - a.x) >= w * 0.45) continue;
            if (Math.min(a.x, b.x) > w || Math.max(a.x, b.x) < 0) continue;
            this.drawRelation(a, b);
        }

        for (let i = 0; i < MATH_FIGURES; i++) {
            const {x, y, r, turn} = spot(i);
            // Co je mimo plátno, se nekreslí. Jednotková kružnice sahá dál
            // doprava, protože z ní vybíhá sinusovka.
            if (x + r * (i === 0 ? 4.4 : 1.4) < 0 || x - r * 1.4 > w) continue;
            if (i === 0) this.drawUnitCircle(x, y, r, turn);
            else this.drawPolygonFigure(x, y, r, turn, 3 + Math.floor(noise(i * 37 + 9) * 4));
        }

        ctx.lineJoin = 'miter';
    }

    // Kružnice s vepsaným mnohoúhelníkem, poloměrem, úhlem a ryskami shodnosti
    drawPolygonFigure(cx, cy, r, turn, sides) {
        const ctx = this.ctx;
        const ink = `hsla(${this.hue + 40}, 85%, 78%, 0.22)`;
        const faint = `hsla(${this.hue + 40}, 85%, 78%, 0.12)`;

        ctx.lineWidth = Math.max(r * 0.035, 1);
        ctx.strokeStyle = faint;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.stroke();

        const point = k => [cx + Math.cos(turn + k * TAU / sides) * r,
                            cy + Math.sin(turn + k * TAU / sides) * r];

        ctx.strokeStyle = ink;
        ctx.beginPath();
        for (let k = 0; k <= sides; k++) {
            const [px, py] = point(k);
            if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();

        // Poloměr k prvnímu vrcholu a oblouček úhlu u středu
        const [vx, vy] = point(0);
        ctx.strokeStyle = faint;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(vx, vy);
        ctx.moveTo(cx + r * 0.3, cy);
        ctx.arc(cx, cy, r * 0.3, 0, turn % TAU);
        ctx.stroke();

        // Rysky shodnosti stran – kolmá čárka uprostřed každé strany
        ctx.strokeStyle = ink;
        ctx.beginPath();
        for (let k = 0; k < sides; k++) {
            const [ax, ay] = point(k);
            const [bx, by] = point(k + 1);
            const mx = (ax + bx) / 2;
            const my = (ay + by) / 2;
            const dx = (bx - ax) / r;
            const dy = (by - ay) / r;
            ctx.moveTo(mx - dy * r * 0.09, my + dx * r * 0.09);
            ctx.lineTo(mx + dy * r * 0.09, my - dx * r * 0.09);
        }
        ctx.stroke();
    }

    /**
     * Jednotková kružnice s otáčejícím se průvodičem a sinusovkou, kterou
     * z něj vodorovně promítá čárkovaná spojnice. Sinusovka roste doprava,
     * takže je vidět, odkud se bere.
     */
    drawUnitCircle(cx, cy, r, turn) {
        const ctx = this.ctx;
        const ink = `hsla(${this.hue + 45}, 90%, 80%, 0.24)`;
        const faint = `hsla(${this.hue + 45}, 90%, 80%, 0.12)`;
        const px = cx + Math.cos(turn) * r;
        const py = cy + Math.sin(turn) * r;

        ctx.lineWidth = Math.max(r * 0.035, 1);
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.stroke();

        // Osy, průvodič a jeho průmět do svislé osy (sinus)
        ctx.strokeStyle = faint;
        ctx.beginPath();
        ctx.moveTo(cx - r * 1.25, cy);
        ctx.lineTo(cx + r * 1.25, cy);
        ctx.moveTo(cx, cy - r * 1.25);
        ctx.lineTo(cx, cy + r * 1.25);
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();

        ctx.setLineDash([r * 0.12, r * 0.1]);
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(cx + r * 1.35 + r * 3, py);
        ctx.stroke();
        ctx.setLineDash([]);

        // Sinusovka napravo od kružnice – úhel průvodiče je její počátek.
        // Dílků je jen tolik, aby byla křivka na pohled hladká; každý navíc
        // se v pozadí ztratí, ale zaplatí se za něj.
        ctx.strokeStyle = ink;
        ctx.beginPath();
        const steps = Math.max(16, Math.min(32, Math.round(r * 0.5)));
        for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            const x = cx + r * 1.35 + t * r * 3;
            const y = cy + Math.sin(turn + t * TAU) * r;
            if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();

        ctx.fillStyle = `hsla(${this.hue + 45}, 95%, 85%, 0.3)`;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(r * 0.06, 1.5), 0, TAU);
        ctx.fill();
    }

    // Čárkovaná šipka mezi dvěma obrazci – „tenhle přejde na tamten“
    drawRelation(a, b) {
        const ctx = this.ctx;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const x0 = a.x + Math.cos(angle) * a.r * 1.15;
        const y0 = a.y + Math.sin(angle) * a.r * 1.15;
        const x1 = b.x - Math.cos(angle) * b.r * 1.15;
        const y1 = b.y - Math.sin(angle) * b.r * 1.15;
        const head = Math.max(this.tile * 0.22, 4);

        ctx.strokeStyle = `hsla(${this.hue + 50}, 80%, 80%, 0.13)`;
        ctx.lineWidth = Math.max(this.tile * 0.03, 1);
        ctx.setLineDash([head * 0.7, head * 0.6]);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - Math.cos(angle - 0.4) * head, y1 - Math.sin(angle - 0.4) * head);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - Math.cos(angle + 0.4) * head, y1 - Math.sin(angle + 0.4) * head);
        ctx.stroke();
    }

    /**
     * Lávová řeka pod úrovní země. Hladina se vlní a posouvá, přes propasti
     * v podlaze je vidět dolů do ní.
     */
    drawLava() {
        const ctx = this.ctx;
        const w = this.c.width;
        const h = this.c.height;
        const top = this.py(this.level.height - 1);
        if (top > h) return;

        const amp = Math.max(2, this.tile * 0.07);
        const scroll = this.clock * 42 + this.camX * this.tile * 0.3;
        const surface = [];
        for (let x = 0; x <= w + 8; x += 8) {
            surface.push([x, top + Math.sin((x + scroll) * 0.02) * amp
                + Math.sin((x - scroll * 1.7) * 0.007) * amp * 0.6]);
        }

        ctx.beginPath();
        surface.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, top - amp, 0, h);
        grad.addColorStop(0, '#ffd166');
        grad.addColorStop(0.15, '#ff7b17');
        grad.addColorStop(0.55, '#c22b0d');
        grad.addColorStop(1, '#3d0a05');
        ctx.fillStyle = grad;
        ctx.fill();

        // Rozžhavená krusta na hladině
        ctx.beginPath();
        surface.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = 'rgba(255, 232, 160, 0.85)';
        ctx.lineWidth = Math.max(this.tile * 0.05, 2);
        ctx.stroke();

        // Bubliny těsně pod hladinou
        for (let i = 0; i < 10; i++) {
            const life = (this.clock * 0.5 + noise(i + 313)) % 1;
            const x = wrap(noise(i + 17) * w - this.camX * this.tile * 0.3, w);
            const r = Math.max(1.5, this.tile * 0.06) * (0.4 + life * 0.8);
            ctx.globalAlpha = 0.5 * (1 - life);
            ctx.fillStyle = '#ffe08a';
            ctx.beginPath();
            ctx.arc(x, top + this.tile * (0.25 + noise(i + 91) * 0.5), r, 0, TAU);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    drawLevel() {
        const from = Math.max(0, Math.floor(this.camX) - 1);
        const to = Math.min(this.level.width, Math.ceil(this.camX + this.viewTiles()) + 1);

        for (let y = this.level.viewTop; y < this.level.height; y++) {
            for (let x = from; x < to; x++) {
                if (this.level.isSolid(x, y)) this.drawBlock(x, y);

                const hazard = this.level.hazardAt(x, y);
                if (hazard) this.drawHazard(x, y, hazard === 'spikeUp');

                const trigger = this.level.triggerAt(x, y);
                if (trigger === 'pad') this.drawPad(x, y);
                else if (trigger === 'ring') this.drawRing(x, y);
                else if (trigger) this.drawPortal(x, y, trigger === 'gravityUp');

                if (this.level.hasCoin(x, y)) this.drawCoin(x, y);
            }
        }

        if (this.level.finishX < this.level.width) this.drawFinish();
    }

    /**
     * Blok se nekreslí pokaždé znovu, ale kopíruje se z hotové dlaždice.
     * Vykreslit v každém snímku pro každý blok přechod, námrazu, vrstvy
     * pískovce nebo vyrytý symbol byla nejdražší část kreslení mapy – a přitom
     * je pro dané místo pořád stejná.
     *
     * Podoba dlaždice se vybírá **ze souřadnic políčka** (`BLOCK_VARIANTS`
     * podob), takže se blok při posunu kamery nemění; kreslí se na celé pixely,
     * aby se kopie nemusela přepočítávat a hrany zůstaly ostré.
     */
    drawBlock(x, y) {
        // Volná horní hrana se kreslí jinak (sníh, navátý písek, světlá linka)
        const capped = this.level.isSolid(x, y - 1);
        const variant = Math.floor(noise(x * 13 + y * 7) * BLOCK_VARIANTS);
        const key = variant * 2 + (capped ? 1 : 0);

        let tile = this.blockTiles.get(key);
        if (!tile) {
            tile = this.bakeBlock(variant, capped);
            this.blockTiles.set(key, tile);
        }

        this.ctx.drawImage(tile, Math.round(this.px(x)), Math.round(this.py(y)) - this.blockPad);
    }

    // Kolik místa nad blokem si dlaždice nechává. Sníh na horní hraně přečnívá
    // nad políčko a bez místa navíc by ho okraj dlaždice uřízl.
    get blockPad() {
        return Math.ceil(this.tile * 0.2);
    }

    /**
     * Strana dlaždice v pixelech: o pixel víc, než je políčko. Bloky se kreslí
     * na celé pixely, takže rozteč sousedů kolísá mezi `floor` a `ceil` políčka –
     * dlaždice o pixel větší tu vůli pokryje a mezi bloky nezůstane škvíra.
     * Ze stejného důvodu se obrys rýsuje až k okraji dlaždice: kdyby končil
     * o pixel dřív, byla by mezi rámečky sousedů občas vidět tmavá čára.
     */
    get blockSize() {
        return Math.ceil(this.tile) + 1;
    }

    // Vykreslí jednu podobu bloku podle tématu do samostatného plátna
    bakeBlock(variant, capped) {
        const pad = this.blockPad;
        const tile = document.createElement('canvas');
        tile.width = this.blockSize;
        tile.height = this.blockSize + pad;

        const ctx = tile.getContext('2d');
        ctx.translate(0, pad);          // kresba počítá s levým horním rohem políčka
        const paint = {ice: this.paintIceBlock, desert: this.paintSandBlock,
                       math: this.paintMathBlock}[this.level.theme] ?? this.paintPlainBlock;
        paint.call(this, ctx, variant, capped);
        return tile;
    }

    paintPlainBlock(ctx, variant, capped) {
        const t = this.tile;
        const s = this.blockSize;

        ctx.fillStyle = `hsl(${this.hue}, 45%, 13%)`;
        ctx.fillRect(0, 0, s, s);

        ctx.strokeStyle = `hsl(${this.hue}, 85%, 72%)`;
        ctx.lineWidth = Math.max(t * 0.07, 1.5);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);

        // Horní hrana bloku je světlejší – lépe je vidět, kam se dá doskočit
        if (!capped) {
            ctx.fillStyle = `hsl(${this.hue}, 90%, 78%)`;
            ctx.fillRect(0, 0, s, Math.max(t * 0.1, 2));
        }
    }

    /**
     * Namrzlý blok. Námraza se počítá ze `variant` (a ta ze souřadnic políčka),
     * takže je pro dané místo stálá a při posunu kamery neposkakuje.
     */
    paintIceBlock(ctx, variant, capped) {
        const t = this.tile;
        const s = this.blockSize;

        const grad = ctx.createLinearGradient(0, 0, 0, t);
        grad.addColorStop(0, 'hsl(198, 50%, 29%)');
        grad.addColorStop(1, 'hsl(207, 55%, 14%)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);

        // Šmouhy námrazy
        ctx.strokeStyle = 'rgba(214, 245, 255, 0.32)';
        ctx.lineWidth = Math.max(t * 0.05, 1);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
            const nx = noise(variant * 17 + i * 41);
            const ny = noise(variant * 3 + i * 13);
            const sx = t * (0.14 + nx * 0.6);
            const sy = t * (0.16 + ny * 0.6);
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + t * 0.22, sy + t * 0.16);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(190, 235, 255, 0.85)';
        ctx.lineWidth = Math.max(t * 0.07, 1.5);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);

        // Na volné horní hraně leží sníh – zároveň je líp vidět, kam se doskočí
        if (!capped) {
            ctx.fillStyle = '#eaf9ff';
            ctx.fillRect(0, 0, s, Math.max(t * 0.12, 2));
            ctx.beginPath();
            for (let i = 0; i < 3; i++) {
                const cx = t * (0.2 + i * 0.3);
                const r = t * (0.11 + noise(variant * 7 + i * 23) * 0.07);
                ctx.moveTo(cx - r, t * 0.05);
                ctx.arc(cx, t * 0.05, r, Math.PI, 0);
            }
            ctx.fill();
        }
    }

    /**
     * Pískovcový blok. Vrstvy i zrno se počítají ze `variant` (a ta ze souřadnic
     * políčka), takže jsou pro dané místo stálé a při posunu kamery neposkakují.
     */
    paintSandBlock(ctx, variant, capped) {
        const t = this.tile;
        const s = this.blockSize;

        const grad = ctx.createLinearGradient(0, 0, 0, t);
        grad.addColorStop(0, 'hsl(33, 42%, 41%)');
        grad.addColorStop(1, 'hsl(24, 40%, 26%)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);

        // Vodorovné vrstvy usazeného pískovce – jen naznačené, ať z bloku
        // nejsou prkna
        ctx.strokeStyle = 'rgba(255, 226, 180, 0.12)';
        ctx.lineWidth = Math.max(t * 0.04, 1);
        ctx.beginPath();
        for (let i = 0; i < 2; i++) {
            const ly = t * (0.34 + i * 0.3 + noise(variant * 19 + i * 31) * 0.14);
            ctx.moveTo(0, ly);
            ctx.lineTo(t, ly + t * 0.05 * (noise(variant * 5 + i) - 0.5));
        }
        ctx.stroke();

        // Zrno – pár tmavších oblázků zapadlých v písku
        ctx.fillStyle = 'rgba(60, 36, 20, 0.3)';
        for (let i = 0; i < 3; i++) {
            const gx = t * (0.15 + noise(variant * 13 + i * 17) * 0.7);
            const gy = t * (0.2 + noise(variant * 29 + i * 7) * 0.65);
            ctx.fillRect(gx, gy, Math.max(t * 0.05, 1), Math.max(t * 0.04, 1));
        }

        // Obrys je měkčí než u ostatních témat – ostrá linka by z pískovce
        // udělala bednu. Hranu, na kterou se doskakuje, stejně nese navátý písek.
        ctx.strokeStyle = 'rgba(245, 210, 155, 0.4)';
        ctx.lineWidth = Math.max(t * 0.05, 1);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);

        // Na volné horní hraně leží navátý písek – zároveň je líp vidět, kam se doskočí
        if (!capped) {
            ctx.fillStyle = '#f2d29b';
            ctx.fillRect(0, 0, s, Math.max(t * 0.11, 2));
            // Vlnky ve vrstvě písku, ať hrana není jako pravítko
            ctx.beginPath();
            ctx.moveTo(0, t * 0.15);
            for (let i = 0; i < 3; i++) {
                const cx = t * (0.17 + i * 0.33);
                ctx.quadraticCurveTo(cx, t * (0.05 + noise(variant * 7 + i * 23) * 0.08),
                    cx + t * 0.165, t * 0.15);
            }
            ctx.lineTo(0, t * 0.15);
            ctx.fill();
        }
    }

    // Hrot podle tématu: ledový krápník, plamen/sopka v ohnivém,
    // kaktus/sup v pouštním, operátor Δ/∇ v matematickém, jinak klasický
    drawHazard(x, y, up) {
        if (this.level.theme === 'ice') {
            this.drawIcicle(x, y, up);
        } else if (this.level.theme === 'fire') {
            if (up) this.drawFlame(x, y);
            else this.drawVolcano(x, y);
        } else if (this.level.theme === 'desert') {
            if (up) this.drawCactus(x, y);
            else this.drawVulture(x, y);
        } else if (this.level.theme === 'math') {
            this.drawOperator(x, y, up);
        } else {
            this.drawSpike(x, y, up);
        }
    }

    drawSpike(x, y, up) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const py = this.py(y);

        ctx.beginPath();
        if (up) {
            ctx.moveTo(px + t * 0.08, py + t);
            ctx.lineTo(px + t * 0.5, py + t * 0.06);
            ctx.lineTo(px + t * 0.92, py + t);
        } else {
            ctx.moveTo(px + t * 0.08, py);
            ctx.lineTo(px + t * 0.5, py + t * 0.94);
            ctx.lineTo(px + t * 0.92, py);
        }
        ctx.closePath();

        const grad = ctx.createLinearGradient(px, py, px, py + t);
        grad.addColorStop(up ? 0 : 1, '#ffffff');
        grad.addColorStop(up ? 1 : 0, '#ff4d6d');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = '#3d0713';
        ctx.lineWidth = Math.max(t * 0.05, 1);
        ctx.stroke();
    }

    /**
     * Krápník – ledová obdoba hrotu. Není to rovný trojúhelník: hrana se
     * v půlce zalomí, takže rampouch vypadá narostlý, ne vyříznutý.
     */
    drawIcicle(x, y, up) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const py = this.py(y);
        const base = up ? py + t : py;          // odkud krápník roste
        const tip = up ? py + t * 0.04 : py + t * 0.96;
        const mid = base + (tip - base) * 0.45;

        ctx.beginPath();
        ctx.moveTo(px + t * 0.1, base);
        ctx.lineTo(px + t * 0.28, mid);
        ctx.lineTo(px + t * 0.5, tip);
        ctx.lineTo(px + t * 0.7, mid);
        ctx.lineTo(px + t * 0.9, base);
        ctx.closePath();

        const grad = ctx.createLinearGradient(px, base, px, tip);
        grad.addColorStop(0, '#2f8fd0');
        grad.addColorStop(0.55, '#7fd4f5');
        grad.addColorStop(1, '#eafaff');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = '#0d3f63';
        ctx.lineWidth = Math.max(t * 0.04, 1);
        ctx.stroke();

        // Odlesk podél jedné hrany, ať to vypadá jako led
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.lineWidth = Math.max(t * 0.05, 1);
        ctx.beginPath();
        ctx.moveTo(px + t * 0.38, base + (tip - base) * 0.15);
        ctx.lineTo(px + t * 0.5, tip);
        ctx.stroke();
    }

    /**
     * Plamen – ohnivá obdoba hrotu ze země. Kmitá a protahuje se v čase, každý
     * po svém (fáze podle políčka). Šířkou i výškou zůstává v mezích políčka,
     * aby kresba odpovídala tomu, co je opravdu smrtící.
     */
    drawFlame(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const cx = this.px(x + 0.5);
        const base = this.py(y + 1);
        const phase = noise(x * 7 + y * 13) * TAU;
        const sway = Math.sin(this.clock * 5 + phase) * t * 0.12;
        const stretch = 0.88 + 0.12 * Math.sin(this.clock * 8.5 + phase * 1.7);

        // Záře pod plamenem
        const glow = ctx.createRadialGradient(cx, base - t * 0.35, 0, cx, base - t * 0.35, t * 0.8);
        glow.addColorStop(0, 'rgba(255, 140, 40, 0.35)');
        glow.addColorStop(1, 'rgba(255, 110, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - t * 0.8, base - t * 1.15, t * 1.6, t * 1.6);

        flamePath(ctx, cx, base, t * 0.42, t * 0.94 * stretch, sway);
        const outer = ctx.createLinearGradient(0, base, 0, base - t);
        outer.addColorStop(0, '#ffb703');
        outer.addColorStop(0.45, '#ff6b1a');
        outer.addColorStop(1, '#d61f00');
        ctx.fillStyle = outer;
        ctx.fill();

        // Jádro plamene kmitá rychleji než obal
        const coreSway = sway * 1.4 + Math.sin(this.clock * 11 + phase) * t * 0.05;
        flamePath(ctx, cx, base, t * 0.2, t * 0.55 * stretch, coreSway);
        const core = ctx.createLinearGradient(0, base, 0, base - t * 0.55);
        core.addColorStop(0, '#fffbe6');
        core.addColorStop(1, 'rgba(255, 214, 102, 0.85)');
        ctx.fillStyle = core;
        ctx.fill();
    }

    /**
     * Malá sopka – ohnivá obdoba hrotu ze stropu. Visí kuželem dolů,
     * z ústí žhne láva a odkapává.
     */
    drawVolcano(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const py = this.py(y);
        const cx = px + t * 0.5;
        const crater = py + t * 0.8;             // ústí míří dolů, k zemi
        const phase = noise(x * 11 + y * 23) * TAU;
        const pulse = 0.65 + 0.35 * Math.sin(this.clock * 4 + phase);

        // Záře z ústí – kužel je tmavý, jinak by v tmavém pozadí zanikl
        const glow = ctx.createRadialGradient(cx, crater, 0, cx, crater, t * (0.55 + 0.1 * pulse));
        glow.addColorStop(0, 'rgba(255, 140, 30, 0.45)');
        glow.addColorStop(1, 'rgba(255, 110, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(px - t * 0.5, crater - t * 0.7, t * 2, t * 1.4);

        ctx.beginPath();
        ctx.moveTo(px + t * 0.04, py);
        ctx.lineTo(px + t * 0.3, crater);
        ctx.lineTo(px + t * 0.7, crater);
        ctx.lineTo(px + t * 0.96, py);
        ctx.closePath();

        const rock = ctx.createLinearGradient(0, py, 0, crater);
        rock.addColorStop(0, '#5a3b31');
        rock.addColorStop(0.65, '#3a221e');
        rock.addColorStop(1, '#241211');
        ctx.fillStyle = rock;
        ctx.fill();
        ctx.strokeStyle = '#160a0a';
        ctx.lineWidth = Math.max(t * 0.05, 1);
        ctx.stroke();

        // Praskliny v čedičovém kuželi prosvítají žhavě
        ctx.strokeStyle = `rgba(255, 120, 30, ${0.35 + pulse * 0.3})`;
        ctx.lineWidth = Math.max(t * 0.04, 1);
        ctx.beginPath();
        ctx.moveTo(px + t * 0.3, py + t * 0.12);
        ctx.lineTo(px + t * 0.42, py + t * 0.5);
        ctx.moveTo(px + t * 0.72, py + t * 0.2);
        ctx.lineTo(px + t * 0.6, crater - t * 0.1);
        ctx.stroke();

        // Rozžhavené ústí – vnější lem a jasné jádro
        ctx.fillStyle = `rgba(255, ${Math.round(110 + 80 * pulse)}, 30, ${0.75 + 0.25 * pulse})`;
        ctx.beginPath();
        ctx.ellipse(cx, crater, t * 0.23, t * 0.08 + t * 0.02 * pulse, 0, 0, TAU);
        ctx.fill();

        ctx.fillStyle = `rgba(255, 240, 190, ${0.65 + 0.35 * pulse})`;
        ctx.beginPath();
        ctx.ellipse(cx, crater, t * 0.11, t * 0.04, 0, 0, TAU);
        ctx.fill();

        // Kapky lávy stékající z ústí (jen kousek, ať se nepletou s překážkou)
        for (let i = 0; i < 2; i++) {
            const drop = (this.clock * 0.8 + noise(x * 5 + y * 31 + i * 17)) % 1;
            const dx = cx + (i ? 1 : -1) * t * 0.09;
            const dy = crater + drop * t * 0.22;
            ctx.globalAlpha = 1 - drop;
            ctx.fillStyle = '#ff8c1a';
            ctx.beginPath();
            ctx.ellipse(dx, dy, t * 0.035, t * 0.06, 0, 0, TAU);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    /**
     * Kaktus – pouštní obdoba hrotu ze země. Tvar (počet a výška ramen, květ)
     * se losuje ze šumu podle políčka, takže je kaktus od kaktusu jiný, ale
     * pořád stejný. Kmen i ramena zůstávají v mezích políčka, stejně jako hrot.
     */
    drawCactus(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const base = this.py(y + 1);
        const cx = px + t * 0.5;
        const top = base - t * 0.94;
        const seed = noise(x * 13 + y * 7);
        const width = t * 0.26;

        // Kmen a ramena jsou jedna tlustá čára se zaoblenými konci
        const body = () => {
            ctx.beginPath();
            ctx.moveTo(cx, base);
            ctx.lineTo(cx, top);
            // Levé rameno má každý kaktus, pravé jen některý (a výš)
            ctx.moveTo(cx, base - t * 0.42);
            ctx.lineTo(cx - t * 0.26, base - t * 0.42);
            ctx.lineTo(cx - t * 0.26, base - t * 0.66);
            if (seed > 0.4) {
                ctx.moveTo(cx, base - t * 0.56);
                ctx.lineTo(cx + t * 0.25, base - t * 0.56);
                ctx.lineTo(cx + t * 0.25, base - t * 0.74);
            }
        };

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        body();
        ctx.strokeStyle = '#14300f';
        ctx.lineWidth = width + Math.max(t * 0.06, 2);
        ctx.stroke();

        const grad = ctx.createLinearGradient(px, 0, px + t, 0);
        grad.addColorStop(0, '#71b155');
        grad.addColorStop(0.45, '#4a8c3c');
        grad.addColorStop(1, '#2c5c2c');
        body();
        ctx.strokeStyle = grad;
        ctx.lineWidth = width;
        ctx.stroke();

        // Žebra kmene a trny
        ctx.strokeStyle = 'rgba(20, 60, 20, 0.45)';
        ctx.lineWidth = Math.max(t * 0.02, 1);
        ctx.beginPath();
        ctx.moveTo(cx - width * 0.22, base - t * 0.06);
        ctx.lineTo(cx - width * 0.22, top + t * 0.06);
        ctx.moveTo(cx + width * 0.22, base - t * 0.06);
        ctx.lineTo(cx + width * 0.22, top + t * 0.08);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(240, 235, 200, 0.7)';
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const sy = base - t * (0.12 + i * 0.2);
            ctx.moveTo(cx - width * 0.5, sy);
            ctx.lineTo(cx - width * 0.78, sy - t * 0.03);
            ctx.moveTo(cx + width * 0.5, sy - t * 0.06);
            ctx.lineTo(cx + width * 0.78, sy - t * 0.09);
        }
        ctx.stroke();

        // Občas kaktus kvete
        if (seed < 0.28) {
            ctx.fillStyle = '#ff6f91';
            ctx.beginPath();
            ctx.arc(cx, top - t * 0.02, width * 0.34, 0, TAU);
            ctx.fill();
        }

        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
    }

    /**
     * Sup – pouštní obdoba hrotu ze stropu. Visí na jednom místě, mává křídly
     * a mírně se přitom houpe; rozpětí i houpání zůstávají v políčku, aby bylo
     * poznat, kudy se pod ním dá proletět. Fáze mávání je daná políčkem, takže
     * každý pták mává po svém, ale pořád stejně.
     *
     * Barvy jsou skoro černé a obrys světlý: překážka musí být na pískovém
     * pozadí vidět na první pohled, stejně jako je vidět rudý hrot.
     */
    drawVulture(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const cx = this.px(x + 0.5);
        const phase = noise(x * 5 + y * 17) * TAU;
        const flap = Math.sin(this.clock * 5.5 + phase);
        const cy = this.py(y) + t * 0.36 + flap * t * 0.04;
        const lift = flap * t * 0.16;

        ctx.strokeStyle = 'rgba(255, 230, 185, 0.5)';
        ctx.lineWidth = Math.max(t * 0.018, 1);
        ctx.lineJoin = 'round';

        // Křídla: od těla k špičce a zpátky spodní hranou (mává se nahoru dolů).
        // Na konci mají roztřepená pera, podle kterých je sup poznat i takhle malý.
        for (const dir of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(cx, cy - t * 0.05);
            ctx.quadraticCurveTo(cx + dir * t * 0.18, cy - t * 0.16 - lift,
                cx + dir * t * 0.34, cy - t * 0.13 - lift);
            ctx.lineTo(cx + dir * t * 0.45, cy - t * 0.12 - lift);
            ctx.lineTo(cx + dir * t * 0.36, cy - t * 0.09 - lift);
            ctx.lineTo(cx + dir * t * 0.45, cy - t * 0.07 - lift);
            ctx.lineTo(cx + dir * t * 0.34, cy - t * 0.05 - lift);
            ctx.quadraticCurveTo(cx + dir * t * 0.17, cy - t * 0.01 - lift * 0.5, cx, cy + t * 0.04);
            ctx.closePath();

            const feather = ctx.createLinearGradient(cx, cy - t * 0.16 - lift, cx, cy + t * 0.04);
            feather.addColorStop(0, '#3b2a1d');
            feather.addColorStop(1, '#16100a');
            ctx.fillStyle = feather;
            ctx.fill();
            ctx.stroke();
        }

        // Ocasní pera vzadu (kostka přibíhá zleva, sup je otočený proti ní)
        ctx.fillStyle = '#1b130c';
        ctx.beginPath();
        ctx.moveTo(cx + t * 0.08, cy - t * 0.04);
        ctx.lineTo(cx + t * 0.27, cy + t * 0.03);
        ctx.lineTo(cx + t * 0.08, cy + t * 0.07);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Tělo
        ctx.fillStyle = '#241a11';
        ctx.beginPath();
        ctx.ellipse(cx, cy, t * 0.13, t * 0.085, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();

        // Bílý límec a holá hlava supa
        ctx.fillStyle = '#e6dcc4';
        ctx.beginPath();
        ctx.arc(cx - t * 0.1, cy - t * 0.02, t * 0.048, 0, TAU);
        ctx.fill();

        ctx.fillStyle = '#c4705a';
        ctx.beginPath();
        ctx.arc(cx - t * 0.17, cy - t * 0.06, t * 0.05, 0, TAU);
        ctx.fill();

        // Zahnutý zobák a oko
        ctx.fillStyle = '#e8c07a';
        ctx.beginPath();
        ctx.moveTo(cx - t * 0.21, cy - t * 0.085);
        ctx.lineTo(cx - t * 0.29, cy - t * 0.04);
        ctx.lineTo(cx - t * 0.2, cy - t * 0.02);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#1b1109';
        ctx.beginPath();
        ctx.arc(cx - t * 0.175, cy - t * 0.08, Math.max(t * 0.014, 1), 0, TAU);
        ctx.fill();

        ctx.lineJoin = 'miter';
    }

    /**
     * Blok matematického světa: dlaždice rozdělená na čtyři pole jako políčko
     * rýsovacího papíru, na ní bledě narýsovaný symbol. Který to je, plyne
     * z `variant`, a ta ze souřadnic políčka – při posunu kamery se tedy
     * symboly nepřeskládají a zeď zůstane pořád stejná.
     */
    paintMathBlock(ctx, variant, capped) {
        const t = this.tile;
        const s = this.blockSize;
        const h = this.hue;

        const grad = ctx.createLinearGradient(0, 0, 0, t);
        grad.addColorStop(0, `hsl(${h}, 42%, 17%)`);
        grad.addColorStop(1, `hsl(${h + 10}, 45%, 10%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);

        // Vnitřní rastr dlaždice
        ctx.strokeStyle = `hsla(${h + 30}, 70%, 75%, 0.12)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(t * 0.5, 0);
        ctx.lineTo(t * 0.5, t);
        ctx.moveTo(0, t * 0.5);
        ctx.lineTo(t, t * 0.5);
        ctx.stroke();

        // Symbol vyrytý do bloku – jen naznačený, ať nepřebije překážky
        ctx.strokeStyle = `hsla(${h + 40}, 85%, 82%, 0.2)`;
        ctx.lineWidth = Math.max(t * 0.045, 1);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        mathGlyph(ctx, BLOCK_GLYPHS[variant % BLOCK_GLYPHS.length], t * 0.5, t * 0.5, t * 0.52);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';

        ctx.strokeStyle = `hsl(${h + 25}, 85%, 74%)`;
        ctx.lineWidth = Math.max(t * 0.06, 1.5);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);

        // Horní hrana bloku je světlejší – lépe je vidět, kam se dá doskočit
        if (!capped) {
            ctx.fillStyle = `hsl(${h + 30}, 95%, 82%)`;
            ctx.fillRect(0, 0, s, Math.max(t * 0.1, 2));
        }
    }

    /**
     * Operátor Δ (ze země) a ∇ (ze stropu) – matematická obdoba hrotu.
     * Trojúhelník je narýsovaný jako v učebnici: rysky shodnosti na stranách
     * a oblouček úhlu u špičky. Barva zůstane výstražná (jako u hrotů), aby
     * bylo i v bledém pozadí hned poznat, co zabíjí.
     */
    drawOperator(x, y, up) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const py = this.py(y);
        const base = up ? py + t : py;              // strana přiléhající k podkladu
        const tip = up ? py + t * 0.06 : py + t * 0.94;
        const left = px + t * 0.08;
        const right = px + t * 0.92;
        const mid = px + t * 0.5;

        // Záře pod operátorem, ať nesplyne s narýsovaným pozadím
        const glow = ctx.createRadialGradient(mid, (base + tip) / 2, 0, mid, (base + tip) / 2, t * 0.8);
        glow.addColorStop(0, 'rgba(255, 77, 109, 0.3)');
        glow.addColorStop(1, 'rgba(255, 77, 109, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(px - t * 0.3, py - t * 0.1, t * 1.6, t * 1.2);

        ctx.beginPath();
        ctx.moveTo(left, base);
        ctx.lineTo(mid, tip);
        ctx.lineTo(right, base);
        ctx.closePath();

        const grad = ctx.createLinearGradient(px, base, px, tip);
        grad.addColorStop(0, 'rgba(120, 12, 40, 0.85)');
        grad.addColorStop(1, 'rgba(255, 120, 150, 0.9)');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = '#ff4d6d';
        ctx.lineWidth = Math.max(t * 0.06, 1.5);
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Rysky shodnosti na obou ramenech a oblouček úhlu u špičky
        ctx.strokeStyle = 'rgba(255, 235, 240, 0.8)';
        ctx.lineWidth = Math.max(t * 0.035, 1);
        ctx.beginPath();
        for (const dir of [-1, 1]) {
            const ax = mid + dir * (right - mid) * 0.5;
            const ay = (base + tip) / 2;
            ctx.moveTo(ax - t * 0.05 * dir, ay - t * 0.05);
            ctx.lineTo(ax + t * 0.05 * dir, ay + t * 0.05);
        }
        const arc = t * 0.22;
        ctx.moveTo(mid - arc * 0.5, tip + (up ? arc : -arc));
        ctx.quadraticCurveTo(mid, tip + (up ? arc * 1.5 : -arc * 1.5),
            mid + arc * 0.5, tip + (up ? arc : -arc));
        ctx.stroke();
        ctx.lineJoin = 'miter';
    }

    drawPad(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const pulse = 0.85 + 0.15 * Math.sin(this.clock * 6);

        ctx.fillStyle = '#ffd166';
        ctx.strokeStyle = '#8a5a00';
        ctx.lineWidth = Math.max(t * 0.05, 1);
        ctx.beginPath();
        ctx.ellipse(this.px(x + 0.5), this.py(y + 0.82), t * 0.42 * pulse, t * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    drawRing(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const used = this.usedRings.has(`${x},${y}`);
        const pulse = 0.86 + 0.1 * Math.sin(this.clock * 5);

        const cx = this.px(x + 0.5);
        const cy = this.py(y + 0.5);
        const r = t * 0.34 * pulse;

        ctx.strokeStyle = used ? 'rgba(255, 209, 102, 0.25)' : '#ffd166';
        ctx.lineWidth = Math.max(t * 0.11, 2);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // V matematickém světě je z prstence křivkový integrál – po obvodu
        // objíždí hrot, který ukazuje orientaci křivky (∮)
        if (this.level.theme === 'math') {
            const angle = this.clock * 1.6;
            const ax = cx + Math.cos(angle) * r;
            const ay = cy + Math.sin(angle) * r;
            const dir = angle + Math.PI / 2;        // hrot míří po tečně
            const s = r * 0.5;

            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.moveTo(ax + Math.cos(dir) * s, ay + Math.sin(dir) * s);
            ctx.lineTo(ax + Math.cos(dir + 2.4) * s, ay + Math.sin(dir + 2.4) * s);
            ctx.lineTo(ax + Math.cos(dir - 2.4) * s, ay + Math.sin(dir - 2.4) * s);
            ctx.closePath();
            ctx.fill();
        }
    }

    drawPortal(x, y, up) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const py = this.py(y);

        const grad = ctx.createLinearGradient(px, py, px + t, py);
        grad.addColorStop(0, up ? 'rgba(60, 200, 255, 0.15)' : 'rgba(255, 209, 102, 0.15)');
        grad.addColorStop(0.5, up ? 'rgba(60, 200, 255, 0.75)' : 'rgba(255, 209, 102, 0.75)');
        grad.addColorStop(1, up ? 'rgba(60, 200, 255, 0.15)' : 'rgba(255, 209, 102, 0.15)');
        ctx.fillStyle = grad;
        ctx.fillRect(px + t * 0.28, py, t * 0.44, t + 1);

        // Šipka ukazuje, kam bude po průchodu táhnout gravitace
        ctx.fillStyle = '#0b1020';
        const cx = this.px(x + 0.5);
        const cy = this.py(y + 0.5);
        const s = t * 0.17;
        ctx.beginPath();
        ctx.moveTo(cx, cy + (up ? -s : s));
        ctx.lineTo(cx - s, cy + (up ? s : -s));
        ctx.lineTo(cx + s, cy + (up ? s : -s));
        ctx.closePath();
        ctx.fill();
    }

    drawCoin(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        // Mince se "otáčí" – šířka se mění, výška zůstává
        const w = Math.abs(Math.cos(this.clock * 2.5)) * 0.7 + 0.3;
        const cx = this.px(x + 0.5);
        const cy = this.py(y + 0.5);

        ctx.fillStyle = '#ffd166';
        ctx.strokeStyle = '#8a5a00';
        ctx.lineWidth = Math.max(t * 0.04, 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy, t * 0.26 * w, t * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Matematická mince je ražená na π – jen když je zrovna otočená k hráči,
        // jinak by se ražba mačkala do čáry
        if (this.level.theme === 'math' && w > 0.62) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(w, 1);
            ctx.lineWidth = Math.max(t * 0.05, 1.2);
            ctx.lineCap = 'round';
            mathGlyph(ctx, 'pi', 0, 0, t * 0.34);
            ctx.stroke();
            ctx.restore();
        }
    }

    drawFinish() {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(this.level.finishX);
        if (px < -t * 2 || px > this.c.width + t) return;

        // Šachovnicový sloup přes celou výšku mapy
        const cols = 2;
        const rows = (this.level.height - this.level.viewTop) * 2;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#151a2b';
                ctx.fillRect(px + c * t * 0.5, this.py(this.level.viewTop) + r * t * 0.5, t * 0.5 + 1, t * 0.5 + 1);
            }
        }
    }

    drawParticles() {
        const ctx = this.ctx;
        for (const p of this.particles) {
            const k = Math.max(0, p.life / p.max);
            const s = p.size * this.tile;
            ctx.globalAlpha = k;
            ctx.fillStyle = p.color;
            ctx.fillRect(this.px(p.x) - s / 2, this.py(p.y) - s / 2, s, s);
        }
        ctx.globalAlpha = 1;
    }

    // Zakrytí prostoru pod mapou, ať kostka nemizí "do prázdna"
    drawGroundLine() {
        const ctx = this.ctx;
        const bottom = this.py(this.level.height);
        if (bottom >= this.c.height) return;

        ctx.fillStyle = `hsl(${this.hue}, 60%, 5%)`;
        ctx.fillRect(0, bottom, this.c.width, this.c.height - bottom);
    }

    drawHud() {
        const ctx = this.ctx;
        const pad = 12;
        const barH = 12;
        const barW = this.c.width - pad * 2;
        const barY = 8;

        // Ukazatel postupu levelem
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        roundRect(ctx, pad, barY, barW, barH, barH / 2);
        ctx.fill();

        ctx.fillStyle = `hsl(${this.hue}, 90%, 60%)`;
        roundRect(ctx, pad, barY, Math.max(barW * this.progress, barH), barH, barH / 2);
        ctx.fill();

        // Značka nejlepšího dosaženého postupu v tomto levelu
        if (this.best > this.progress) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(pad + barW * this.best - 1, barY - 2, 2, barH + 4);
        }

        ctx.fillStyle = '#fff';
        ctx.font = `600 ${Math.round(barH * 1.15)}px "Courier New", monospace`;
        ctx.textBaseline = 'top';

        // Přepínače v pravém rohu – na dotykových zařízeních zároveň tlačítka.
        // Vibrace se ukazují jen tam, kde je prohlížeč umí (na desktopu by to
        // byl přepínač ničeho).
        const switches = this.haptics.supported ? 2 : 1;
        const textY = barY + barH + 6;

        /*
         * Na telefon se tři texty a dva přepínače do pruhu nevejdou, tak se HUD
         * zkracuje po stupních: nejdřív zmizí procenta (postup ukazuje i pruh
         * nad nimi), pak popisek pokusu a nakonec slovo LEVEL. Čísla zůstanou
         * vždycky – ta jinde v HUD nejsou. Měří se doopravdy, protože šířka
         * textu roste i s počtem pokusů a výší skóre.
         */
        const statsRight = this.c.width - pad - ICON_ZONE * switches;
        // Šířky se pamatují: měřit každý snímek totéž je zbytečné a písmo se
        // mění jen s velikostí okna (tam se mezipaměť zahodí).
        const width = text => {
            let w = this.textWidths.get(text);
            if (w === undefined) {
                // Texty se s pokusy a skóre mění, ať to neroste donekonečna
                if (this.textWidths.size > 200) this.textWidths.clear();
                w = ctx.measureText(text).width;
                this.textWidths.set(text, w);
            }
            return w;
        };
        const coins = `🪙 ${this.coins}/${this.level.coinCount}`;
        const layouts = [
            [`LEVEL ${this.levelIndex + 1}/${this.levels.length}`, `POKUS ${this.attempts} · ${coins} · ${this.score}`],
            [`LEVEL ${this.levelIndex + 1}/${this.levels.length}`, `${this.attempts}× · ${coins} · ${this.score}`],
            [`${this.levelIndex + 1}/${this.levels.length}`, `${this.attempts}× · ${coins} · ${this.score}`],
        ];
        const [level, stats] = layouts.find(([l, s]) => pad + width(l) + pad + width(s) <= statsRight)
            ?? layouts[layouts.length - 1];

        ctx.textAlign = 'left';
        ctx.fillText(level, pad, textY);

        ctx.textAlign = 'right';
        ctx.fillText(stats, statsRight, textY);

        const percent = `${Math.round(this.progress * 100)} %`;
        const half = width(percent) / 2;
        const room = this.c.width / 2 - half > pad + width(level) + pad
            && this.c.width / 2 + half < statsRight - width(stats) - pad;

        if (room) {
            ctx.textAlign = 'center';
            ctx.fillText(percent, this.c.width / 2, textY);
        }

        ctx.textAlign = 'right';
        ctx.globalAlpha = this.sound.muted ? 0.5 : 1;
        ctx.fillText(this.sound.muted ? '🔇' : '🔊', this.c.width - pad, textY);

        if (this.haptics.supported) {
            ctx.globalAlpha = this.haptics.enabled ? 1 : 0.5;
            ctx.fillText('📳', this.c.width - pad - ICON_ZONE, textY);
        }
        ctx.globalAlpha = 1;
    }

    drawOverlay() {
        const ctx = this.ctx;
        let title = null;
        let subtitle = null;

        switch (this.state) {
            case 'ready':
                title = `LEVEL ${this.levelIndex + 1}`;
                subtitle = 'Mezerník / ťuknutí = skok · P = pauza · R = restart · M = zvuk'
                    + (this.haptics.supported ? ' · H = vibrace' : '');
                break;
            case 'paused':
                title = 'PAUZA';
                subtitle = 'Mezerníkem pokračuj';
                break;
            case 'levelComplete':
                title = `LEVEL ${this.levelIndex + 1} HOTOV!`;
                subtitle = `Pokusů: ${this.attempts} · mincí ${this.coins}/${this.level.coinCount} · skóre ${this.score} · mezerníkem dál`;
                break;
            case 'won':
                title = 'DOBĚHL JSI VŠE! 🎉';
                subtitle = `Skóre: ${this.score} · mezerníkem hraj znovu od začátku`;
                break;
        }

        if (!title) return;

        ctx.fillStyle = 'rgba(5, 8, 18, 0.68)';
        ctx.fillRect(0, 0, this.c.width, this.c.height);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#7df9ff';
        ctx.font = `bold ${Math.max(this.tile * 1.6, 34)}px "Courier New", monospace`;
        ctx.fillText(title, this.c.width / 2, this.c.height / 2 - 24);

        ctx.fillStyle = '#fff';
        ctx.font = `${Math.min(Math.max(this.tile * 0.6, 14), this.c.width / 34)}px "Courier New", monospace`;
        ctx.fillText(subtitle, this.c.width / 2, this.c.height / 2 + Math.max(this.tile * 1.2, 28));
    }
}

// Stálé „náhodné“ číslo 0–1 pro dané zadání – aby se kresba mezi snímky
// neměnila, ale přitom nebyla pravidelná (námraza, fáze plamenů, vločky)
function noise(seed) {
    const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return v - Math.floor(v);
}

// Zbytek po dělení, který pro záporná čísla vrací kladnou hodnotu
function wrap(value, size) {
    return ((value % size) + size) % size;
}

/**
 * Cesta plamene: od základny se rozšíří do břicha a sbíhá se do špičky
 * posunuté o `sway` (bez vykreslení – volající si zvolí výplň).
 */
function flamePath(ctx, cx, base, halfWidth, height, sway) {
    const tip = base - height;
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, base);
    ctx.bezierCurveTo(
        cx - halfWidth * 1.15, base - height * 0.45,
        cx + sway - halfWidth * 0.6, base - height * 0.7,
        cx + sway, tip
    );
    ctx.bezierCurveTo(
        cx + sway + halfWidth * 0.6, base - height * 0.7,
        cx + halfWidth * 1.15, base - height * 0.45,
        cx + halfWidth, base
    );
    ctx.closePath();
}

/**
 * Cesta matematického symbolu vepsaná do čtverce o straně `size` se středem
 * [cx, cy] (bez vykreslení – volající si zvolí tah). Symboly jsou rýsované
 * z čar a křivek schválně: písmo by se muselo spolehnout na to, že cizí
 * zařízení má daný znak ve fontu, a jinak by ukázalo prázdný obdélníček.
 */
function mathGlyph(ctx, kind, cx, cy, size) {
    const h = size / 2;
    const w = size * 0.34;
    ctx.beginPath();

    switch (kind) {
        case 'sum':         // ∑ – suma
            ctx.moveTo(cx + w, cy - h);
            ctx.lineTo(cx - w, cy - h);
            ctx.lineTo(cx + w * 0.2, cy);
            ctx.lineTo(cx - w, cy + h);
            ctx.lineTo(cx + w, cy + h);
            break;

        case 'product':     // ∏ – součin
            ctx.moveTo(cx - w * 1.1, cy - h);
            ctx.lineTo(cx + w * 1.1, cy - h);
            ctx.moveTo(cx - w * 0.62, cy - h);
            ctx.lineTo(cx - w * 0.62, cy + h);
            ctx.moveTo(cx + w * 0.62, cy - h);
            ctx.lineTo(cx + w * 0.62, cy + h);
            break;

        case 'contour':     // ∮ – křivkový integrál (integrál s kroužkem)
            ctx.moveTo(cx + w * 0.6, cy);
            ctx.arc(cx, cy, w * 0.6, 0, TAU);
            // dál stejně jako integrál
        case 'integral':    // ∫
            ctx.moveTo(cx + w * 0.9, cy - h);
            ctx.bezierCurveTo(cx + w * 0.1, cy - h * 1.3, cx + w * 0.4, cy - h * 0.3, cx, cy);
            ctx.bezierCurveTo(cx - w * 0.4, cy + h * 0.3, cx - w * 0.1, cy + h * 1.3, cx - w * 0.9, cy + h);
            break;

        case 'root':        // √ – odmocnina i s vodorovnou čarou nad výrazem
            ctx.moveTo(cx - w, cy + h * 0.1);
            ctx.lineTo(cx - w * 0.55, cy + h * 0.6);
            ctx.lineTo(cx - w * 0.1, cy - h);
            ctx.lineTo(cx + w, cy - h);
            break;

        case 'pi':          // π
            ctx.moveTo(cx - w, cy - h * 0.6);
            ctx.lineTo(cx + w, cy - h * 0.6);
            ctx.moveTo(cx - w * 0.45, cy - h * 0.6);
            ctx.lineTo(cx - w * 0.6, cy + h);
            ctx.moveTo(cx + w * 0.45, cy - h * 0.6);
            ctx.lineTo(cx + w * 0.6, cy + h);
            break;

        case 'infinity':    // ∞ – dvě smyčky z jednoho tahu
            ctx.moveTo(cx, cy);
            ctx.bezierCurveTo(cx - w * 0.6, cy - h, cx - w * 1.4, cy - h * 0.5, cx - w * 1.4, cy);
            ctx.bezierCurveTo(cx - w * 1.4, cy + h * 0.5, cx - w * 0.6, cy + h, cx, cy);
            ctx.bezierCurveTo(cx + w * 0.6, cy - h, cx + w * 1.4, cy - h * 0.5, cx + w * 1.4, cy);
            ctx.bezierCurveTo(cx + w * 1.4, cy + h * 0.5, cx + w * 0.6, cy + h, cx, cy);
            break;

        case 'nabla':       // ∇ – gradient
            ctx.moveTo(cx - w * 1.1, cy - h);
            ctx.lineTo(cx + w * 1.1, cy - h);
            ctx.lineTo(cx, cy + h);
            ctx.closePath();
            break;

        case 'delta':       // Δ – přírůstek
            ctx.moveTo(cx - w * 1.1, cy + h);
            ctx.lineTo(cx + w * 1.1, cy + h);
            ctx.lineTo(cx, cy - h);
            ctx.closePath();
            break;

        case 'partial':     // ∂ – parciální derivace
            ctx.ellipse(cx, cy + h * 0.3, w * 0.75, h * 0.62, 0, 0, TAU);
            ctx.moveTo(cx + w * 0.72, cy + h * 0.1);
            ctx.bezierCurveTo(cx + w * 0.8, cy - h * 0.7, cx + w * 0.1, cy - h * 1.05,
                cx - w * 0.6, cy - h * 0.7);
            break;

        case 'phi':         // φ
            ctx.moveTo(cx, cy - h);
            ctx.lineTo(cx, cy + h);
            ctx.moveTo(cx + w * 0.85, cy);
            ctx.ellipse(cx, cy, w * 0.85, h * 0.6, 0, 0, TAU);
            break;

        case 'lambda':      // λ
            ctx.moveTo(cx - w, cy + h);
            ctx.lineTo(cx + w * 0.3, cy - h);
            ctx.lineTo(cx + w, cy + h);
            ctx.moveTo(cx - w * 0.8, cy - h * 0.55);
            ctx.lineTo(cx - w * 0.25, cy + h * 0.1);
            break;
    }
}

// Cesta zaobleného obdélníku (bez vykreslení – volající si zvolí fill/stroke)
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
