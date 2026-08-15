import {Theme, WEATHER_COUNT} from "../theme.js";
import {TAU, noise, wrap} from "../draw.js";
import {SCALE} from "../audio.js";

/**
 * Ledová jeskyně. Hroty jsou krápníky, bloky namrzlé se sněhem na volné horní
 * hraně a pozadím padá sníh. Hudba jsou pomalé zvonky nad ležící plochou,
 * s dlouhou ozvěnou jeskyně.
 */
export class Ice extends Theme {
    name() {
        return 'ice';
    }

    hue() {
        return 194;
    }

    // Obloha s mřížkou jako bez tématu, jen jí padá sníh
    drawBackground() {
        super.drawBackground();
        this.drawSnow();
    }

    /**
     * Padající sníh. Polohy se počítají z hodin a stálého šumu podle pořadí
     * vločky, takže není potřeba držet stav – přežije to i změnu velikosti okna.
     */
    drawSnow() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        for (let i = 0; i < WEATHER_COUNT; i++) {
            // Bližší vločky jsou větší, rychlejší a víc se posouvají s kamerou
            const depth = 0.35 + noise(i) * 0.65;
            const y = (noise(i + 101) * h + this.clock * 32 * depth) % h;
            // Vločka se cestou dolů kolébá do stran (dvě sinusovky, ať to není
            // pravidelné kyvadlo). Do stran se nesmí hnát rychleji, než padá –
            // to už není sníh.
            const drift = (Math.sin(this.clock * 0.75 + i) * 26
                + Math.sin(this.clock * 1.9 + i * 1.7) * 7) * depth;
            const x = wrap(noise(i + 7) * w + drift - this.camX * this.tile * 0.12 * depth, w);
            const r = depth * Math.max(1.2, this.tile * 0.038);

            ctx.globalAlpha = 0.25 + depth * 0.5;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    /**
     * Namrzlý blok. Námraza se počítá ze `variant` (a ta ze souřadnic políčka),
     * takže je pro dané místo stálá a při posunu kamery neposkakuje.
     */
    paintBlock(ctx, variant, capped) {
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

    // Ze země i ze stropu roste týž krápník, jen obráceně
    drawSpikeUp(x, y) {
        this.drawIcicle(x, y, true);
    }

    drawSpikeDown(x, y) {
        this.drawIcicle(x, y, false);
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

    // Ledová jeskyně – pomalé zvonky, ležící plocha, praskání ledu místo virblu
    audio() {
        return {
            arrange: 'ice',
            melody: 'bells',
            bpm: 100,
            scales: [SCALE.kumoi, SCALE.aeolian, SCALE.inSen, SCALE.harmonic],
            progressions: [
                [0, 0, 8, 8, 5, 5, 3, 3],
                [0, 0, 0, 0, 10, 10, 7, 7],
                [0, 0, 5, 5, 3, 3, 10, 10],
                [0, 0, 7, 7, 8, 8, 3, 3],
            ],
            roots: [3, 8, 5, 10],
            chord: [0, 3, 7, 10, 14],   // mollová nóna – rozlehlá a studená
            arp: [0, 3, 7, 12],
            cutoff: [2000, 3800, 7000], // sklo se leskne i v klidu
            gain: [0.52, 0.62, 0.72],   // řídké aranžmá potřebuje víc hlasitosti než hustá
            leadGain: 0.50,
            delay: {steps: 6, feedback: 0.52, mix: 0.60},   // dlouhá ozvěna jeskyně
        };
    }
}
