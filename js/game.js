import {Level} from "./level.js";
import {Player} from "./entities/player.js";
import {Saw, SAW_RADIUS} from "./entities/saw.js";
import {BASE_SPEED, CUBE, HIT, PAD_BOOST} from "./physics.js";
import {buildKeyMap, actionForEvent} from "./input.js";

// Výška horního pruhu s ukazatelem postupu a statistikami (px)
const HUD = 54;

// Minimální počet políček viditelných na šířku – aby šlo reagovat na překážky
const MIN_VIEW_TILES = 18;

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
        this.level = new Level(base.speed, ...base.rows);

        const speed = BASE_SPEED * this.level.speed / 100;
        this.player = new Player(this, this.level.playerSpawn.x + 0.5, this.level.playerSpawn.y + 0.5, speed);
        this.saws = this.level.sawSpawns.map(s => new Saw(this, s.x + 0.5, s.y + 0.5));

        this.usedRings = new Set();  // "x,y" prstenců využitých v tomto pokusu
        this.coins = 0;
        this.startX = this.player.x;
        this.progress = 0;
        this.particles.length = 0;
        this.camX = 0;

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
        const press = (clientY) => {
            this.handleAction(clientY < HUD ? 'pause' : 'jump');
        };

        this.c.addEventListener('touchstart', e => {
            e.preventDefault();
            press(e.changedTouches[0].clientY);
        }, {passive: false});

        this.c.addEventListener('touchmove', e => e.preventDefault(), {passive: false});

        this.c.addEventListener('touchend', e => {
            e.preventDefault();
            this.handleRelease('jump');
        }, {passive: false});

        this.c.addEventListener('mousedown', e => press(e.clientY));
        window.addEventListener('mouseup', () => this.handleRelease('jump'));
    }

    // Skok ze země, nebo ve vzduchu z prstence
    tryJump() {
        if (this.player.onGround) {
            this.player.jump();
            return;
        }

        const ring = this.ringUnderPlayer();
        if (ring) {
            this.usedRings.add(ring);
            this.player.jump();
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
    }

    loop(now) {
        const dt = Math.min((now - this.lastTime) / 1000, 0.05);
        this.lastTime = now;

        this.update(dt);
        this.render();

        requestAnimationFrame(t => this.loop(t));
    }

    update(dt) {
        this.clock += dt;
        this.updateParticles(dt);
        this.saws.forEach(s => s.step(dt));

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

        // Držené tlačítko skáče znovu hned po dopadu (jako v Geometry Dash)
        if (this.holdJump && this.player.onGround) this.player.jump();

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
        for (const {x, y} of this.nearbyTiles()) {
            const trigger = this.level.triggerAt(x, y);
            if (!trigger || !this.overlaps(CUBE, x, y, x + 1, y + 1)) continue;

            switch (trigger) {
                case 'pad':
                    this.player.jump(PAD_BOOST);
                    break;
                case 'gravityDown':
                    this.player.gravity = 1;
                    break;
                case 'gravityUp':
                    this.player.gravity = -1;
                    break;
                // 'ring' se aktivuje až stiskem – viz tryJump()
            }
        }
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

        // Pily jsou kulaté – měříme vzdálenost od nejbližšího bodu hitboxu
        const half = HIT / 2;
        for (const saw of this.saws) {
            const dx = Math.max(Math.abs(saw.x - this.player.x) - half, 0);
            const dy = Math.max(Math.abs(saw.y - this.player.y) - half, 0);
            if (dx * dx + dy * dy < (SAW_RADIUS * 0.85) ** 2) return true;
        }

        return false;
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

    // Barevný odstín se s každým levelem posouvá – každý level vypadá jinak
    get hue() {
        return (205 + this.levelIndex * 31) % 360;
    }

    render() {
        this.drawBackground();
        this.drawLevel();
        this.saws.forEach(s => s.draw(this.ctx, this.px(s.x), this.py(s.y), this.tile));

        if (this.state !== 'dying') {
            this.player.draw(this.ctx, this.px(this.player.x), this.py(this.player.y), this.tile);
        }

        this.drawParticles();
        this.drawGroundLine();
        this.drawHud();
        this.drawOverlay();
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
    }

    drawLevel() {
        const from = Math.max(0, Math.floor(this.camX) - 1);
        const to = Math.min(this.level.width, Math.ceil(this.camX + this.viewTiles()) + 1);

        for (let y = this.level.viewTop; y < this.level.height; y++) {
            for (let x = from; x < to; x++) {
                if (this.level.isSolid(x, y)) this.drawBlock(x, y);

                const hazard = this.level.hazardAt(x, y);
                if (hazard) this.drawSpike(x, y, hazard === 'spikeUp');

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
            this.c.width - pad, barY + barH + 6
        );
    }

    drawOverlay() {
        const ctx = this.ctx;
        let title = null;
        let subtitle = null;

        switch (this.state) {
            case 'ready':
                title = `LEVEL ${this.levelIndex + 1}`;
                subtitle = 'Mezerník / ťuknutí = skok · P = pauza · R = restart';
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
