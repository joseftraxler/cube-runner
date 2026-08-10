import {Level} from "./level.js";
import {Player} from "./entities/player.js";
import {Saw, SAW_RADIUS} from "./entities/saw.js";
import {Orbiter, BALL_RADIUS} from "./entities/orbiter.js";
import {BASE_SPEED, CUBE, HIT, PAD_BOOST} from "./physics.js";
import {buildKeyMap, actionForEvent} from "./input.js";
import {Sound} from "./audio.js";

// Výška horního pruhu s ukazatelem postupu a statistikami (px)
const HUD = 54;

// Minimální počet políček viditelných na šířku – aby šlo reagovat na překážky
const MIN_VIEW_TILES = 18;

// Šířka rohu vpravo nahoře, kterým se ťuknutím přepíná zvuk (px)
const MUTE_ZONE = 44;

const TAU = Math.PI * 2;

// Kolik vloček sněhu / jisker nad lávou má prostředí v pozadí
const WEATHER_COUNT = 90;

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
        this.sound = new Sound();

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

        this.sound.setTrack(this.levelIndex, this.level.speed);

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
     * Zpracuje stisk jedné akce (jump/pause/restart) – společné pro klávesy,
     * dotyk i myš. Nové vstupy směruj sem, ať se logika neduplikuje.
     */
    handleAction(action) {
        // Zvuk smí naběhnout až po interakci uživatele (autoplay policy)
        this.sound.unlock();

        if (action === 'mute') {
            this.sound.toggleMute();
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
            // pravý roh pruhu = zvuk, zbytek pruhu = pauza
            this.handleAction(clientX > this.c.width - MUTE_ZONE * 1.5 ? 'mute' : 'pause');
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

    // Skok ze země, nebo ve vzduchu z prstence
    tryJump() {
        if (this.player.onGround) {
            this.player.jump();
            this.sound.play('jump');
            return;
        }

        const ring = this.ringUnderPlayer();
        if (ring) {
            this.usedRings.add(ring);
            this.player.jump();
            this.sound.play('ring');
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
        this.sound.play('death');
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

        // Ohnivé téma kreslí svět stranou, aby se dal rozvlnit horkým vzduchem
        if (this.level.theme === 'fire') {
            this.haze ??= document.createElement('canvas');
            this.haze.width = this.c.width;
            this.haze.height = this.c.height;
            this.hazeCtx = this.haze.getContext('2d');
        }
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
            this.sound.play('jump');
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
            this.sound.play(this.state === 'won' ? 'win' : 'complete');
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
                    // Portál se drží stisknutý celý průlet – zvuk jen při změně
                    if (this.player.gravity !== gravity) this.sound.play('portal');
                    this.player.gravity = gravity;
                    break;
                }
                // 'ring' se aktivuje až stiskem – viz tryJump()
            }
        }

        // Plošina odrazí kostku každý snímek dotyku, zaznít má ale jen jednou
        if (pad && pad !== this.padKey) this.sound.play('pad');
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
                this.sound.play('coin');
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
    // Level s tématem si odstín určuje sám (ledový studeně modrý, ohnivý rudý).
    get hue() {
        if (this.level.theme === 'ice') return 194;
        if (this.level.theme === 'fire') return 14;
        return (205 + this.levelIndex * 31) % 360;
    }

    render() {
        // V ohnivém tématu se svět nakreslí stranou a na plátno se přenese
        // rozvlněný horkým vzduchem. HUD a překryv se nevlní, ať jdou číst.
        const hazed = this.level.theme === 'fire' && this.hazeCtx;
        const main = this.ctx;

        if (hazed) this.ctx = this.hazeCtx;
        this.drawWorld();
        if (hazed) {
            this.ctx = main;
            this.drawHeatHaze();
        }

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

    /**
     * Přenese hotový obraz světa po vodorovných pruzích, každý posunutý podle
     * sinusovky – vypadá to jako chvění vzduchu nad ohněm. Dole u lávy se vlní
     * víc než nahoře. Pruh se kreslí o kus širší, aby na krajích nevznikly mezery.
     *
     * Výchylka je schválně sotva znatelná (do zlomku políčka): má to být pocit
     * horka na okraji vidění, ne rozostřená hra – hráč musí přesně vidět, kam skáče.
     */
    drawHeatHaze() {
        const ctx = this.ctx;
        const w = this.c.width;
        const h = this.c.height;
        const band = Math.max(4, Math.round(h / 110));
        const amp = Math.max(1, this.tile * 0.022);
        const pad = amp * 2;

        for (let y = 0; y < h; y += band) {
            const src = Math.min(band, h - y);
            const dx = Math.sin(this.clock * 2 + y * 0.04) * amp * (0.3 + y / h);
            ctx.drawImage(this.haze, 0, y, w, src, dx - pad, y, w + pad * 2, src);
        }
    }

    drawBackground() {
        const ctx = this.ctx;
        const h = this.hue;

        const grad = ctx.createLinearGradient(0, 0, 0, this.c.height);
        grad.addColorStop(0, `hsl(${h}, 55%, 20%)`);
        grad.addColorStop(1, `hsl(${h}, 60%, 7%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.c.width, this.c.height);

        // Mřížka v pozadí se posouvá pomaleji než hra (parallax)
        const t = this.tile * 2;
        const shift = (this.camX * this.tile * 0.35) % t;
        ctx.strokeStyle = `hsla(${h}, 70%, 65%, 0.10)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = -shift; x < this.c.width; x += t) {
            ctx.moveTo(Math.round(x) + 0.5, 0);
            ctx.lineTo(Math.round(x) + 0.5, this.c.height);
        }
        for (let y = ((this.offsetY % t) + t) % t; y < this.c.height; y += t) {
            ctx.moveTo(0, Math.round(y) + 0.5);
            ctx.lineTo(this.c.width, Math.round(y) + 0.5);
        }
        ctx.stroke();

        if (this.level.theme === 'ice') this.drawWeather(false);
        if (this.level.theme === 'fire') this.drawWeather(true);
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
                if (this.level.isSolid(x, y)) {
                    if (this.level.theme === 'ice') this.drawIceBlock(x, y);
                    else this.drawBlock(x, y);
                }

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

    drawBlock(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const py = this.py(y);

        ctx.fillStyle = `hsl(${this.hue}, 45%, 13%)`;
        ctx.fillRect(px, py, t + 1, t + 1);

        ctx.strokeStyle = `hsl(${this.hue}, 85%, 72%)`;
        ctx.lineWidth = Math.max(t * 0.07, 1.5);
        ctx.strokeRect(px + ctx.lineWidth / 2, py + ctx.lineWidth / 2, t - ctx.lineWidth, t - ctx.lineWidth);

        // Horní hrana bloku je světlejší – lépe je vidět, kam se dá doskočit
        if (!this.level.isSolid(x, y - 1)) {
            ctx.fillStyle = `hsl(${this.hue}, 90%, 78%)`;
            ctx.fillRect(px, py, t + 1, Math.max(t * 0.1, 2));
        }
    }

    /**
     * Namrzlý blok. Kresba je stálá funkce souřadnic políčka (šum podle x, y),
     * takže námraza při posunu kamery neposkakuje.
     */
    drawIceBlock(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const py = this.py(y);

        const grad = ctx.createLinearGradient(px, py, px, py + t);
        grad.addColorStop(0, 'hsl(198, 50%, 29%)');
        grad.addColorStop(1, 'hsl(207, 55%, 14%)');
        ctx.fillStyle = grad;
        ctx.fillRect(px, py, t + 1, t + 1);

        // Šmouhy námrazy
        ctx.strokeStyle = 'rgba(214, 245, 255, 0.32)';
        ctx.lineWidth = Math.max(t * 0.05, 1);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
            const nx = noise(x * 17 + y * 5 + i * 41);
            const ny = noise(x * 3 + y * 29 + i * 13);
            const sx = px + t * (0.14 + nx * 0.6);
            const sy = py + t * (0.16 + ny * 0.6);
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + t * 0.22, sy + t * 0.16);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(190, 235, 255, 0.85)';
        ctx.lineWidth = Math.max(t * 0.07, 1.5);
        ctx.strokeRect(px + ctx.lineWidth / 2, py + ctx.lineWidth / 2, t - ctx.lineWidth, t - ctx.lineWidth);

        // Na volné horní hraně leží sníh – zároveň je líp vidět, kam se doskočí
        if (!this.level.isSolid(x, y - 1)) {
            ctx.fillStyle = '#eaf9ff';
            ctx.fillRect(px, py, t + 1, Math.max(t * 0.12, 2));
            ctx.beginPath();
            for (let i = 0; i < 3; i++) {
                const cx = px + t * (0.2 + i * 0.3);
                const r = t * (0.11 + noise(x * 7 + y + i * 23) * 0.07);
                ctx.moveTo(cx - r, py + t * 0.05);
                ctx.arc(cx, py + t * 0.05, r, Math.PI, 0);
            }
            ctx.fill();
        }
    }

    // Hrot podle tématu: ledový krápník, plamen/sopka v ohnivém, jinak klasický
    drawHazard(x, y, up) {
        if (this.level.theme === 'ice') {
            this.drawIcicle(x, y, up);
        } else if (this.level.theme === 'fire') {
            if (up) this.drawFlame(x, y);
            else this.drawVolcano(x, y);
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

        ctx.strokeStyle = used ? 'rgba(255, 209, 102, 0.25)' : '#ffd166';
        ctx.lineWidth = Math.max(t * 0.11, 2);
        ctx.beginPath();
        ctx.arc(this.px(x + 0.5), this.py(y + 0.5), t * 0.34 * pulse, 0, Math.PI * 2);
        ctx.stroke();
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

        ctx.fillStyle = '#ffd166';
        ctx.strokeStyle = '#8a5a00';
        ctx.lineWidth = Math.max(t * 0.04, 1);
        ctx.beginPath();
        ctx.ellipse(this.px(x + 0.5), this.py(y + 0.5), t * 0.26 * w, t * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
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

        ctx.textAlign = 'left';
        ctx.fillText(`LEVEL ${this.levelIndex + 1}/${this.levels.length}`, pad, barY + barH + 6);

        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(this.progress * 100)} %`, this.c.width / 2, barY + barH + 6);

        ctx.textAlign = 'right';
        ctx.fillText(
            `POKUS ${this.attempts} · 🪙 ${this.coins}/${this.level.coinCount} · ${this.score}`,
            this.c.width - pad - MUTE_ZONE, barY + barH + 6
        );

        // Stav zvuku – na dotykových zařízeních je to zároveň tlačítko
        ctx.textAlign = 'right';
        ctx.globalAlpha = this.sound.muted ? 0.5 : 1;
        ctx.fillText(this.sound.muted ? '🔇' : '🔊', this.c.width - pad, barY + barH + 6);
        ctx.globalAlpha = 1;
    }

    drawOverlay() {
        const ctx = this.ctx;
        let title = null;
        let subtitle = null;

        switch (this.state) {
            case 'ready':
                title = `LEVEL ${this.levelIndex + 1}`;
                subtitle = 'Mezerník / ťuknutí = skok · P = pauza · R = restart · M = zvuk';
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
