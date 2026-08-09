import {Entity} from "./entity.js";
import {CUBE, GRAVITY, JUMP_SPEED, MAX_FALL, ROT_SPEED} from "../physics.js";

const EPS = 1e-6;

// Nejdelší posun v rámci jednoho podkroku (v políčkách) – brání proletění bloku
const MAX_SUBSTEP = 0.15;

/**
 * Kostka, kterou hráč ovládá. Běží pořád doprava konstantní rychlostí,
 * jediný vstup je skok.
 *
 * Pohyb se řeší po osách zvlášť: nejdřív vodorovně, pak svisle.
 * - náraz do bloku při vodorovném posunu = náraz do zdi -> `crashed`
 * - doraz na blok při svislém posunu = přistání (nebo bouchnutí hlavou)
 *
 * `crashed` je jen hlášení hře, že do něčeho narazila – o smrti rozhoduje
 * `Game`, ne kostka sama.
 */
export class Player extends Entity {
    constructor(game, x, y, speed) {
        super(game, x, y);
        this.speed = speed;
    }

    reset() {
        super.reset();
        this.vy = 0;
        this.gravity = 1;    // 1 = dolů, -1 = vzhůru (obrácená gravitace)
        this.onGround = false;
        this.crashed = false;
        this.rotation = 0;
        this.trail = [];     // stopa za kostkou: [{x, y, age}]
    }

    // Skok proti směru gravitace; `strength` je násobek (odrazová plošina > 1)
    jump(strength = 1) {
        this.vy = -this.gravity * JUMP_SPEED * strength;
        this.onGround = false;
    }

    step(dt) {
        super.step(dt);

        // Posun rozdělíme na dost malé podkroky, aby kostka nepřeskočila blok
        const fastest = Math.max(this.speed, Math.abs(this.vy), 1);
        const steps = Math.max(1, Math.ceil(fastest * dt / MAX_SUBSTEP));
        const h = dt / steps;

        for (let i = 0; i < steps; i++) {
            this.#substep(h);
            if (this.crashed) return;
        }

        this.#spin(dt);
        this.#updateTrail(dt);
    }

    #substep(dt) {
        const level = this.game.level;

        this.vy = Math.max(-MAX_FALL, Math.min(MAX_FALL, this.vy + this.gravity * GRAVITY * dt));

        // ---- vodorovně ----
        this.x += this.speed * dt;
        if (this.#overlapsSolid(level)) {
            this.crashed = true;
            return;
        }

        // ---- svisle ----
        const half = CUBE / 2;
        this.y += this.vy * dt;
        this.onGround = false;

        if (this.#overlapsSolid(level)) {
            if (this.vy > 0) {
                // Padáme dolů -> spodní hrana dosedla na horní hranu bloku
                this.y = Math.floor(this.y + half) - half;
                this.onGround = this.gravity > 0;
            } else if (this.vy < 0) {
                // Letíme vzhůru -> horní hrana narazila na spodek bloku
                this.y = Math.floor(this.y - half) + 1 + half;
                this.onGround = this.gravity < 0;
            }
            this.vy = 0;
        }
    }

    // Překrývá se kostka s nějakým pevným blokem?
    #overlapsSolid(level) {
        const half = CUBE / 2;
        const x0 = Math.floor(this.x - half + EPS);
        const x1 = Math.floor(this.x + half - EPS);
        const y0 = Math.floor(this.y - half + EPS);
        const y1 = Math.floor(this.y + half - EPS);

        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                if (level.isSolid(x, y)) return true;
            }
        }
        return false;
    }

    // Ve vzduchu se kostka točí, na zemi se srovná na nejbližší pravý úhel
    #spin(dt) {
        if (this.onGround) {
            const q = Math.PI / 2;
            this.rotation = Math.round(this.rotation / q) * q;
        } else {
            this.rotation += this.gravity * ROT_SPEED * dt;
        }
    }

    #updateTrail(dt) {
        for (const p of this.trail) {
            p.age += dt;
        }
        this.trail = this.trail.filter(p => p.age < 0.35);
        this.trail.push({x: this.x, y: this.y, age: 0});
    }

    draw(ctx, cx, cy, size) {
        const s = size * CUBE;
        const r = s * 0.18;

        // Stopa za kostkou – slábnoucí čtverečky
        for (const p of this.trail) {
            const k = 1 - p.age / 0.35;
            const ts = s * 0.5 * k;
            ctx.fillStyle = `rgba(120, 240, 255, ${(k * 0.28).toFixed(3)})`;
            ctx.fillRect(
                cx + (p.x - this.x) * size - ts / 2,
                cy + (p.y - this.y) * size - ts / 2,
                ts, ts
            );
        }

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.rotation);

        // Tělo kostky
        const grad = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
        grad.addColorStop(0, '#7df9ff');
        grad.addColorStop(1, '#1a7fd4');
        ctx.fillStyle = grad;
        roundRect(ctx, -s / 2, -s / 2, s, s, r);
        ctx.fill();

        ctx.lineWidth = Math.max(size * 0.06, 1.5);
        ctx.strokeStyle = '#04263f';
        ctx.stroke();

        // Vnitřní čtverec jako "obličej"
        ctx.fillStyle = '#04263f';
        roundRect(ctx, -s * 0.22, -s * 0.22, s * 0.44, s * 0.44, r * 0.6);
        ctx.fill();

        ctx.fillStyle = '#7df9ff';
        const eye = s * 0.09;
        ctx.fillRect(-s * 0.14, -s * 0.1, eye, eye);
        ctx.fillRect(s * 0.05, -s * 0.1, eye, eye);

        ctx.restore();
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
