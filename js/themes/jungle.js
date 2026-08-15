import {Theme, WEATHER_COUNT} from "../theme.js";
import {TAU, noise, wrap} from "../draw.js";
import {SCALE} from "../audio.js";

/**
 * Džungle. Místo hrotů ze země rostou masožravé rostliny, ze stropu visí hadi
 * na liánách, bloky jsou zarostlé chrámové kvádry a v pozadí stojí koruny
 * stromů s pruhy světla, kmeny v mlze, houpající se liány a světlušky.
 *
 * Rudá tlama a jantarové pruhy jsou v zeleném prostředí schválně: zelená
 * rostlina by splynula s pozadím a nebylo by poznat, co zabíjí.
 *
 * Hudba je africký bubnový kruh – drží ji rytmus, ne harmonie.
 */
export class Jungle extends Theme
{
    name() {
        return 'jungle';
    }

    // Zelená řada se posouvá s levelem – jinak by pět džunglových kol
    // vypadalo úplně stejně
    hue() {
        return 112 + (this.game.levelIndex % 5) * 9;
    }

    /**
     * Nebe skoro není vidět: nahoře leží vrstvy listí, mezi kterými propadají
     * šikmé pruhy světla, v hloubce stojí kmeny a nad zemí visí mlha.
     * Všechno nehybné se peče jednou do obrazu (`drawBackdrop`) a pak už se jen
     * posouvá – živé jsou jenom liány a světlušky přes něj.
     *
     * Pod úrovní země je schválně tma, stejně jako v poušti: díra v podlaze je
     * smrtelný pád, takže z ní nesmí koukat listí, ale prázdno.
     */
    drawBackground() {
        const ctx = this.ctx;
        const ground = this.py(this.level.height - 2);

        this.drawBackdrop((img, width) => this.paintCanopy(img, width, ground));
        this.drawVines();
        this.drawSpores();

        ctx.fillStyle = `hsl(${this.hue() - 26}, 38%, 4%)`;
        ctx.fillRect(0, ground, this.width, this.height - ground);
    }

    /**
     * Nehybné pozadí džungle: obloha, pruhy světla, kmeny, tři vrstvy listí
     * shora a mlha nad zemí. Kreslí se do předem připraveného obrazu, který se
     * pak jen posouvá s kamerou – proto se tady s posunem nepočítá.
     *
     * Všechno je tmavé a málo kontrastní úmyslně: v zeleném prostředí musí být
     * na první pohled poznat kvádr od rostliny, takže pozadí smí být jen hloubka.
     */
    paintCanopy(ctx, width, ground) {
        const h = this.height;
        const shade = this.hue();
        const t = this.tile;

        const sky = ctx.createLinearGradient(0, 0, 0, Math.max(ground, 1));
        sky.addColorStop(0, `hsl(${shade + 22}, 45%, 7%)`);
        sky.addColorStop(0.45, `hsl(${shade}, 38%, 15%)`);
        sky.addColorStop(1, `hsl(${shade - 16}, 32%, 9%)`);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, width, h);

        // Pruhy světla, které propadly korunami – šikmé, ať je poznat, že jdou
        // shora zvenčí, a sotva znatelné, ať nepřesvítí překážky
        ctx.fillStyle = `hsla(${shade + 34}, 70%, 78%, 0.045)`;
        for (let i = 0; i < 5; i++) {
            const x = noise(i * 13 + 3) * width;
            const beam = t * (0.5 + noise(i * 7 + 1) * 1.3);
            const lean = t * (1.2 + noise(i * 5) * 1.4);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + beam, 0);
            ctx.lineTo(x + beam + lean, ground);
            ctx.lineTo(x + lean, ground);
            ctx.closePath();
            ctx.fill();
        }

        // Kmeny v hloubce – jen tmavší pruhy, které se nahoře ztrácejí v listí
        for (let i = 0; i < 7; i++) {
            const x = noise(i * 19 + 5) * width;
            const wide = t * (0.3 + noise(i * 11 + 2) * 0.5);
            ctx.fillStyle = `hsla(${shade - 12}, 30%, 8%, 0.55)`;
            ctx.beginPath();
            ctx.moveTo(x - wide, ground);
            ctx.lineTo(x - wide * 0.55, 0);
            ctx.lineTo(x + wide * 0.55, 0);
            ctx.lineTo(x + wide, ground);
            ctx.closePath();
            ctx.fill();
        }

        // Tři vrstvy listí u horní hrany. Bližší visí níž a je tmavší, takže
        // je vidět, že koruny mají hloubku.
        const layers = [[2.6, 12], [1.7, 9], [1.0, 6]];
        for (const [drop, light] of layers) {
            const base = t * drop;
            const step = Math.max(t * 0.7, 8);
            ctx.fillStyle = `hsl(${shade + 6}, 36%, ${light}%)`;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(width, 0);
            ctx.lineTo(width, base);
            for (let x = width; x > 0; x -= step) {
                const lobe = base * (0.3 + noise(x * 0.7 + drop * 31) * 0.5);
                ctx.quadraticCurveTo(x - step / 2, base + lobe, x - step, base);
            }
            ctx.closePath();
            ctx.fill();
        }

        // Mlha v podrostu – nejsvětlejší místo obrazu je těsně nad zemí,
        // takže překážky stojící na zemi mají za sebou kontrast
        const mist = ctx.createLinearGradient(0, ground - t * 3.5, 0, ground);
        mist.addColorStop(0, `hsla(${shade + 10}, 30%, 60%, 0)`);
        mist.addColorStop(1, `hsla(${shade + 10}, 30%, 60%, 0.16)`);
        ctx.fillStyle = mist;
        ctx.fillRect(0, ground - t * 3.5, width, t * 3.5);
    }

    /**
     * Liány visící z korun. Jsou to kulisy, ne překážky – proto jsou tenké,
     * tmavé a končí vysoko nad dráhou kostky. Houpou se každá po svém (fáze
     * podle pořadí) a jedou s parallaxem, aby byla poznat hloubka.
     */
    drawVines() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
            const depth = 0.45 + noise(i * 11 + 5) * 0.55;
            const x = wrap(noise(i * 17 + 1) * w - this.camX * this.tile * 0.22 * depth, w);
            const len = h * (0.16 + noise(i * 23 + 7) * 0.28);
            const sway = Math.sin(this.clock * 0.7 + i * 1.7) * this.tile * 0.4 * depth;

            ctx.strokeStyle = `hsla(${this.hue() - 10}, 42%, ${13 + depth * 12}%, 0.8)`;
            ctx.lineWidth = Math.max(this.tile * 0.055 * depth, 1);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.quadraticCurveTo(x + sway * 0.4, len * 0.6, x + sway, len);
            ctx.stroke();

            // Dva lístky u konce liány, ať to není jen čára
            ctx.fillStyle = `hsla(${this.hue() + 6}, 40%, ${18 + depth * 12}%, 0.8)`;
            for (const dir of [-1, 1]) {
                const ly = len * (dir < 0 ? 0.72 : 0.9);
                const lx = x + sway * (dir < 0 ? 0.75 : 0.95);
                ctx.beginPath();
                ctx.ellipse(lx + dir * this.tile * 0.14 * depth, ly,
                    this.tile * 0.16 * depth, this.tile * 0.06 * depth, dir * 0.4, 0, TAU);
                ctx.fill();
            }
        }
        ctx.lineCap = 'butt';
    }

    /**
     * Světlušky nad podrostem. Polohy se počítají z hodin a stálého šumu podle
     * pořadí, takže není potřeba držet stav – a každá bliká vlastním tempem,
     * jinak by z toho byla girlanda.
     */
    drawSpores() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        for (let i = 0; i < WEATHER_COUNT; i++) {
            // Bližší světlušky jsou větší, rychlejší a víc se posouvají s kamerou
            const depth = 0.35 + noise(i) * 0.65;
            const x = wrap(noise(i + 23) * w + Math.sin(this.clock * 0.5 + i) * 16 * depth
                - this.camX * this.tile * 0.16 * depth, w);
            const y = wrap(noise(i + 61) * h - this.clock * 11 * depth, h);
            const r = depth * Math.max(1, this.tile * 0.03);
            const blink = 0.35 + 0.65 * Math.abs(Math.sin(this.clock * (1 + noise(i + 7)) + i * 2.3));

            ctx.globalAlpha = (0.1 + depth * 0.32) * blink;
            ctx.fillStyle = '#d8ff8a';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    /**
     * Zarostlý chrámový kvádr. Kámen má vyrytou spáru a lišejník, na volné
     * horní hraně mech – ten je zároveň značka, kam se dá doskočit (jako sníh
     * v ledovém tématu nebo navátý písek v pouštním).
     *
     * Kresba se počítá ze `variant` (a ta ze souřadnic políčka), takže je pro
     * dané místo stálá a při posunu kamery neposkakuje.
     */
    paintBlock(ctx, variant, capped) {
        const t = this.tile;
        const s = this.blockSize;

        const grad = ctx.createLinearGradient(0, 0, 0, t);
        grad.addColorStop(0, 'hsl(94, 13%, 34%)');
        grad.addColorStop(1, 'hsl(104, 16%, 17%)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);

        // Spára mezi kvádry – jedna stačí, dvě už by z kamene dělaly cihly
        ctx.strokeStyle = 'rgba(16, 26, 12, 0.5)';
        ctx.lineWidth = Math.max(t * 0.04, 1);
        const seam = t * (0.4 + noise(variant * 17 + 3) * 0.22);
        ctx.beginPath();
        ctx.moveTo(0, seam);
        ctx.lineTo(t, seam + t * 0.05 * (noise(variant * 5 + 1) - 0.5));
        ctx.stroke();

        // Lišejník – světlé skvrny zarostlé do kamene
        ctx.fillStyle = 'rgba(164, 196, 116, 0.16)';
        for (let i = 0; i < 3; i++) {
            const lx = t * (0.15 + noise(variant * 13 + i * 19) * 0.7);
            const ly = t * (0.2 + noise(variant * 29 + i * 7) * 0.65);
            ctx.beginPath();
            ctx.ellipse(lx, ly, t * 0.1, t * 0.07, noise(variant + i) * TAU, 0, TAU);
            ctx.fill();
        }

        ctx.strokeStyle = 'rgba(186, 214, 152, 0.42)';
        ctx.lineWidth = Math.max(t * 0.05, 1);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);

        // Na volné horní hraně roste mech – zároveň je líp vidět, kam se doskočí
        if (!capped) {
            ctx.fillStyle = '#7cbb46';
            ctx.fillRect(0, 0, s, Math.max(t * 0.11, 2));
            // Trsy přerůstající přes hranu, ať mech nekončí jako pravítko
            ctx.beginPath();
            for (let i = 0; i < 3; i++) {
                const cx = t * (0.2 + i * 0.3);
                const r = t * (0.1 + noise(variant * 7 + i * 23) * 0.07);
                ctx.moveTo(cx - r, t * 0.06);
                ctx.arc(cx, t * 0.06, r, Math.PI, 0);
            }
            ctx.fill();
        }
    }

    drawSpikeUp(x, y) {
        this.drawCarnivore(x, y);
    }

    drawSpikeDown(x, y) {
        this.drawSnake(x, y);
    }

    /**
     * Masožravá rostlina – džunglová obdoba hrotu ze země. Stonek se kolébá
     * a tlama se otevírá a zavírá (fáze podle políčka, takže každá rostlina
     * po svém, ale pořád stejně).
     *
     * Tlama je rudá schválně: kolem je všechno zelené, takže zelená rostlina
     * by splynula s pozadím. Smrtící musí být poznat na první pohled stejně
     * jako rudý hrot – a celá kresba se drží v mezích políčka, aby odpovídala
     * tomu, co opravdu zabíjí.
     */
    drawCarnivore(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const px = this.px(x);
        const base = this.py(y + 1);
        const cx = px + t * 0.5;
        const phase = noise(x * 7 + y * 13) * TAU;
        const sway = Math.sin(this.clock * 2.2 + phase) * t * 0.07;
        // Tlama se rozevírá jen na část cyklu – zavřená pořád by byla poupě
        const gape = 0.35 + 0.65 * Math.max(0, Math.sin(this.clock * 3 + phase));
        const neck = base - t * 0.58;
        const head = cx + sway;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Listy u paty – rostlina musí někde růst
        ctx.fillStyle = '#2b6524';
        for (const dir of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(cx + dir * t * 0.2, base - t * 0.07, t * 0.19, t * 0.06, dir * 0.35, 0, TAU);
            ctx.fill();
        }

        // Stonek: tmavý obrys a světlejší jádro
        const stem = () => {
            ctx.beginPath();
            ctx.moveTo(cx, base);
            ctx.quadraticCurveTo(cx + sway * 0.4, base - t * 0.32, head, neck);
        };
        stem();
        ctx.strokeStyle = '#16330f';
        ctx.lineWidth = t * 0.17;
        ctx.stroke();
        stem();
        ctx.strokeStyle = '#4f8f31';
        ctx.lineWidth = t * 0.09;
        ctx.stroke();

        // Tlama rozevřená vzhůru: dvě čelisti a mezi nimi jícen
        const spread = t * (0.09 + 0.15 * gape);
        const lip = neck - t * 0.34;
        const throat = neck - t * 0.04;

        ctx.beginPath();
        ctx.moveTo(head - t * 0.03, neck);
        ctx.quadraticCurveTo(head - t * 0.26, neck - t * 0.12, head - spread - t * 0.08, lip);
        ctx.quadraticCurveTo(head - t * 0.1, neck - t * 0.16, head, throat);
        ctx.quadraticCurveTo(head + t * 0.1, neck - t * 0.16, head + spread + t * 0.08, lip);
        ctx.quadraticCurveTo(head + t * 0.26, neck - t * 0.12, head + t * 0.03, neck);
        ctx.closePath();

        const flesh = ctx.createLinearGradient(0, lip, 0, neck);
        flesh.addColorStop(0, '#ff6f91');
        flesh.addColorStop(0.55, '#d21f45');
        flesh.addColorStop(1, '#5c0a1c');
        ctx.fillStyle = flesh;
        ctx.fill();
        ctx.strokeStyle = '#3d0713';
        ctx.lineWidth = Math.max(t * 0.035, 1);
        ctx.stroke();

        // Zuby po obou čelistech míří dovnitř tlamy
        ctx.strokeStyle = 'rgba(255, 238, 222, 0.9)';
        ctx.lineWidth = Math.max(t * 0.022, 1);
        for (const dir of [-1, 1]) {
            const lipX = head + dir * (spread + t * 0.08);
            ctx.beginPath();
            for (let k = 0; k < 3; k++) {
                const s = 0.3 + k * 0.26;
                const bx = head + (lipX - head) * s;
                const by = throat + (lip - throat) * s;
                ctx.moveTo(bx, by);
                ctx.lineTo(bx - dir * t * 0.05, by + t * 0.05);
            }
            ctx.stroke();
        }

        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
    }

    /**
     * Had zavěšený na liáně – džunglová obdoba hrotu ze stropu. Visí hlavou
     * dolů, tělo se vlní a jazyk občas vyjede. Fáze je daná políčkem, takže
     * každý had se vlní po svém, ale pořád stejně.
     *
     * Tělo je skoro černé s jantarovými pruhy (kreslí je přerušovaný tah):
     * jednolitá zelená by v listí zanikla, pruhy jsou vidět hned. Vlnění
     * i délka zůstávají v políčku, aby bylo poznat, kudy se pod ním proletí.
     */
    drawSnake(x, y) {
        const ctx = this.ctx;
        const t = this.tile;
        const cx = this.px(x + 0.5);
        const top = this.py(y);
        const phase = noise(x * 5 + y * 17) * TAU;
        const sway = Math.sin(this.clock * 1.8 + phase) * t * 0.14;
        const headX = cx + sway * 0.6;
        const headY = top + t * 0.76;

        // Tělo je jedna kubická křivka; ze stejných řídicích bodů se pak
        // spočítají i místa pruhů, takže pruhy sedí na těle i při vlnění
        const p0 = [cx - sway * 0.3, top];
        const c1 = [cx + sway, top + t * 0.26];
        const c2 = [cx - sway * 0.8, top + t * 0.5];
        const p3 = [headX, headY];
        const at = (u) => {
            const v = 1 - u;
            return [v * v * v * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p3[0],
                    v * v * v * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p3[1]];
        };

        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p3[0], p3[1]);
        // Světlý lem kolem těla – tmavý had by v tmavém listí zanikl
        // (stejný důvod jako u supa na písku)
        ctx.strokeStyle = 'rgba(238, 228, 186, 0.22)';
        ctx.lineWidth = t * 0.27;
        ctx.stroke();
        ctx.strokeStyle = '#2c3d1b';
        ctx.lineWidth = t * 0.22;
        ctx.stroke();

        // Pruhy napříč tělem. Přerušovaný tah po křivce by dělal svislé korálky
        // (dělí se podél cesty, ne napříč), proto se kreslí jako kosočtverce
        // v místech spočítaných z téže křivky.
        ctx.fillStyle = '#e8b23a';
        for (let k = 1; k <= 5; k++) {
            const [bx, by] = at(k / 6.4);
            // Pruhy jsou šikmé, ne rovné – rovné by z hada dělaly housenku
            ctx.beginPath();
            ctx.ellipse(bx, by, t * 0.085, t * 0.028, 0.5, 0, TAU);
            ctx.fill();
        }

        // Hlava je znatelně širší než tělo, jinak se v něm ztratí
        ctx.fillStyle = '#26351a';
        ctx.strokeStyle = 'rgba(240, 230, 190, 0.5)';
        ctx.lineWidth = Math.max(t * 0.02, 1);
        ctx.beginPath();
        ctx.ellipse(headX, headY + t * 0.02, t * 0.17, t * 0.12, sway * 0.5, 0, TAU);
        ctx.fill();
        ctx.stroke();

        // Oči – jantarové s tmavou štěrbinou
        for (const dir of [-1, 1]) {
            ctx.fillStyle = '#f6d45a';
            ctx.beginPath();
            ctx.arc(headX + dir * t * 0.075, headY - t * 0.01, Math.max(t * 0.035, 1.5), 0, TAU);
            ctx.fill();
            ctx.fillStyle = '#160f06';
            ctx.fillRect(headX + dir * t * 0.075 - Math.max(t * 0.008, 0.5),
                headY - t * 0.035, Math.max(t * 0.016, 1), t * 0.05);
        }

        // Rozeklaný jazyk vyjíždí jen občas
        const flick = Math.max(0, Math.sin(this.clock * 4 + phase * 1.7));
        if (flick > 0.2) {
            const len = t * 0.16 * flick;
            ctx.strokeStyle = '#e5484d';
            ctx.lineWidth = Math.max(t * 0.02, 1);
            ctx.beginPath();
            const tongue = headY + t * 0.13;
            ctx.moveTo(headX, tongue);
            ctx.lineTo(headX, tongue + len);
            ctx.moveTo(headX, tongue + len);
            ctx.lineTo(headX - len * 0.4, tongue + len * 1.4);
            ctx.moveTo(headX, tongue + len);
            ctx.lineTo(headX + len * 0.4, tongue + len * 1.4);
            ctx.stroke();
        }

        ctx.lineCap = 'butt';
    }

    /**
     * Džungle – bubnový kruh: dvouzvučný zvonec drží zvonovou linku, do jejích
     * mezer se zaklesnou djembe (tři různé údery) a chřestidlo, balafon na to
     * hraje ostinato a nad vším zpívá sbor hlasů, kterému odpovídá píšťala.
     *
     * Harmonie se skoro nehne (modální kolébání mezi základem a septimou) –
     * tah drží rytmus, ne akordy, a proto se i basa opírá o doby zvonce.
     *
     * Pole mají pět prvků, ať se pět džunglových levelů netrefí do stejného
     * motivu (hlídá `check_theme_variety()` v generátoru).
     */
    audio() {
        return {
            arrange: 'jungle',
            melody: 'ostinato',
            bpm: 100,
            scales: [SCALE.pentatonic, SCALE.dorian, SCALE.kumoi, SCALE.aeolian,
                     SCALE.blues],
            progressions: [
                [0, 0, 10, 10, 0, 0, 5, 5],
                [0, 0, 5, 5, 10, 10, 7, 7],
                [0, 10, 0, 10, 3, 3, 10, 10],
                [0, 0, 3, 3, 10, 10, 5, 5],
                [0, 7, 10, 7, 0, 7, 3, 3],
            ],
            roots: [0, 5, 3, 10, 7],
            chord: [0, 3, 7, 12],       // mollový akord pro sbor hlasů
            arp: [0, 5, 7, 12],
            cutoff: [1700, 3400, 6400], // slapy a chřestidlo potřebují výšky
            // Bubnový kruh musí znít plně, ne uctivě – proto o kus hlasitěji než
            // řídké motivy (odchylku hlídá `tools/mixtest.mjs`)
            gain: [0.50, 0.62, 0.74],
            leadGain: 0.54,
            delay: {steps: 3, feedback: 0.24, mix: 0.24},   // ozvěna mezi kmeny, ne mlha
        };
    }
}
