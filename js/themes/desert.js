import {Theme, WEATHER_COUNT} from "../theme.js";
import {TAU, noise, wrap} from "../draw.js";
import {SCALE} from "../audio.js";

/**
 * Poušť. Místo hrotů ze země rostou kaktusy, ze stropu visí supi, bloky jsou
 * z pískovce a v pozadí stojí duny se sluncem v prachu. Nad rozpáleným pískem
 * se obraz vlní horkým vzduchem – míň než nad ohněm, ale je to znát.
 *
 * Hudba je western: cval koně ve dvoučtvrťovém taktu, „bum-ča“ basa
 * s kytarou, hvízdaný nápěv a trubka. Krajina je Sonora, ne Sahara – a hudba
 * taky.
 */
export class Desert extends Theme
{
    name() {
        return 'desert';
    }

    hue() {
        return 32;
    }

    hazy() {
        return true;
    }

    // Nad pouští se vzduch chvěje míň než nad ohněm
    hazeAmplitude() {
        return 0.014;
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
    drawBackground() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
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
        const cx = this.width * 0.74;
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
        const w = this.width;
        const h = this.height;

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
        const span = this.width + this.tile * 14;
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
        const w = this.width;
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
        const w = this.width;
        const h = this.height;

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
     * Pískovcový blok. Vrstvy i zrno se počítají ze `variant` (a ta ze souřadnic
     * políčka), takže jsou pro dané místo stálé a při posunu kamery neposkakují.
     */
    paintBlock(ctx, variant, capped) {
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

    drawSpikeUp(x, y) {
        this.drawCactus(x, y);
    }

    drawSpikeDown(x, y) {
        this.drawVulture(x, y);
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
            ctx.strokeStyle = '#aa0000';
            ctx.fillStyle = '#ff6f91';
            ctx.beginPath();
            ctx.ellipse(cx, top - t * 0.10, width * 0.60, width * 0.20, 0, 0, TAU);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(cx, top - t * 0.13, width * 0.45, width * 0.25, 0, 0, TAU);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(cx, top - t * 0.15, width * 0.15, width * 0.30, 0, 0, TAU);
            ctx.fill();
            ctx.stroke();
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
     * Poušť – **western**: jízda plání ve dvoučtvrťovém taktu. Kopyta cválají
     * „DUM-ta-ka“, basa s kytarou drží „bum-ča“, nápěv vede tremolová kytara
     * a nahoře se k ní přidá hvízdání a trubka.
     *
     * Prostředí je Sonora (kaktusy, stolové hory, supi), ne Sahara – proto
     * jízda plání, a ne orientální drón. Ten se tu kdysi zkoušel a zněl spíš
     * jako harmonika než jako poušť.
     *
     * Harmonie je **kovbojská, ne mollová**: I–♭VII–IV (0–10–5 půltónů), tedy
     * durový základ se sníženou sedmičkou. Právě ta ♭VII zní jako Amerika;
     * čistá moll z toho dělala Leoneho drama a čistá dur zase veselou zábavu
     * na náměstí. Akordy kytary jsou **prázdné kvinty** (bez tercie), takže
     * sedí i pod mollovými stupnicemi vyšších levelů a zní jako širá pláň.
     */
    audio() {
        return {
            arrange: 'desert',
            melody: 'western',
            // Doba je čtvrtka (čtyři kroky), takže tohle číslo rovnou znamená
            // čtvrtky za minutu. Zní to jako moc, ale takt je dvoučtvrťový:
            // v uších z toho podle rychlosti levelu vyjde 134 až 228 celých
            // taktů „bum-ČA“ za minutu, tedy trysk. Poloviční tempo se
            // zkoušelo a znělo jako klusající povoz.
            bpm: 120,
            scales: [SCALE.major, SCALE.mixolydian, SCALE.dorian, SCALE.aeolian],
            progressions: [
                [0, 0, 10, 10, 5, 5, 0, 0],     // I–♭VII–IV–I, kovbojský obrat
                [0, 0, 5, 5, 0, 0, 7, 7],
                [0, 10, 0, 10, 5, 5, 7, 0],
                [0, 0, 7, 7, 10, 10, 0, 0],
            ],
            roots: [2, 5, 7, 0],
            chord: [0, 7, 12, 19],          // prázdné kvinty – bez tercie, jako pláň
            chordSeventh: [0, 7, 10, 12],   // na dominantě přibude septima
            cutoff: [1500, 3000, 5600],     // suché, ne sklovité
            gain: [0.56, 0.70, 0.86],
            leadGain: 0.62,
            // **Bez ozvěny** – jediné téma ve hře, které ji nemá. V tomhle
            // tempu se tóny sypou tak hustě, že se i slabý slapback s nápěvem
            // slil v kaši; prostor tady místo něj drží dusot kopyt.
            delay: {steps: 3, feedback: 0, mix: 0},
        };
    }
}
