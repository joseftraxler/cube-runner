import {Level} from "./level.js";
import {Player} from "./entities/player.js";
import {Saw, SAW_RADIUS} from "./entities/saw.js";
import {Orbiter, BALL_RADIUS} from "./entities/orbiter.js";
import {BASE_SPEED, CUBE, HIT, PAD_BOOST} from "./physics.js";
import {buildKeyMap, actionForEvent} from "./input.js";
import {Sound} from "./audio.js";
import {Haptics} from "./haptics.js";
import {themeFor} from "./themes/registry.js";
import {noise, wrap} from "./draw.js";

// Výška horního pruhu s ukazatelem postupu a statistikami (px)
const HUD = 54;

// Minimální počet políček viditelných na šířku – aby šlo reagovat na překážky
const MIN_VIEW_TILES = 18;

// Šířka pruhu jednoho přepínače vpravo nahoře (px) – v rohu je zvuk,
// hned vedle vibrace. Ikona se kreslí do stejného pruhu, do kterého se ťuká.
const ICON_ZONE = 44;

// Odkud dolů se obraz vlní horkým vzduchem (podíl výšky plátna). Horko stoupá
// od lávy a od písku, takže horní část obrazu se vlnit nemusí – a nemusí se
// tam ani přepočítávat, což je na slabších zařízeních to hlavní.
const HAZE_FROM = 0.45;

// Kolik různých podob bloku se předkreslí do dlaždic. Podoba se vybírá ze
// souřadnic políčka, takže je pro dané místo stálá (jako dřív šum) – jen se
// po dvanácti blocích opakuje, což mezi sousedy není poznat.
const BLOCK_VARIANTS = 12;

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
        // Prostředí levelu – od téhle chvíle se hra na téma neptá jménem,
        // ale voláním metody (odstín, kresba pozadí, hroty, motiv hudby)
        this.theme = themeFor(this.level.theme, this);

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

        // Motiv hudby si vybírá prostředí – led zní jinak než oheň
        this.sound.setTrack(this.levelIndex, this.level.speed, this.theme.audio());

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
        if (this.theme.hazy()) {
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
        const key = `${this.theme.name()}|${this.hue}|${this.tile}|${this.c.width}×${this.c.height}`;
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

    // Barevný odstín levelu. Určuje ho prostředí (`Theme.hue`) – bez tématu se
    // s každým levelem posouvá, se tématem si ho svět drží sám. HUD, tma pod
    // mapou i dlaždice bloků se pak barví podle něj.
    get hue() {
        return this.theme.hue();
    }

    render() {
        this.drawWorld();
        // V horkých tématech se spodek hotového obrazu ještě rozvlní horkým
        // vzduchem. HUD a překryv jdou až po tom, ať se texty nevlní.
        if (this.theme.hazy() && this.hazeCtx) this.drawHeatHaze();

        this.drawHud();
        this.drawOverlay();
    }

    /**
     * Všechno, co patří do herního světa (a co se v horkých tématech vlní).
     * Prostředí kreslí kulisy, hra rozhoduje, **kdy** a kam se co vykreslí:
     * pozadí je vzadu, mapa nad ním, vrstva prostředí přes ni (lávová řeka)
     * a teprve pak překážky a kostka – ty musí být vidět za všech okolností.
     */
    drawWorld() {
        this.theme.drawBackground();
        this.drawLevel();
        this.theme.drawForeground();
        this.saws.forEach(s => s.draw(this.ctx, this.px(s.x), this.py(s.y), this.tile));
        this.orbiters.forEach(o => o.draw(this.ctx, this.px(o.x), this.py(o.y), this.tile));

        if (this.state !== 'dying') {
            this.player.draw(this.ctx, this.px(this.player.x), this.py(this.player.y), this.tile);
        }

        this.drawParticles();
        this.theme.drawGroundLine();
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
        // Jak silně se vlní, ví prostředí – nad pouští je to míň než nad ohněm
        const amp = Math.max(1, this.tile * this.theme.hazeAmplitude());

        this.hazeCtx.drawImage(this.c, 0, from, w, h - from, 0, 0, w, h - from);

        for (let y = from; y < h; y += band) {
            const src = Math.min(band, h - y);
            const rise = (y - from) / (h - from);      // dole plná výchylka, nahoře nulová
            const dx = Math.round(Math.sin(this.clock * 2 + y * 0.04) * amp * rise);
            if (dx) ctx.drawImage(this.haze, 0, y - from, w, src, dx, y, w, src);
        }
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

    drawLevel() {
        const from = Math.max(0, Math.floor(this.camX) - 1);
        const to = Math.min(this.level.width, Math.ceil(this.camX + this.viewTiles()) + 1);

        for (let y = this.level.viewTop; y < this.level.height; y++) {
            for (let x = from; x < to; x++) {
                if (this.level.isSolid(x, y)) this.drawBlock(x, y);

                const hazard = this.level.hazardAt(x, y);
                if (hazard === 'spikeUp') this.theme.drawSpikeUp(x, y);
                else if (hazard) this.theme.drawSpikeDown(x, y);

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

    // Nechá prostředí vykreslit jednu podobu bloku do samostatného plátna
    bakeBlock(variant, capped) {
        const pad = this.blockPad;
        const tile = document.createElement('canvas');
        tile.width = this.blockSize;
        tile.height = this.blockSize + pad;

        const ctx = tile.getContext('2d');
        ctx.translate(0, pad);          // kresba počítá s levým horním rohem políčka
        this.theme.paintBlock(ctx, variant, capped);
        return tile;
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

        // Kroužek vypadá všude stejně – že se z něj skáče, musí být poznat
        // na první pohled. Prostředí k němu smí přidat jen ozdobu.
        const color = used ? 'rgba(255, 209, 102, 0.25)' : '#ffd166';
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(t * 0.11, 2);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        this.theme.decorateRing(cx, cy, r, color);
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

        const ink = '#8a5a00';
        ctx.fillStyle = '#ffd166';
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(t * 0.04, 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy, t * 0.26 * w, t * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        this.theme.decorateCoin(cx, cy, w, ink);
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
