import {wrap} from "./draw.js";
import {SCALE} from "./audio.js";

/**
 * Kolik částic (vloček sněhu, jisker nad lávou, zrnek písku, světlušek) má
 * prostředí v pozadí. Všechna témata jich sypou stejně, ať je hloubka pozadí
 * v celé hře stejně hustá.
 */
export const WEATHER_COUNT = 90;

/**
 * Prostředí levelu. Jedna třída = jeden svět: říká, jak level vypadá (odstín,
 * horký vzduch), kreslí všechno, co se tématem mění (pozadí, bloky, hroty,
 * ozdoby prstence a mince, tma pod mapou) a vybírá motiv hudby (`audio()`).
 *
 * Vazba je stejná jako u entit: **téma hru neřídí, jen do ní nahlíží.**
 * Nemění stav hry ani skóre – dostane od `Game` plátno a souřadnice a kreslí.
 * Hra se naopak nikdy neptá „jaké je téma“ a nevětví se podle jeho jména:
 * zavolá metodu a to, co se stane, si rozhoduje téma samo. Nová podmínka
 * `if (theme === ...)` v `game.js` znamená, že chybí metoda tady.
 *
 * Sama `Theme` je zároveň **prostředí levelů bez tématu** (temná obloha
 * s mřížkou, prosté bloky a rudé hroty, synthwave) – ostatní světy z ní
 * přepisují jen to, čím se liší. Jediné, co musí doplnit každý, je `name()`.
 */
export class Theme {
    /**
     * @param {import("./game.js").Game} game
     */
    constructor(game) {
        this.game = game;
    }

    // ---- Zkratky do hry ----
    // Téma kreslí do plátna hry a v jejích souřadnicích, takže by se jinak
    // každý tah psal přes `this.game.…`.
    /**
     * @returns {CanvasRenderingContext2D}
     */

    get ctx() {
        return this.game.ctx;
    }

    get level() {
        return this.game.level;
    }

    get tile() {
        return this.game.tile;
    }

    get clock() {
        return this.game.clock;
    }

    get camX() {
        return this.game.camX;
    }

    get width() {
        return this.game.c.width;
    }

    get height() {
        return this.game.c.height;
    }

    get blockSize() {
        return this.game.blockSize;
    }

    get blockPad() {
        return this.game.blockPad;
    }

    /** Vodorovná souřadnice políčka v pixelech (už posunutá kamerou). */
    px(x) {
        return this.game.px(x);
    }

    /** Svislá souřadnice políčka v pixelech. */
    py(y) {
        return this.game.py(y);
    }

    /** Předkreslené nehybné pozadí – viz `Game.drawBackdrop`. */
    drawBackdrop(paint) {
        this.game.drawBackdrop(paint);
    }

    // ---- Co téma o sobě říká ----

    /**
     * Jméno tématu tak, jak se píše v mapě levelu (`{speed, theme}`).
     * Prostředí bez tématu vrací `null`.
     *
     * @return {string|null}
     */
    name() {
        throw new Error('Theme name was not specified.');
    }

    /**
     * Barevný odstín levelu. Bez tématu se s každým levelem posouvá, takže
     * každé kolo vypadá jinak; svět s tématem si odstín určuje sám.
     *
     * @returns {number}
     */
    hue() {
        return (205 + this.game.levelIndex * 31) % 360;
    }

    /**
     * Je v tématu horko? Nad lávou a nad rozpáleným pískem se hotový obraz
     * rozvlní chvěním vzduchu (`Game.drawHeatHaze`).
     *
     * @returns {boolean}
     */
    hazy() {
        return false;
    }

    /**
     * Jak silně se obraz vlní – podíl políčka. Výchylka má být sotva znatelná:
     * je to pocit horka na okraji vidění, ne rozostřená hra.
     *
     * @returns {number}
     */
    hazeAmplitude() {
        return 0.022;
    }

    // ---- Kreslení prostředí ----

    /**
     * Pozadí za mapou. Bez tématu je to obloha s mřížkou – nemění se, jen
     * posouvá, takže se kreslí z hotového obrazu (`drawBackdrop`).
     */
    drawBackground() {
        const h = this.hue();

        this.drawBackdrop((img, width, period) => {
            const grad = img.createLinearGradient(0, 0, 0, this.height);
            grad.addColorStop(0, `hsl(${h}, 55%, 20%)`);
            grad.addColorStop(1, `hsl(${h}, 60%, 7%)`);
            img.fillStyle = grad;
            img.fillRect(0, 0, width, this.height);

            img.strokeStyle = `hsla(${h}, 70%, 65%, 0.10)`;
            img.lineWidth = 1;
            img.beginPath();
            for (let x = 0; x < width; x += period) {
                img.moveTo(x + 0.5, 0);
                img.lineTo(x + 0.5, this.height);
            }
            for (let y = wrap(this.game.offsetY, period); y < this.height; y += period) {
                img.moveTo(0, Math.round(y) + 0.5);
                img.lineTo(width, Math.round(y) + 0.5);
            }
            img.stroke();
        });
    }

    /**
     * Co patří přes hotovou mapu, ale ještě pod překážky a kostku – lávová řeka
     * teče spodním řádkem, takže se musí kreslit až po blocích. Většina světů
     * takovou vrstvu nemá.
     */
    drawForeground() {
    }

    /** Zakrytí prostoru pod mapou, ať kostka nemizí „do prázdna“. */
    drawGroundLine() {
        const ctx = this.ctx;
        const bottom = this.py(this.level.height);
        if (bottom >= this.height) return;

        ctx.fillStyle = `hsl(${this.hue()}, 60%, 5%)`;
        ctx.fillRect(0, bottom, this.width, this.height - bottom);
    }

    /**
     * Jedna podoba bloku do dlaždice. Kreslí se do vlastního plátna, ne na
     * obrazovku – volá to `Game.bakeBlock` a výsledek se pak už jen kopíruje
     * (viz *Výkon* v CLAUDE.md), takže se tady nesmí nic měnit v čase.
     *
     * `variant` plyne ze souřadnic políčka, `capped` říká, jestli nad blokem
     * stojí další blok (volná horní hrana se kreslí světlejší – je pak vidět,
     * kam se dá doskočit).
     */
    paintBlock(ctx, variant, capped) {
        const t = this.tile;
        const s = this.blockSize;
        const h = this.hue();

        ctx.fillStyle = `hsl(${h}, 45%, 13%)`;
        ctx.fillRect(0, 0, s, s);

        ctx.strokeStyle = `hsl(${h}, 85%, 72%)`;
        ctx.lineWidth = Math.max(t * 0.07, 1.5);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);

        // Horní hrana bloku je světlejší – lépe je vidět, kam se dá doskočit
        if (!capped) {
            ctx.fillStyle = `hsl(${h}, 90%, 78%)`;
            ctx.fillRect(0, 0, s, Math.max(t * 0.1, 2));
        }
    }

    /** Hrot stojící na zemi. */
    drawSpikeUp(x, y) {
        this.drawSpike(x, y, true);
    }

    /** Hrot visící ze stropu. */
    drawSpikeDown(x, y) {
        this.drawSpike(x, y, false);
    }

    /**
     * Klasický hrot. Barva je výstražná schválně: co zabíjí, musí být poznat
     * na první pohled – toho se drží i hroty ostatních světů.
     */
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
     * Ozdoba skokového prstence – kreslí se dovnitř hotového kroužku
     * ([cx, cy] je jeho střed, `r` poloměr, `color` jeho barva).
     * Prstenec sám kreslí hra, aby všude stejně jasně říkal, že se z něj skáče.
     */
    decorateRing(cx, cy, r, color) {
    }

    /**
     * Ražba mince. `w` je zúžení otáčející se mince (1 = čelem k hráči),
     * takže se ražba dá skrýt, když by se zmáčkla do čáry.
     */
    decorateCoin(cx, cy, w, color) {
    }

    /**
     * Převlek kostky: kreslí se **přes** hotovou kostku ([cx, cy] je její střed,
     * `size` strana v pixelech, `rotation` její otočení), takže si ji prostředí
     * může obléknout, aniž by o něm `Player` věděl – vazba zůstává jednosměrná,
     * kostka si řeší jen svůj pohyb a kresbu, prostředí do ní jen nahlíží.
     *
     * Kdo sem sáhne, musí počítat s tím, že kostka je čitelnost hry: hráč podle
     * ní pozná, kde je a jak je otočená, takže převlek nesmí splynout s pozadím
     * ani rozmazat obrys.
     */
    decorateCube(cx, cy, size, rotation) {
    }

    // ---- Hudba ----

    /**
     * Motiv hudby: stupnice, harmonie, základní tóny, tempo, akord, filtr
     * a dozvuk k tomu. `arrange` a `melody` říkají `Sound`u, kterými nástroji
     * a jakým tvarem frází se to má zahrát – *čím* se hraje si drží zvuk,
     * *co* se hraje říká prostředí.
     *
     * Pole se uvnitř tématu indexují číslem levelu, takže dva levely téhož
     * světa nezní stejně – proto jich musí být aspoň tolik, kolik má téma
     * levelů (hlídá `check_theme_variety()` v generátoru).
     *
     * Levely bez tématu drží temné synthwave, jak hra zněla od začátku.
     */
    audio() {
        return {
            arrange: 'synth',
            melody: 'synth',
            bpm: 122,
            scales: [SCALE.pentatonic, SCALE.aeolian, SCALE.harmonic, SCALE.phrygian],
            progressions: [
                [0, 0, 8, 7, 0, 0, 5, 7],
                [0, 10, 8, 7, 0, 10, 5, 3],
                [0, 0, 3, 5, 0, 0, 8, 7],
                [0, 5, 3, 10, 0, 5, 8, 7],
            ],
            roots: [0, 3, 5, 7, 10],
            chord: [0, 3, 7, 12],       // mollový akord pro údery
            arp: [0, 3, 7, 12],
            cutoff: [1300, 2800, 4800], // otevření filtru pro jednotlivé stupně (Hz)
            gain: [0.45, 0.58, 0.72],   // hlasitost podkladu – skladba i sílí, nejen se rozjasňuje
            leadGain: 0.55,
            delay: {steps: 3, feedback: 0.34, mix: 0.45},
        };
    }
}
