import {Theme, WEATHER_COUNT} from "../theme.js";
import {TAU, noise, wrap} from "../draw.js";
import {SCALE} from "../audio.js";

/**
 * Sopečná sloj. Hroty ze země jsou plameny, ze stropu visí malé sopky, pod
 * mapou teče lávová řeka, od ní stoupají jiskry a celý hotový obraz se ještě
 * rozvlní horkým vzduchem. Hudba dusá dvojkopákem pod chraplavým riffem
 * a kvintakordy elektrické kytary.
 */
export class Fire extends Theme
{
    name() {
        return 'fire';
    }

    hue() {
        return 14;
    }

    hazy() {
        return true;
    }

    // Obloha s mřížkou jako bez tématu, jen od lávy stoupají jiskry
    drawBackground() {
        super.drawBackground();
        this.drawSparks();
    }

    // Láva teče spodním řádkem mapy, takže se kreslí až přes bloky
    drawForeground() {
        this.drawLava();
    }

    // Pod mapou je láva – tmavý pruh přes spodek plátna by ji jen přikryl
    drawGroundLine() {
    }

    /**
     * Jiskry stoupající od lávy. Polohy se počítají z hodin a stálého šumu
     * podle pořadí jiskry, takže není potřeba držet stav – přežije to i změnu
     * velikosti okna.
     */
    drawSparks() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        for (let i = 0; i < WEATHER_COUNT; i++) {
            // Bližší jiskry jsou větší, rychlejší a víc se posouvají s kamerou
            const depth = 0.35 + noise(i) * 0.65;
            const travel = (noise(i + 101) * h + this.clock * 55 * depth) % h;
            const drift = Math.sin(this.clock * 1.6 + i) * 14 * depth;
            const x = wrap(noise(i + 7) * w + drift - this.camX * this.tile * 0.12 * depth, w);
            const r = depth * Math.max(1.2, this.tile * 0.028);

            // Jiskra ke konci cesty vzhůru vyhasíná
            ctx.globalAlpha = (0.25 + depth * 0.5) * Math.max(0, 1 - travel / h);
            ctx.fillStyle = `hsl(${25 + noise(i + 55) * 20}, 100%, ${60 + depth * 20}%)`;
            ctx.beginPath();
            ctx.arc(x, h - travel, r, 0, TAU);
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
        const w = this.width;
        const h = this.height;
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

    drawSpikeUp(x, y) {
        this.drawFlame(x, y);
    }

    drawSpikeDown(x, y) {
        this.drawVolcano(x, y);
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

    // Sopečná sloj – chraplavá basa, dvojkopák, kytarové kvintakordy, opakovaný
    // riff a uhlíky v pozadí
    audio() {
        return {
            arrange: 'fire',
            melody: 'riff',
            bpm: 142,
            scales: [SCALE.phrygian, SCALE.locrian, SCALE.hijaz, SCALE.blues],
            progressions: [
                [0, 0, 1, 0, 0, 0, 6, 7],
                [0, 1, 0, 6, 0, 1, 8, 7],
                [0, 0, 0, 3, 0, 0, 1, 6],
                [0, 3, 1, 0, 0, 3, 6, 1],
            ],
            roots: [0, 2, 1, 3],        // nízko, ať to duní
            chord: [0, 7, 12],          // kvintakord bez tercie – hrubá síla
            arp: [12, 8, 7, 3],
            cutoff: [1200, 2600, 5200],
            // O 1 dB níž, než bylo před přidáním kytary: aparát sám o sobě
            // přidal do součtu tolik, že by špička ohně nenechala rezervu
            // efektům (změřeno `tools/mixtest.mjs`)
            gain: [0.44, 0.57, 0.70],
            leadGain: 0.40,
            delay: {steps: 2, feedback: 0.18, mix: 0.25},   // těsná ozvěna, ať se riff nerozmaže
        };
    }
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
