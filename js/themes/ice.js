import {Theme, WEATHER_COUNT} from "../theme.js";
import {TAU, noise, roundRect, wrap} from "../draw.js";
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

    // Ze země roste zasněžený stromeček, ze stropu visí rampouch
    drawSpikeUp(x, y) {
        this.drawTree(x, y);
    }

    drawSpikeDown(x, y) {
        this.drawIcicle(x, y);
    }

    /**
     * Zasněžený stromeček – vánoční obdoba hrotu ze země. Tři patra větví
     * odspodu nahoru, na každém leží sníh, na špici svítí hvězda.
     *
     * **Musí být poznat, že zabíjí**, i když je to stromeček: špičky pater
     * proto zůstávají ostré a míří vzhůru jako hroty, sníh na nich svítí bíle
     * proti tmavé jehličí a hvězda ukazuje, kam až se nesmí doskočit. Kresba
     * se drží v mezích políčka, aby odpovídala tomu, co je opravdu smrtící.
     *
     * Náklon a velikost se počítají z `noise` podle políčka, takže je pro dané
     * místo stálý a při posunu kamery neposkakuje.
     */
    drawTree(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const base = this.py(y) + t;
        const cx = px + t * 0.5;
        const seed = noise(x * 7 + y * 13);
        const lean = (seed - 0.5) * t * 0.09;       // každý stromek roste trochu jinak

        // Kmen
        ctx.fillStyle = '#4a2f1c';
        ctx.fillRect(cx - t * 0.055, base - t * 0.15, t * 0.11, t * 0.15);

        // Tři patra větví: odspodu nahoru se zužují a míň se překrývají
        const tiers = [
            {foot: base - t * 0.11, half: t * 0.40, high: t * 0.34},
            {foot: base - t * 0.34, half: t * 0.31, high: t * 0.32},
            {foot: base - t * 0.56, half: t * 0.20, high: t * 0.30},
        ];

        for (const [i, tier] of tiers.entries()) {
            const tip = tier.foot - tier.high;
            const sway = lean * (i + 1) / tiers.length;   // špička se naklání víc než pata

            ctx.beginPath();
            ctx.moveTo(cx - tier.half, tier.foot);
            ctx.lineTo(cx + sway, tip);
            ctx.lineTo(cx + tier.half, tier.foot);
            ctx.closePath();

            const green = ctx.createLinearGradient(cx - tier.half, tip, cx + tier.half, tier.foot);
            green.addColorStop(0, '#2f7d46');
            green.addColorStop(1, '#124c2a');
            ctx.fillStyle = green;
            ctx.fill();
            ctx.strokeStyle = '#07301a';
            ctx.lineWidth = Math.max(t * 0.035, 1);
            ctx.stroke();

            // Sníh leží na spodní hraně patra – tam, kde by zůstal ležet doopravdy
            ctx.beginPath();
            ctx.moveTo(cx - tier.half, tier.foot);
            ctx.lineTo(cx + tier.half, tier.foot);
            ctx.lineTo(cx + tier.half * 0.62, tier.foot - tier.high * 0.22);
            ctx.lineTo(cx + sway * 0.5, tier.foot - tier.high * 0.1);
            ctx.lineTo(cx - tier.half * 0.62, tier.foot - tier.high * 0.24);
            ctx.closePath();
            ctx.fillStyle = 'rgba(238, 250, 255, 0.92)';
            ctx.fill();
        }

        this.drawStar(cx + lean, base - t * 0.92, t * 0.11);
    }

    /** Hvězda na špici stromku – čtyři paprsky, delší svisle než vodorovně. */
    drawStar(cx, cy, r) {
        const ctx = this.ctx;

        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.28, cy - r * 0.28);
        ctx.lineTo(cx + r * 0.8, cy);
        ctx.lineTo(cx + r * 0.28, cy + r * 0.28);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.28, cy + r * 0.28);
        ctx.lineTo(cx - r * 0.8, cy);
        ctx.lineTo(cx - r * 0.28, cy - r * 0.28);
        ctx.closePath();

        // Záře kolem hvězdy, ať je špička vidět i proti padajícímu sněhu
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
        glow.addColorStop(0, 'rgba(255, 226, 120, 0.55)');
        glow.addColorStop(1, 'rgba(255, 210, 80, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);

        ctx.fillStyle = '#ffdf5e';
        ctx.fill();
        ctx.strokeStyle = '#c9971a';
        ctx.lineWidth = Math.max(r * 0.18, 1);
        ctx.stroke();
    }

    /**
     * Rampouch visící ze stropu. Aby vypadal narostlý, a ne jako vyříznutý
     * kužel, drží se tří věcí, kterými se rampouch pozná: je **štíhlý** (u
     * stropu zabírá dvě třetiny políčka a hned se zaškrtí), boky má
     * **zvlněné** – led přirůstá po kapkách, takže má na sobě boule a rýhy –
     * a končí **jehlou** s kapkou. U stropu k tomu drží nálitek zmrzlé vody,
     * ze kterého roste.
     *
     * Tloušťka i vybočení špičky se počítají z `noise` podle políčka, takže je
     * každý rampouch jiný, ale při posunu kamery neposkakuje.
     */
    drawIcicle(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const py = this.py(y);
        const cx = px + t * 0.5;
        const tip = py + t * 0.99;
        const half = t * (0.30 + noise(x * 11 + y * 5) * 0.07);   // půlšířka u stropu
        const drift = (noise(x * 3 + y * 17) - 0.5) * t * 0.1;    // kam ujede špička
        const neck = half * 0.68;                                 // šířka v půlce délky

        // Nálitek u stropu – led, ze kterého rampouch roste. Ne přes celé
        // políčko: rampouch často visí i tam, kde nad ním žádný blok není.
        ctx.fillStyle = 'rgba(198, 238, 255, 0.8)';
        ctx.beginPath();
        ctx.ellipse(cx, py + t * 0.015, half * 1.12, t * 0.055, 0, 0, TAU);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(cx - half, py);
        // Levý bok: plynulý sešup s boulí v půlce, pak do jehly
        ctx.bezierCurveTo(cx - half * 0.99, py + t * 0.15,
                          cx - neck * 1.1, py + t * 0.28, cx - neck, py + t * 0.45);
        ctx.bezierCurveTo(cx - neck * 0.85, py + t * 0.66,
                          cx + drift - t * 0.06, py + t * 0.86, cx + drift, tip);
        // Pravý bok zpátky nahoru, s boulí o kus jinde než levý
        ctx.bezierCurveTo(cx + drift + t * 0.06, py + t * 0.84,
                          cx + neck * 0.9, py + t * 0.62, cx + neck * 1.06, py + t * 0.43);
        ctx.bezierCurveTo(cx + neck * 1.18, py + t * 0.26,
                          cx + half * 0.98, py + t * 0.14, cx + half, py);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, py, 0, tip);
        grad.addColorStop(0, '#2f8fd0');
        grad.addColorStop(0.55, '#7fd4f5');
        grad.addColorStop(1, '#eafaff');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = '#0d3f63';
        ctx.lineWidth = Math.max(t * 0.035, 1);
        ctx.stroke();

        // Rýhy napříč: vrstvy, po kterých led narostl
        ctx.strokeStyle = 'rgba(13, 63, 99, 0.35)';
        ctx.lineWidth = Math.max(t * 0.025, 1);
        for (const [at, wide] of [[0.42, 0.85], [0.63, 0.6]]) {
            ctx.beginPath();
            ctx.moveTo(cx - neck * wide, py + t * at);
            ctx.quadraticCurveTo(cx, py + t * (at + 0.04), cx + neck * wide, py + t * at);
            ctx.stroke();
        }

        // Svislý odlesk – hlavní znak toho, že je led průsvitný
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.lineWidth = Math.max(t * 0.04, 1);
        ctx.beginPath();
        ctx.moveTo(cx - neck * 0.45, py + t * 0.12);
        ctx.quadraticCurveTo(cx - neck * 0.3, py + t * 0.55, cx + drift * 0.6, py + t * 0.86);
        ctx.stroke();

        // Kapka na jehle: konec rampouchu má být vidět i proti tmavému pozadí
        ctx.fillStyle = 'rgba(234, 250, 255, 0.95)';
        ctx.beginPath();
        ctx.arc(cx + drift, tip - t * 0.03, Math.max(t * 0.05, 1.2), 0, TAU);
        ctx.fill();
    }

    /**
     * Dárek místo kostky. Kreslí se přes hotovou kostku a je **neprůhledný** –
     * kostka s mašlí navrch pořád vypadá jako kostka, dárek z ní udělá teprve
     * balicí papír. Otáčí se s ní, takže se dárek přes obrazovku kutálí.
     *
     * Červený papír se zlatou stuhou drží kostku čitelnou i v modré jeskyni:
     * je to jediná teplá barva na ploše, takže hráč pořád ví, kde je.
     */
    decorateCube(cx, cy, size, rotation) {
        const ctx = this.ctx;
        const s = size;
        const band = s * 0.17;                  // šířka stuhy
        const line = Math.max(s * 0.05, 1.5);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);

        // Balicí papír
        const paper = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
        paper.addColorStop(0, '#f0576c');
        paper.addColorStop(1, '#9e1128');
        ctx.fillStyle = paper;
        roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.18);
        ctx.fill();
        ctx.lineWidth = line;
        ctx.strokeStyle = '#3d0713';
        ctx.stroke();

        // Stuha křížem – uvnitř obrysu, ať papíru zůstane okraj
        ctx.save();
        ctx.clip();
        ctx.fillStyle = '#ffd75e';
        ctx.fillRect(-band / 2, -s / 2, band, s);
        ctx.fillRect(-s / 2, -band / 2, s, band);
        ctx.strokeStyle = 'rgba(160, 108, 12, 0.55)';
        ctx.lineWidth = Math.max(s * 0.02, 1);
        ctx.strokeRect(-band / 2, -s / 2, band, s);
        ctx.strokeRect(-s / 2, -band / 2, s, band);
        ctx.restore();

        // Mašle: dvě oka a uzel uprostřed
        ctx.fillStyle = '#ffe98a';
        ctx.strokeStyle = '#a06c0c';
        ctx.lineWidth = Math.max(s * 0.025, 1);
        for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(side * s * 0.19, -s * 0.02, s * 0.15, s * 0.1,
                        side * 0.5, 0, TAU);
            ctx.fill();
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(0, 0, s * 0.08, 0, TAU);
        ctx.fillStyle = '#ffd75e';
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Ledová jeskyně o Vánocích – rolničky, zvonkohra a koleda nad ležící
     * plochou. Jediné téma ve hře, které stojí **v dur**: koleda musí znít
     * vlídně, moll by z ní udělala truchlivou zimu. Harmonie jsou proto ty
     * nejobyčejnější (I–vi–IV–V a spol.) – právě ta samozřejmost dělá koledu
     * koledou. Dlouhá ozvěna jeskyně zůstala, jen o něco kratší, aby se do ní
     * nesmyla melodie.
     */
    audio() {
        return {
            arrange: 'ice',
            melody: 'carol',
            bpm: 104,
            scales: [SCALE.major, SCALE.majorHexa, SCALE.majorPenta, SCALE.mixolydian],
            progressions: [
                [0, 0, 9, 9, 5, 5, 7, 7],   // I–vi–IV–V
                [0, 0, 5, 5, 7, 7, 0, 0],   // I–IV–V–I
                [0, 0, 7, 7, 9, 9, 5, 5],   // I–V–vi–IV
                [0, 5, 0, 7, 9, 5, 7, 0],
            ],
            roots: [3, 8, 5, 10],
            chord: [0, 4, 7, 12, 16],   // durový kvintakord přes dvě oktávy – teplý a otevřený
            arp: [0, 4, 7, 12],
            cutoff: [2600, 4400, 8000], // zvonky se lesknou i v klidu
            gain: [0.55, 0.66, 0.77],   // řídké aranžmá potřebuje víc hlasitosti než hustá
            leadGain: 0.55,
            delay: {steps: 4, feedback: 0.42, mix: 0.45},   // ozvěna jeskyně, ale koleda musí být slyšet
        };
    }
}
