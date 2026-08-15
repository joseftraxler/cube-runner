import {Theme} from "../theme.js";
import {TAU, noise, wrap} from "../draw.js";
import {SCALE} from "../audio.js";

// Kolik symbolů plave v hloubce matematického světa a kolik je v něm obrazců
const SYMBOL_COUNT = 14;
const FIGURES = 4;

/*
 * Matematické symboly se kreslí čarami (`mathGlyph`), ne písmem. Znaky jako
 * ∑ nebo ∮ nemá každé zařízení ve fontu a místo symbolu by byl vidět prázdný
 * obdélníček – navíc rýsované tahy sedí k rýsovacímu papíru v pozadí.
 */
const GLYPHS = ['sum', 'product', 'integral', 'contour', 'root', 'pi',
    'infinity', 'nabla', 'delta', 'partial', 'lambda', 'phi'];

// Do bloků se rýsují jen jednoduché symboly – složité by se v políčku slily
const BLOCK_GLYPHS = ['pi', 'sum', 'integral', 'root', 'delta', 'infinity',
    'partial', 'lambda'];

/**
 * Matematický svět. Hroty jsou operátory Δ a ∇, bloky dlaždice rýsovacího
 * papíru se symbolem, mince ražba s π a prstenec křivkový integrál ∮; v pozadí
 * je rýsovací papír s geometrickými obrazci a vztahy mezi nimi.
 *
 * Matematická je i hudba, ne jen názvem: souměrné stupnice, harmonie po
 * pravidelných děleních oktávy a melodická buňka nesoudělná s taktem.
 *
 * Třída se jmenuje `MathTheme`, a ne `Math`: uvnitř modulu by zastínila
 * globální `Math`, na kterém stojí každá druhá řádka téhle kresby.
 */
export class MathTheme extends Theme
{
    name() {
        return 'math';
    }

    // Fialová řada se posouvá s levelem – jinak by pět matematických kol
    // vypadalo úplně stejně
    hue() {
        return 258 + (this.game.levelIndex % 5) * 12;
    }

    /**
     * Pozadí je rýsovací papír – jemná mřížka se zvýrazněnými osami – a nad ním
     * se pomalu otáčejí geometrické obrazce, mezi kterými jsou narýsované vztahy
     * (shodné strany, úhly, zobrazení, promítnutí kružnice do sinusovky). Úplně
     * vzadu plují matematické symboly.
     *
     * Všechny vrstvy jsou stálou funkcí času a pořadí prvku (`noise`), takže se
     * s posunem kamery nic nepřeskládá, a jedou s malým parallaxem – pozadí má
     * být hloubka, ne rozptýlení. Proto je taky celé bledé: hráč musí i tak na
     * první pohled poznat, kde je blok a kde překážka.
     */
    drawBackground() {
        // Papír i s oblohou se posouvá jen do strany – kreslí se z hotového obrazu
        this.drawBackdrop((img, width, period) => this.paintGraphPaper(img, width, period));
        this.drawSymbols();
        this.drawFigures();
    }

    /**
     * Rýsovací papír: jemný rastr, přes něj hrubší a v místě mapy vodorovná osa
     * s ryskami. Kreslí se do předem připraveného obrazu (`drawBackdrop`), ten
     * se pak jen posouvá s kamerou – proto se tady s posunem nepočítá a rozteče
     * jsou celá čísla, aby čáry zůstaly ostré.
     */
    paintGraphPaper(ctx, width, period) {
        const h = this.height;
        const shade = this.hue();

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
            for (let y = wrap(this.game.offsetY, step); y < h; y += step) {
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
    drawSymbols() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 0; i < SYMBOL_COUNT; i++) {
            // Bližší symboly jsou větší a víc se posouvají s kamerou
            const depth = 0.3 + noise(i * 5 + 1) * 0.7;
            // Symboly zůstávají menší než políčko: v pozadí mají být hloubka,
            // ne kulisa, přes kterou se hledají překážky
            const size = this.tile * (0.35 + depth * 0.55);
            const x = wrap(noise(i * 13 + 7) * (w + size * 2)
                - this.camX * this.tile * 0.09 * depth, w + size * 2) - size;
            const y = noise(i * 23 + 3) * h
                + Math.sin(this.clock * (0.2 + noise(i * 3) * 0.3) + i) * this.tile * 0.35;
            const glyph = GLYPHS[Math.floor(noise(i * 31 + 11) * GLYPHS.length)];

            ctx.strokeStyle = `hsla(${this.hue() + 30}, 80%, 80%, ${0.05 + depth * 0.07})`;
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
    drawFigures() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const span = w + this.tile * 20;
        const shift = this.camX * this.tile * 0.16;

        ctx.lineJoin = 'round';

        const spot = i => ({
            x: wrap(noise(i * 17 + 5) * span - shift, span) - this.tile * 10,
            y: h * (0.12 + noise(i * 29 + 13) * 0.5),
            r: this.tile * (1.2 + noise(i * 11 + 3) * 1.5),
            turn: this.clock * (0.06 + noise(i * 7 + 1) * 0.12) + noise(i * 19) * TAU,
        });

        for (let i = 0; i < FIGURES; i++) {
            const a = spot(i);
            const b = spot(i + 1);
            // Vztah se kreslí jen mezi obrazci, které jsou zrovna vedle sebe –
            // přes celé plátno by z toho byla pavučina. A jen když je aspoň
            // jeden z nich vidět, jinak by se šipka rýsovala pro nic za nic.
            if (Math.abs(b.x - a.x) >= w * 0.45) continue;
            if (Math.min(a.x, b.x) > w || Math.max(a.x, b.x) < 0) continue;
            this.drawRelation(a, b);
        }

        for (let i = 0; i < FIGURES; i++) {
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
        const ink = `hsla(${this.hue() + 40}, 85%, 78%, 0.22)`;
        const faint = `hsla(${this.hue() + 40}, 85%, 78%, 0.12)`;

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
        const ink = `hsla(${this.hue() + 45}, 90%, 80%, 0.24)`;
        const faint = `hsla(${this.hue() + 45}, 90%, 80%, 0.12)`;
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

        ctx.fillStyle = `hsla(${this.hue() + 45}, 95%, 85%, 0.3)`;
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

        ctx.strokeStyle = `hsla(${this.hue() + 50}, 80%, 80%, 0.13)`;
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
     * Blok matematického světa: dlaždice rozdělená na čtyři pole jako políčko
     * rýsovacího papíru, na ní bledě narýsovaný symbol. Který to je, plyne
     * z `variant`, a ta ze souřadnic políčka – při posunu kamery se tedy
     * symboly nepřeskládají a zeď zůstane pořád stejná.
     */
    paintBlock(ctx, variant, capped) {
        const t = this.tile;
        const s = this.blockSize;
        const h = this.hue();

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

    // Ze země roste Δ, ze stropu visí ∇ – týž trojúhelník obráceně
    drawSpikeUp(x, y) {
        this.drawOperator(x, y, true);
    }

    drawSpikeDown(x, y) {
        this.drawOperator(x, y, false);
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

    /**
     * Z prstence je křivkový integrál – po obvodu objíždí hrot, který ukazuje
     * orientaci křivky (∮).
     */
    decorateRing(cx, cy, r, color) {
        const ctx = this.ctx;
        const angle = this.clock * 1.6;
        const ax = cx + Math.cos(angle) * r;
        const ay = cy + Math.sin(angle) * r;
        const dir = angle + Math.PI / 2;        // hrot míří po tečně
        const s = r * 0.5;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(ax + Math.cos(dir) * s, ay + Math.sin(dir) * s);
        ctx.lineTo(ax + Math.cos(dir + 2.4) * s, ay + Math.sin(dir + 2.4) * s);
        ctx.lineTo(ax + Math.cos(dir - 2.4) * s, ay + Math.sin(dir - 2.4) * s);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Mince je ražená na π – jen když je zrovna otočená k hráči, jinak by se
     * ražba mačkala do čáry.
     */
    decorateCoin(cx, cy, w, color) {
        if (w <= 0.62) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(w, 1);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(this.tile * 0.05, 1.2);
        ctx.lineCap = 'round';
        mathGlyph(ctx, 'pi', 0, 0, this.tile * 0.34);
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Matematický svět – minimalistický běh šestnáctin: metronom místo bicích,
     * čisté sinusové tóny a melodická buňka nesoudělné délky, která se proti
     * taktu postupně posouvá. Stupnice jsou souměrné (celotónová a zmenšená se
     * zobrazí samy na sebe po posunu) a harmonie krouží po velkých a malých
     * terciích a po kvintách – všechno jsou to pravidelné dělení oktávy.
     *
     * Pole mají pět prvků, protože matematických levelů je pět a každý z nich
     * má sáhnout na jinou stupnici, harmonii i základní tón.
     * `chord` tenhle motiv nemá schválně: akord hraje `#ratioChord`
     * v přirozeném ladění, ne v půltónech.
     */
    audio() {
        return {
            arrange: 'math',
            melody: 'phase',
            bpm: 128,
            scales: [SCALE.wholeTone, SCALE.dorian, SCALE.octatonic, SCALE.pentatonic,
                     SCALE.aeolian],
            progressions: [
                [0, 0, 4, 4, 8, 8, 4, 4],       // velké tercie – dělení oktávy na tři
                [0, 7, 2, 9, 4, 11, 6, 1],      // kvintový kruh
                [0, 0, 3, 3, 6, 6, 9, 9],       // malé tercie – dělení oktávy na čtyři
                [0, 5, 10, 3, 8, 1, 6, 11],     // kvartový kruh (kvintový pozpátku)
                [0, 0, 8, 8, 5, 5, 10, 10],
            ],
            roots: [0, 5, 3, 8, 10],
            arp: [0, 7, 12, 7],
            cutoff: [1600, 3200, 6200],
            gain: [0.48, 0.60, 0.74],
            leadGain: 0.52,
            delay: {steps: 4, feedback: 0.40, mix: 0.42},   // ozvěna prázdné posluchárny
        };
    }
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
