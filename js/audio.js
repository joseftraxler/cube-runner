/**
 * Zvuk hry. Efekty i hudba na pozadí se **skládají za běhu** přes Web Audio API
 * (oscilátory a šum) – nenačítá se žádný zvukový soubor. Hra tak zůstává bez
 * závislostí, funguje offline a v repozitáři nejsou binární data.
 *
 * Hudba je krokový sekvencer: 16 kroků na takt, harmonie se točí po osmi taktech.
 * Neroste ale s časem, nýbrž **s postupem v levelu** (`setIntensity`) – čím dál
 * kostka doběhne, tím je skladba plnější: nejdřív jen podklad s kopákem, pak
 * naskočí virbl, melodie s dozvukem a akordové údery, nakonec arpeggio,
 * otevřené hi-hat a naplno otevřený filtr. Přechod mezi stupni podtrhne činel s nájezdem.
 * Po smrti se intenzita vrátí na začátek, takže hudba přímo odráží, jak se daří.
 *
 * (Kdyby gradace běžela na čas, nebyla by v praxi slyšet – po většinu pokusů
 * kostka umře dřív, než by skladba stihla nastoupit.)
 *
 * **Každé téma prostředí má vlastní motiv** – jinou stupnici, harmonii, tempo,
 * nástroje i rytmus. Motiv si ale drží prostředí (`Theme.audio()` v `js/themes/`),
 * ne zvuk: tady je **jak se hraje** (nástroje a aranžmá), tam **co se hraje**.
 * Beztémové levely drží temné synthwave, led hraje Vánoce – rolničky
 * a zvonkohru s koledou –, oheň dusá chraplavým riffem pod kvintakordy
 * elektrické kytary,
 * poušť je western na dvě doby –
 * cval koně, „bum-ča“ basa, tremolová kytara a hvízdání –, matematický svět běží
 * minimalisticky (metronom, skleněné tóny, souměrné stupnice a melodická buňka,
 * která se proti taktu posouvá) a džungle je africký bubnový kruh: kovový zvonec
 * drží linku, djembe hrají do jejích mezer, balafon na to skládá ostinato
 * a nad vším zpívá sbor hlasů.
 *
 * Poušť je jediná, která nestojí v moll: western jede na durovém základu se
 * sníženou sedmičkou (I–♭VII–IV). Čistá moll z ní dělala truchlivé drama
 * a čistá dur zase zábavu na náměstí – teprve ta ♭VII zní jako Amerika.
 *
 * V rámci tématu má každý level vlastní stupnici, harmonii i základní tón podle
 * svého čísla a tempo podle své rychlosti; melodie se losuje ze seedu podle
 * čísla levelu, takže je pokaždé stejná.
 *
 * `Game` zvuku jen říká, co se stalo (`play('jump')`), jestli má hrát hudba
 * (`setMusicOn`) a jaký motiv má hrát (`setTrack`). Zvuk sám o hře nic neví.
 */

const STORAGE_KEY = 'cube-runner-muted';

const STEPS_PER_BAR = 16;
const BARS = 8;
const PATTERN_STEPS = STEPS_PER_BAR * BARS;

// Hranice postupu levelem, na kterých se přidá další vrstva nástrojů
const TIERS = [0.28, 0.58];

// O kolik dopředu se plánují tóny (s) – kryje výkyvy časovače
const LOOKAHEAD = 0.15;

/**
 * Délka kroku (s), pod kterou se aranžmá **prořídí**. Tempo se počítá
 * z rychlosti levelu, takže rychlé kolo má stejný počet šestnáctin jako pomalé,
 * ale padají skoro dvakrát hustěji – co na 118 % zní jako chod, je na 205 %
 * plocha. Aranžmá si podle `fast` zahraje řidčeji, aby zůstal zhruba stejný
 * počet úderů za vteřinu; hustotu tak řídí obtížnost skladby, ne tempo.
 *
 * 0,065 s je zhruba 230 čtvrtek za minutu – ohnivé levely 14 a 19 jsou pod tím,
 * 4 a 9 nad tím.
 */
const FAST_STEP = 0.065;

// Stupnice jako půltóny od základního tónu. Témata sahají po mollových – kvůli
// atmosféře; durové zůstávají v paletě pro svět, který by měl znít vesele.
export const SCALE = {
    pentatonic: [0, 3, 5, 7, 10],           // mollová pentatonika
    aeolian: [0, 2, 3, 5, 7, 8, 10],        // přirozená moll
    harmonic: [0, 2, 3, 5, 7, 8, 11],       // harmonická moll – zvětšená sekunda
    dorian: [0, 2, 3, 5, 7, 9, 10],         // dórská – moll s velkou sextou
    phrygian: [0, 1, 3, 5, 7, 8, 10],       // frygická – nejtemnější
    kumoi: [0, 2, 3, 7, 9],                 // japonská, vzdušná a prázdná
    inSen: [0, 1, 5, 7, 10],                // japonská „in“ – mrazivá
    locrian: [0, 1, 3, 5, 6, 8, 10],        // lokrická – tritonus hned v základu
    blues: [0, 3, 5, 6, 7, 10],             // mollové blues se sníženou kvintou
    hijaz: [0, 1, 4, 5, 7, 8, 10],          // frygická dur – zvětšená sekunda nad základem
    wholeTone: [0, 2, 4, 6, 8, 10],         // celotónová – souměrná, bez těžiště
    octatonic: [0, 2, 3, 5, 6, 8, 9, 11],   // zmenšená – opakuje se po malých terciích
    major: [0, 2, 4, 5, 7, 9, 11],          // durová – jediná bez špetky napětí
    mixolydian: [0, 2, 4, 5, 7, 9, 10],     // durová se sníženou septimou – kovbojská
    majorPenta: [0, 2, 4, 7, 9],            // durová pentatonika – bez půltónů
    majorHexa: [0, 2, 4, 7, 9, 11],         // durová bez kvarty – nikdy se netluče s dominantou
};

/**
 * Mollový akord v přirozeném ladění (podíly malých celých čísel místo
 * rovnoměrné temperace). Tóny se do sebe zamknou beze zázněje – proti
 * temperovanému zbytku hry je to slyšet, a přesně proto zní takhle
 * harmonie matematického světa.
 */
const JUST_MINOR = [1, 6 / 5, 3 / 2, 2];

/**
 * Zvonová linka západoafrických bubnových kruhů převedená do šestnáctin –
 * seskupení 3–3–2, na kterém stojí celý džunglový rytmus. Hraje ji gankogui
 * (dvouzvučný zvonec) a opírá se o ni basa i balafonové ostinato; djembe
 * naopak hrají do mezer mezi ní, a z toho vzniká prokládaná polyrytmika.
 */
const BELL = [0, 3, 6, 8, 11, 14];

/**
 * Kytarová figura ohně, zapsaná v krocích (šestnáctinách) taktu – doprovod
 * z ní hraje v každém taktu totéž, takže se za ni ucho chytne i pod riffem.
 *
 * `chugs` jsou dusané kvintakordy: jednička, hned za ní šestnáctina (to je ten
 * tah dopředu) a pak až šestnáctina za třetí dobou. Druhá doba zůstává prázdná
 * schválně – tam je slyšet riff. `run` je stoupavý běh po strunách na čtvrtou
 * dobu, který vtáhne do dalšího taktu; čísla jsou pořadí struny v akordu
 * (`profile.chord`), tedy základ – kvinta – oktáva.
 *
 * Platí pro pomalé levely; na rychlých (`fast`) hraje kytara řidčeji, viz
 * `#arrangeFire`.
 */
const FIRE_FIGURE = {
    chugs: [0, 3, 9, 15],
    run: {12: 0, 13: 1, 14: 2},
};

/**
 * Nápěvy westernu – **hotová dvojtaktí**, ne rytmus k vyplnění náhodnými tóny.
 * Zapsané jsou jako [krok v šestnáctinách, půltón nad základním tónem].
 *
 * Počítá se **na dvě**: v jednom taktu sekvenceru jsou dvě dvojčtvrťové míry
 * (kroky 0–7 a 8–15), doba padá na každý čtvrtý krok. Celá smyčka je tím pádem
 * šestnáct dvojčtvrťových měr – běžná délka westernové písně.
 *
 * Rytmus je **tečkovaný**: tón na dobu, šestnáctina těsně před další dobou
 * (kroky 3, 7, 11, 15) a zase doba. Ten hopsavý spád je to, čím se westernová
 * jízda pozná od pochodu; rovné osminky z toho udělají cirkusový mars.
 */
const WESTERN_PHRASES = [
    // Jízda: stoupání za obzor, tečkovaný rytmus proti cvalu
    [[0, 0], [3, 3], [4, 5], [8, 7], [11, 5], [12, 7],
     [16, 10], [19, 7], [20, 12], [24, 10], [28, 7]],
    // Píseň u ohně: klidná, zpěvná, po stupnici dolů a zpátky
    [[0, 7], [4, 5], [6, 3], [8, 0], [12, 3],
     [16, 5], [20, 7], [22, 5], [24, 3], [28, 0]],
    // Fanfára: opakované tóny a skok na oktávu, jak se troubí do útoku
    [[0, 0], [2, 0], [4, 0], [7, 3], [8, 5], [12, 5],
     [16, 7], [18, 7], [20, 10], [23, 10], [24, 12], [28, 10]],
    // Hnaní stáda: sestup shora, nejhutnější z nápěvů
    [[0, 12], [3, 10], [4, 8], [8, 7], [11, 8], [12, 7],
     [16, 5], [19, 3], [20, 5], [24, 3], [28, 0]],
];

/**
 * Závěr smyčky: výjezd na oktávu, ta zůstane ležet přes celý takt a pod ní
 * doběhne cval. Poslední dva tóny klesnou na kvintu, ze které se smyčka vrací
 * na začátek – bez toho by se konec a začátek srazily.
 */
const WESTERN_CADENCE = [
    [0, 7], [4, 10], [6, 12], [8, 12], [12, 10],
    [16, 12], [24, 10], [28, 7],
];

/**
 * Nápěvy koledy – **hotová dvojtaktí** ve stejném zápisu jako western
 * ([krok, půltón nad základním tónem]), ze stejného důvodu: koleda stojí a padá
 * na tom, že se dá zabroukat, a náhodné tóny nápěv nedají.
 *
 * Koleda se pozná podle toho, že jde **po stupních a po akordu** – žádné cizí
 * tóny, žádné skoky jen tak. Rytmus je klidný (doby a osminy) a fráze se klene:
 * nadechne se nahoru a zase sestoupí, aby se dala zazpívat na jeden dech.
 */
const CAROL_PHRASES = [
    // Zvonkohra: klidný oblouk po stupních, nejzpěvnější z nápěvů
    [[0, 4], [4, 5], [8, 7], [12, 7], [16, 9], [20, 7], [24, 5], [28, 4]],
    // Koleda: nástup po akordu vzhůru, odpověď sestupem po stupnici
    [[0, 0], [4, 4], [6, 7], [8, 12], [16, 11], [20, 9], [24, 7], [28, 4]],
    // Houpavá: tón na „a“ druhé doby ji rozhoupe, pak klesá k základu
    [[0, 7], [6, 9], [8, 7], [12, 4], [16, 5], [22, 4], [24, 2], [28, 0]],
    // Radostná: opakovaný tón a výstup na oktávu, nejvýš ze všech
    [[0, 7], [4, 7], [8, 9], [12, 11], [16, 12], [20, 11], [24, 7], [28, 9]],
];

/**
 * Závěr smyčky koledy: sestup od sexty k základnímu tónu, na kterém se skladba
 * zastaví a nechá poslední zvonek doznít. Volný konec taktu je schválně –
 * bez ticha před opakováním by koleda neměla kde se nadechnout.
 */
const CAROL_CADENCE = [
    [0, 9], [4, 7], [8, 5], [12, 4], [16, 2], [20, 4], [24, 0],
];

// Křivka měkkého oříznutí pro waveshaper – dá ohnivé base a úderům chraplák
const DIST_CURVE = (() => {
    const size = 1024;
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        curve[i] = Math.tanh((i / (size - 1) * 2 - 1) * 4);
    }
    return curve;
})();

/**
 * Křivka kytarového aparátu: tvrdší a hlavně **nesouměrné** oříznutí (spodní
 * půlvlna se ořízne dřív než horní). Nesouměrnost přidá sudé harmonické, díky
 * kterým zkreslení zní dřevěně jako elektronka; souměrné oříznutí dává jen
 * liché harmonické a z toho je čtvercová vlna, ne kytara. Stejnosměrnou složku,
 * která tím vznikne, odvede horní propust v `#cabinet`.
 */
const AMP_CURVE = (() => {
    const size = 2048;
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        const x = i / (size - 1) * 2 - 1;
        curve[i] = x >= 0 ? Math.tanh(x * 2.4) : Math.tanh(x * 3.4) * 0.85;
    }
    return curve;
})();

const semitone = (n) => 2 ** (n / 12);

/** Stupeň stupnice včetně přetečení do vyšších oktáv (i záporných). */
const degreeAt = (scale, i) => {
    const octave = Math.floor(i / scale.length);
    return scale[i - octave * scale.length] + 12 * octave;
};

/**
 * Nejbližší **stupeň** stupnice k danému počtu půltónů (oktávy se počítají
 * s ním, takže je to obrácená `degreeAt`). Fráze sonu jsou zapsané v půltónech,
 * aby si držely tvar; tímhle se převedou na stupně stupnice levelu, ve kterých
 * se pak posouvají za harmonií.
 */
function degreeOf(scale, semi) {
    const from = (Math.floor(semi / 12) - 1) * scale.length;
    let best = from;
    let dist = Infinity;

    for (let i = from; i < from + scale.length * 3; i++) {
        const d = Math.abs(degreeAt(scale, i) - semi);
        if (d < dist) {
            dist = d;
            best = i;
        }
    }

    return best;
}

/**
 * O kolik stupňů se fráze posune, aby seděla na akord. Bere se **kratší
 * cesta** (kvinta nahoru = kvarta dolů), takže melodie zůstane v poloze,
 * ve které ji trubka hraje; posun vždycky nahoru by ji na dominantě vystřelil
 * o kvintu výš a smyčka by uskakovala z rejstříku do rejstříku.
 */
function chordShift(scale, degree) {
    const up = degreeOf(scale, degree);
    const down = up - scale.length;
    return Math.abs(degreeAt(scale, down)) < Math.abs(degreeAt(scale, up)) ? down : up;
}

// Malý deterministický generátor – melodie levelu vyjde pokaždé stejná
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Rozepíše **napsané fráze** do celé smyčky ve tvaru **A – A – B – závěr**:
 * nápěv se zahraje, zopakuje nad jinou harmonií (a tím si odpoví), pak přijde
 * druhý pro kontrast a nakonec společná kadence. Level si losuje jen to, které
 * dva nápěvy zazní; uvnitř se nelosuje nic. Stojí na tom poušť i led – obě
 * témata mají mít nápěv, který se dá zabroukat, a náhoda z melodie dělala
 * běhání po stupnici, ne téma.
 *
 * Fráze jsou zapsané v **půltónech**, aby si držely tvar; tady se převedou na
 * stupně stupnice levelu. Vazbu na harmonii (proto sem jde `prog`) drží posun
 * celé fráze o základ právě znějícího akordu – po stupních a kratší cestou
 * (`chordShift`), takže opěrné tóny padnou na akord a nápěv přitom zůstane
 * v poloze, ve které se dá zpívat.
 */
function writePhrases(melody, phrases, cadence, scale, random, prog) {
    const pick = Math.floor(random() * phrases.length);
    // Druhý nápěv musí být jiný, jinak by kontrastní díl nekontrastoval
    const other = (pick + 1 + Math.floor(random() * (phrases.length - 1))) % phrases.length;
    const form = [phrases[pick], phrases[pick], phrases[other], cadence];

    form.forEach((phrase, part) => {
        let last = null;
        for (const [at, semi] of phrase) {
            const bar = part * 2 + Math.floor(at / STEPS_PER_BAR);
            let idx = degreeOf(scale, semi) + chordShift(scale, prog[bar % prog.length]);
            // Ve stupnici bez půltónů můžou dva sousední tóny nápěvu padnout na
            // tentýž stupeň – druhý se posune dál, ať fráze nezůstane stát na místě
            if (last && idx === last.idx && semi !== last.semi) {
                idx += semi > last.semi ? 1 : -1;
            }
            melody[bar * STEPS_PER_BAR + at % STEPS_PER_BAR] = degreeAt(scale, idx);
            last = {idx, semi};
        }
    });
}

/** Kolik kroků zbývá do dalšího tónu melodie (dál než `max` nás nezajímá). */
function stepsToNext(melody, step, max) {
    for (let i = 1; i < max; i++) {
        if (melody[(step + i) % melody.length] !== null) return i;
    }
    return max;
}

/**
 * Melodie na celou smyčku (pole půltónů nad **základním tónem levelu**,
 * `null` = pomlka). Styl řídí rytmus i tvar fráze – tím se motivy témat liší
 * nejvíc. Harmonii (`prog`) potřebuje jen son, který na ni váže fráze,
 */
function buildMelody(style, scale, random, prog) {
    const melody = new Array(PATTERN_STEPS).fill(null);

    switch (style) {
        // Oheň: jednotaktový riff, který se pořád dokola opakuje – těžké doby drží základ
        case 'riff': {
            const riff = new Array(STEPS_PER_BAR).fill(null);
            for (let i = 0; i < STEPS_PER_BAR; i++) {
                const chance = i % 4 === 0 ? 0.95 : (i % 2 === 0 ? 0.5 : 0.3);
                if (random() < chance) {
                    riff[i] = i % 4 === 0 ? 0 : degreeAt(scale, Math.floor(random() * 4));
                }
            }
            for (let i = 0; i < PATTERN_STEPS; i++) melody[i] = riff[i % STEPS_PER_BAR];
            break;
        }

        // Poušť: napsaná dvojtaktí westernu, rozepsaná do formy A – A – B – závěr
        // (jak a proč viz `writePhrases`)
        case 'western':
            writePhrases(melody, WESTERN_PHRASES, WESTERN_CADENCE, scale, random, prog);
            break;

        /**
         * Led: **koleda**, a tedy zase napsaný nápěv (`CAROL_PHRASES`) ve stejné
         * formě jako western. Koleda se pozná podle toho, že se dá zazpívat –
         * náhodné tóny by z ní udělaly cinkání zvonkohry bez písničky.
         */
        case 'carol':
            writePhrases(melody, CAROL_PHRASES, CAROL_CADENCE, scale, random, prog);
            break;

        // Matematika: krátká buňka, jejíž délka je nesoudělná s taktem (5, 7
        // nebo 9 kroků proti šestnácti). Každým taktem se proti dobám posune
        // o kus dál, takže se souzvuky pořád skládají jinak, i když se hraje
        // pořád totéž – fázový posun, ne nová melodie.
        case 'phase': {
            const length = 5 + Math.floor(random() * 3) * 2;
            const cell = new Array(length).fill(null);
            for (let i = 0; i < length; i++) {
                cell[i] = random() < 0.78 ? degreeAt(scale, Math.floor(random() * 5)) : null;
            }
            for (let i = 0; i < PATTERN_STEPS; i++) melody[i] = cell[i % length];
            break;
        }

        // Džungle: ostinato zaklesnuté do bubnů. Tóny leží na tresillu 3–3–2,
        // takže melodie a bicí drží stejnou kostru; každý čtvrtý takt se buňka
        // zvedne o oktávu, aby smyčka nebyla jen opakování dokola.
        case 'ostinato': {
            const cell = BELL.map(() => degreeAt(scale, Math.floor(random() * 5)));
            for (let bar = 0; bar < BARS; bar++) {
                BELL.forEach((hit, k) => {
                    const lift = bar % 4 === 3 && k >= BELL.length - 2 ? 12 : 0;
                    melody[bar * STEPS_PER_BAR + hit] = cell[k] + lift;
                });
            }
            break;
        }

        // Synthwave: volné tóny na sudých krocích
        default:
            for (let i = 0; i < PATTERN_STEPS; i++) {
                const degree = scale[Math.floor(random() * scale.length)];
                melody[i] = i % 2 === 0 && random() < 0.5
                    ? degree + (random() < 0.35 ? 12 : 0)
                    : null;
            }
    }

    return melody;
}

export class Sound {
    constructor() {
        this.ctx = null;
        this.muted = readMuted();
        this.track = null;      // {stepDur, root, prog, scale, melody, profile}
        this.musicOn = false;   // má hudba hrát?
        this.intensity = 0;     // 0–1, jak daleko kostka v levelu doběhla
        this.tier = 0;          // z intenzity odvozený stupeň instrumentace
        this.step = 0;
        this.nextStepTime = 0;
        this.timer = null;
    }

    /**
     * Zapne zvuk. AudioContext smí vzniknout až po interakci uživatele
     * (prohlížeče jinak blokují přehrávání), takže se volá z `Game.handleAction`.
     */
    unlock() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }

        const Ctx = window.AudioContext ?? window.webkitAudioContext;
        if (!Ctx) return;

        try {
            this.ctx = new Ctx();
        } catch {
            this.ctx = null;   // bez zvuku, ale hra běží dál
            return;
        }

        this.#buildGraph();
        this.noiseBuffer = makeNoise(this.ctx);
        // Level je načtený dřív, než smí vzniknout AudioContext – teď se do grafu
        // teprve dostane nastavení jeho motivu
        this.#applyTrack();
        this.nextStepTime = this.ctx.currentTime;
        this.timer = setInterval(() => this.#schedule(), 25);

        // V neaktivní záložce nemá cenu hrát
        document.addEventListener('visibilitychange', () => {
            if (!this.ctx) return;
            if (document.hidden) this.ctx.suspend();
            else this.ctx.resume();
        });
    }

    /*
     * Cesta signálu:
     *   efekty ─────────────────────────────────┐
     *   bicí + basa ──> musicGain ──┐           ├─> master ─> reproduktory
     *   melodie ──> leadGain ───────┼> filtr ───┘
     *                └─> delay ─────┘   (filtr se v nástupu otevírá)
     */
    #buildGraph() {
        const ctx = this.ctx;

        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(ctx.destination);

        // Dolní propust drží klidnou půlku smyčky přidušenou, v nástupu se otevře
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        // Čísla jsou jen výchozí stav grafu – hned po sestavení je podle motivu
        // právě načteného levelu přepíše `#applyTrack()`
        this.filter.frequency.value = 1300;
        this.filter.Q.value = 1.2;
        this.filter.connect(this.master);

        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = 0.45;
        this.musicGain.connect(this.filter);

        this.leadGain = ctx.createGain();
        this.leadGain.gain.value = 0.55;
        this.leadGain.connect(this.filter);

        // Dozvuk melodie – z pár tónů udělá prostor
        this.delay = ctx.createDelay(1.5);
        this.delay.delayTime.value = 0.25;
        this.feedback = ctx.createGain();
        this.feedback.gain.value = 0.34;
        this.delayGain = ctx.createGain();
        this.delayGain.gain.value = 0.45;

        this.leadGain.connect(this.delay);
        this.delay.connect(this.feedback).connect(this.delay);
        this.delay.connect(this.delayGain).connect(this.filter);

        this.sfxGain = ctx.createGain();
        this.sfxGain.gain.value = 0.9;
        this.sfxGain.connect(this.master);
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.master) this.master.gain.value = this.muted ? 0 : 1;
        try {
            localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
        } catch { /* v soukromém režimu nevadí, že se to nezapamatuje */ }
        return this.muted;
    }

    // ---- Hudba ----

    /**
     * Nastaví skladbu levelu a vrátí sekvencer na začátek (po každé smrti).
     * `profile` je motiv, který si drží prostředí levelu (`Theme.audio()`):
     * stupnice, harmonie, základní tóny, tempo a jména aranžmá a stylu melodie.
     * Pole se v něm indexují číslem levelu, takže dva levely téhož světa
     * nezahrají totéž.
     */
    setTrack(levelIndex, speedPct, profile) {
        const scale = profile.scales[levelIndex % profile.scales.length];
        const prog = profile.progressions[levelIndex % profile.progressions.length];
        const random = rng(levelIndex * 2654435761 + 12345);

        this.track = {
            root: 55 * semitone(profile.roots[levelIndex % profile.roots.length]),
            prog,
            // Rychlejší level = svižnější hudba (tempo roste s obtížností)
            stepDur: 60 / (profile.bpm * speedPct / 100) / 4,
            melody: buildMelody(profile.melody, scale, random, prog),
            scale,
            profile,
        };

        this.step = 0;
        this.intensity = 0;
        this.tier = 0;
        if (this.ctx) {
            this.nextStepTime = this.ctx.currentTime;
            this.#applyTrack();
        }
    }

    /** Přenese nastavení motivu do grafu – dozvuk, hlasitosti a základní filtr. */
    #applyTrack() {
        if (!this.ctx || !this.track) return;

        const {profile, stepDur} = this.track;
        const now = this.ctx.currentTime;

        // Dozvuk se odvíjí od tempa, ať se drží kroku
        this.delay.delayTime.value = Math.min(stepDur * profile.delay.steps, 1.5);
        this.feedback.gain.value = profile.delay.feedback;
        this.delayGain.gain.value = profile.delay.mix;
        this.leadGain.gain.value = profile.leadGain;

        this.filter.frequency.setTargetAtTime(profile.cutoff[0], now, 0.2);
        this.musicGain.gain.setTargetAtTime(profile.gain[0], now, 0.2);
    }

    /**
     * Jak daleko kostka v levelu doběhla (0–1). Hudba podle toho přidává
     * vrstvy – volá se každý snímek, drahé věci se dějí jen při změně stupně.
     */
    setIntensity(value) {
        this.intensity = value;
    }

    /** Má hudba hrát? Volá se každý snímek, reaguje se jen na změnu. */
    setMusicOn(on) {
        if (on === this.musicOn) return;
        this.musicOn = on;
        if (on && this.ctx) this.nextStepTime = Math.max(this.nextStepTime, this.ctx.currentTime);
    }

    #schedule() {
        if (!this.ctx || !this.musicOn || !this.track) return;

        while (this.nextStepTime < this.ctx.currentTime + LOOKAHEAD) {
            this.#playStep(this.step, this.nextStepTime);
            this.nextStepTime += this.track.stepDur;
            this.step = (this.step + 1) % PATTERN_STEPS;
        }
    }

    #playStep(step, when) {
        const t = this.track;
        const profile = t.profile;
        const bar = Math.floor(step / STEPS_PER_BAR);
        const inBar = step % STEPS_PER_BAR;
        const root = t.root * semitone(t.prog[bar % t.prog.length]);

        // Stupeň instrumentace podle toho, jak daleko kostka doběhla
        const tier = TIERS.filter(limit => this.intensity >= limit).length;

        // Postup na vyšší stupeň podtrhne činel a krátký nájezd
        if (tier !== this.tier) {
            const up = tier > this.tier;
            if (up) {
                this.#crash(when);
                this.#riser(when, t.stepDur * 8);
            }
            this.filter.frequency.setTargetAtTime(profile.cutoff[tier], when, up ? 0.5 : 0.3);
            this.musicGain.gain.setTargetAtTime(profile.gain[tier], when, 0.4);
        }
        this.tier = tier;

        // Aranžmá si podle tématu vybere nástroje i rytmus
        const bit = {t, root, bar, inBar, step, tier, when, fast: t.stepDur < FAST_STEP};
        switch (profile.arrange) {
            case 'ice': this.#arrangeIce(bit); break;
            case 'fire': this.#arrangeFire(bit); break;
            case 'desert': this.#arrangeDesert(bit); break;
            case 'math': this.#arrangeMath(bit); break;
            case 'jungle': this.#arrangeJungle(bit); break;
            default: this.#arrangeSynth(bit); break;
        }
    }

    // ---- Aranžmá jednotlivých témat ----

    /** Bez tématu: temné synthwave – kopák, rozladěné pily, hranatá melodie. */
    #arrangeSynth({t, root, bar, inBar, step, tier, when}) {
        // ---- bicí ----
        if (inBar % 4 === 0) this.#kick(when);
        if (tier >= 1 && inBar % 8 === 4) this.#snare(when, tier >= 2);
        if (tier >= 1 && inBar % 2 === 1) this.#hat(when, tier >= 2 && inBar % 8 === 7);

        // ---- basa: pravidelné osminky, ve vyšších stupních skoky o oktávu ----
        if (inBar % 2 === 0) {
            const octave = tier >= 1 && (inBar === 6 || inBar === 14) ? 2 : 1;
            this.#bassSaw(root * octave, t.stepDur * 0.85, when);
        }

        // ---- melodie s dozvukem ----
        const note = t.melody[step];
        if (note !== null && (tier >= 1 || inBar % 8 === 0)) {
            this.#tone({
                freq: root * 4 * semitone(note), type: 'square',
                dur: t.stepDur * (tier >= 1 ? 1.9 : 1.4),
                gain: tier >= 1 ? 0.13 : 0.07, when, dest: this.leadGain,
            });
        }

        // ---- akordové údery: harmonie, která jinde ve skladbě nezazní ----
        if (tier >= 1 && bar % 2 === 0) {
            if (inBar === 0) this.#stab(root, t.stepDur * 3.5, 0.055, when);
            // Odpověď na druhou dobu naskočí až v nejvyšším stupni
            if (tier >= 2 && inBar === 6) this.#stab(root, t.stepDur * 2, 0.035, when);
        }

        // ---- arpeggio až v nejvyšším stupni: šestnáctiny přes mollový akord ----
        if (tier >= 2) {
            const arpNote = t.profile.arp[inBar % t.profile.arp.length];
            this.#tone({
                freq: root * 8 * semitone(arpNote), type: 'triangle',
                dur: t.stepDur * 0.8, gain: 0.055, when, dest: this.musicGain,
            });
        }
    }

    /**
     * Led: **Vánoce v jeskyni.** Celý takt drží běh rolniček (`#sleighBells`),
     * přes něj zpívá zvonkohra koledu (`CAROL_PHRASES`) a pod tím leží teplý
     * durový akord. Jeskyně zůstala – led v ní praská dál a ozvěna je pořád
     * dlouhá –, ale hraje se v ní vánočně, ne mrazivě.
     *
     * Rolničky jsou tu **místo bicích**: nesou dobu, takže se od nich všechno
     * ostatní odvíjí. Kdyby k nim přibyl virbl nebo hi-hat, ztratily by se
     * v soupravě a z koledy by byla popová písnička se zvonečky navrch.
     */
    #arrangeIce({t, root, bar, inBar, step, tier, when}) {
        // ---- rolničky: osminky s přízvukem na dobu, v nejvyšším stupni plný třas ----
        if (inBar % 2 === 0) this.#sleighBells(when, inBar % 4 === 0);
        if (tier >= 2 && inBar % 2 === 1) this.#sleighBells(when, false);

        // ---- měkký buben na jedničku a praskání ledu, ať je pořád poznat jeskyně ----
        if (inBar % 8 === 0) this.#kick(when, {top: 130, bottom: 38, dur: 0.3, gain: 0.5});
        if (tier >= 1 && bar % 2 === 1 && inBar === 12) this.#iceCrack(when);

        // ---- basa: základ na jedničku, kvinta na půlku taktu – kolébavý doprovod ----
        if (inBar === 0) this.#bassSub(root, t.stepDur * 7, when);
        if (tier >= 1 && inBar === 8) this.#bassSub(root * 1.5, t.stepDur * 6.5, when);

        // ---- zvonkohra: koleda ----
        const note = t.melody[step];
        if (note !== null && (tier >= 1 || inBar % 4 === 0)) {
            this.#bell(root * 4 * semitone(note), t.stepDur * (tier >= 1 ? 5 : 4),
                       tier >= 1 ? 0.11 : 0.09, when);
        }

        // ---- plocha: pomalu nabíhající akord, jediná plná harmonie ve skladbě ----
        if (tier >= 1 && bar % 2 === 0 && inBar === 0) {
            this.#swell(root, t.stepDur * 13, tier >= 2 ? 0.05 : 0.035, when);
        }

        // ---- velký zvon na konci fráze (až v nejvyšším stupni) ----
        if (tier >= 2 && bar % 4 === 3 && inBar === 8) {
            this.#bell(root, t.stepDur * 14, 0.06, when);
        }
    }

    /**
     * Oheň: dvojkopák, chraplavá basa na šestnáctiny a riff, který se opakuje.
     * Přes to hraje **elektrická kytara kvintakordy** (`#guitar`) v synkopované
     * figuře zakončené během po strunách (`FIRE_FIGURE`). Basa drží tah,
     * kytara přidává chraplavý střed; v pozadí praskají uhlíky.
     *
     * Kytary jsou tři a **každá v jiné poloze**, jinak by si lezly do cesty:
     * doprovod drží figuru uprostřed, úder (`#powerStab`) se opře do jedničky
     * o oktávu výš a v nejvyšším stupni nad tím ještě jede klesající lick.
     *
     * **Rychlý level (`fast`, viz `FAST_STEP`) se hraje na polovinu.** Tempo
     * roste s rychlostí levelu, takže na 205 % by za vteřinu zaznělo skoro
     * dvakrát tolik not co na 118 % a byla by z toho plocha. Půlí se proto
     * mřížka: kopák drží půlové doby, basa čtvrtky, riff a lick osminky,
     * kytara zahraje jen akord na jedničku. Vypadává všechno, co takt drobí –
     * dvojkopák, virbl, nájezd, činel i běh po strunách –, takže rychlá kola
     * jsou vzdušná a řídká, ne hustší.
     */
    #arrangeFire({t, root, bar, inBar, step, tier, when, fast}) {
        /*
         * ---- bicí: rocková souprava ----
         * Nájezd na konci smyčky (tomy dolů) a činel na její první jedničce
         * dělají z osmi taktů jednu větu, ne osm stejných taktů. Po dobu
         * nájezdu mlčí činelka i virbl, aby byl slyšet.
         */
        const fill = tier >= 2 && bar === BARS - 1 && inBar >= 12;

        if (inBar % (fast ? 8 : 4) === 0) this.#kick(when, {top: 200, bottom: 36, dur: 0.13, gain: 0.72});
        if (tier >= 1 && !fast && inBar % 8 === 3) this.#kick(when, {top: 190, bottom: 36, dur: 0.1, gain: 0.5});
        if (tier >= 2 && !fast && inBar % 8 === 7) this.#kick(when, {top: 190, bottom: 36, dur: 0.1, gain: 0.5});
        if (tier >= 1 && !fast && !fill && inBar % 8 === 4) this.#snare(when, true);
        if (fill && !fast) this.#tom(when, [200, 168, 142, 118][inBar - 12]);
        if (tier >= 2 && !fast && bar === 0 && inBar === 0) this.#crash(when);

        // Hi-hat drží osminky ve všech tempech – na rychlém levelu je to jediné,
        // co odměřuje takt. Na konci taktu dvě šestnáctiny jako přítlak do další
        // jedničky; v rychlém tempu by z nich byl jen sykot.
        if (tier >= 1 && !fill && (inBar % 2 === 0 || (tier >= 2 && !fast && inBar >= 13))) {
            this.#hat(when, inBar === 14);
        }

        // ---- basa: dusané šestnáctiny přes měkké oříznutí, na rychlém levelu čtvrtky ----
        if (inBar % (fast ? 4 : 2) === 0 || (tier >= 1 && !fast)) {
            this.#bassGrowl(root, t.stepDur * 0.9, when);
        }

        /*
         * ---- doprovodná kytara: kvintakordy z aparátu ----
         * Rytmus drží `FIRE_FIGURE`: dusané akordy na synkopu a na čtvrtou dobu
         * běh po strunách do dalšího taktu. Během nájezdu kytara mlčí.
         *
         * Figura hraje ve všech stupních stejně; sílu přidává otevírající se
         * filtr a zbytek kapely, ne hustší kytara (na 205 % by z houstnutí byl
         * bzučák). Na rychlém levelu z ní zbude jen akord na jedničku – v tom
         * tempu by se synkopy i běh slily.
         */
        const chord = t.profile.chord.map(n => root * 2 * semitone(n));
        const string = fast ? undefined : FIRE_FIGURE.run[inBar];
        if (!fill && (!fast || inBar === 0) && FIRE_FIGURE.chugs.includes(inBar)) {
            this.#guitar(chord, t.stepDur * 1.05, 0.115, when, {mute: true});
        } else if (!fill && string !== undefined) {
            this.#guitar([chord[string]], t.stepDur * 1.05, 0.115, when);
        }

        // ---- riff: pila s krátkým klesnutím, jako kytara ----
        const note = t.melody[step];
        if (note !== null && (tier >= 1 || inBar % 4 === 0) && (!fast || inBar % 2 === 0)) {
            this.#tone({
                freq: root * 4 * semitone(note), freqTo: root * 4 * semitone(note) * 0.985,
                type: 'sawtooth', dur: t.stepDur * 1.1,
                gain: tier >= 1 ? 0.12 : 0.07, when, dest: this.leadGain,
            });
        }

        // ---- údery: kvintakord bez tercie, odpověď o půltón výš (nejtemnější krok) ----
        if (tier >= 1 && bar % 2 === 0) {
            if (inBar === 0) this.#powerStab(root, t.stepDur * 3, 0.045, when);
            if (tier >= 2 && inBar === 10) {
                this.#powerStab(root * semitone(1), t.stepDur * 1.6, 0.033, when);
            }
        }

        // ---- uhlíky: nepravidelné prasknutí, které se s taktem nepotkává ----
        if (tier >= 1 && step % 13 === 5) this.#crackle(when);

        // ---- druhá kytara až v nejvyšším stupni: klesající lick vysoko nad riffem ----
        // Na rychlém levelu jde po čtvrtkách: tvar licku zůstane, jen se neslije
        const every = fast ? 4 : 2;
        if (tier >= 2 && inBar % every === 0) {
            const arpNote = t.profile.arp[Math.floor(inBar / every) % t.profile.arp.length];
            this.#guitar([root * 8 * semitone(arpNote)], t.stepDur * 0.9, 0.05, when);
        }
    }

    /**
     * Poušť: western. Prostředí je Sonora – kaktusy, stolové hory a supi –,
     * takže hudba je **jízda plání ve dvoučtvrťovém taktu**: v každém taktu
     * sekvenceru jsou dvě míry, doba padá na každý čtvrtý krok.
     *
     * Těžiště taktu je na **druhé době**: tam dopadnou kopyta i odsek kytary
     * („bum-ČA“), zatímco jednička patří base. Kdyby se přizvukovala jednička,
     * byl by z jízdy pochod. Guitarrón střídá základ a kvintu po mírách,
     * kytara na dvojce odsekne akord. Nápěv vede tremolová
     * kytara, v druhém stupni ho zdvojí hvízdání a ve třetím
     * trubka se sborem: teprve tam je z toho ta velká širokoúhlá jízda.
     * Bič (`#whipCrack`) práskne na začátku každé fráze.
     */
    #arrangeDesert({t, root, bar, inBar, step, tier, when}) {
        // Dominanta se septimou – ten tón táhne zpátky k základu
        const degree = t.prog[bar % t.prog.length];
        const shape = degree === 7 ? t.profile.chordSeventh : t.profile.chord;
        const beat = inBar % 4;         // kde jsme uvnitř doby
        const inBeat = inBar % 8;       // kde jsme uvnitř dvojčtvrťové míry

        // ---- cval: dopad na **druhou dobu** ----
        // Přízvuk na dvojce je celý tenhle žánr: na jedničku kůň našlápne,
        // na dvojku dopadne. Kdyby byl důraz na jedničce, je z jízdy pochod.
        // Kopyta nesou celou skladbu: hrají od prvního pokusu a v plné sazbě,
        // protože poušť nemá ani bicí soupravu, ani ozvěnu, která by prostor
        // vyplnila za ně.
        if (inBeat === 0) this.#hooves(when, 'medium');
        if (inBeat === 4) this.#hooves(when, 'strong');
        if (beat === 2) this.#hooves(when, 'soft');
        // Šestnáctina těsně před dobou – z ní je teprve cval, ne klus
        if (tier >= 1 && beat === 3) this.#hooves(when, 'soft');
        // Bič otevírá frázi – jednou za dvojtaktí, aby zůstal událostí
        if (tier >= 1 && bar % 2 === 0 && inBar === 0) this.#whipCrack(when);
        // Virbl jde s přízvukem, ne proti němu
        if (tier >= 1 && inBeat === 4) this.#snare(when, tier >= 2 && inBar === 12);

        // ---- basa „bum“: jednička každé míry, střídavě základ a kvinta ----
        if (inBar === 0) this.#guitarron(root, t.stepDur * 3.4, 0.24, when);
        if (inBar === 8) this.#guitarron(root * 1.5, t.stepDur * 3.4, 0.2, when);
        // Před změnou akordu se basa rozeběhne k jeho základu zezdola
        if (tier >= 1 && inBar === 14) {
            const next = t.prog[(bar + 1) % t.prog.length];
            this.#guitarron(t.root * semitone(next - 2), t.stepDur * 1.4, 0.15, when);
        }

        // ---- kytara „ČA“: přízvučný odsek na druhou dobu ----
        // Tady je těžiště taktu a zároveň jediná plná harmonie ve skladbě
        if (inBeat === 4) {
            this.#strum(root, shape, t.stepDur * 1.5, tier >= 1 ? 0.1 : 0.08, when, 0.012);
        }
        // V nejvyšším stupni ještě přiťuknutí za dvojkou, ať to tlačí dopředu
        if (tier >= 2 && inBeat === 6) {
            this.#strum(root, shape, t.stepDur * 0.9, 0.045, when, 0.008);
        }

        // ---- melodie: kytara vede, výš ji zdvojí hvízdání a trubka ----
        const note = t.melody[step];
        // Na začátku levelu zazní jen půlka smyčky, ale vždycky **celé
        // dvojtaktí** – utnout nápěv po prvním taktu by znamenalo utnout ho
        // před tónem, do kterého celý míří
        if (note !== null && (tier >= 1 || bar % 4 < 2)) {
            // Délku určí mezera do dalšího tónu: tečkovaný rytmus tak odsekává
            // a ležatý závěr fráze zůstane znít přes celý takt
            const dur = t.stepDur * stepsToNext(t.melody, step, 12) * 0.95;
            this.#twang(t.root * 2 * semitone(note), dur, tier >= 1 ? 0.11 : 0.085, when);
            if (tier >= 1) {
                this.#whistle(t.root * 4 * semitone(note), dur, 0.07, when + 0.02);
            }
            if (tier >= 2) {
                this.#trumpet(t.root * 4 * semitone(note), dur, 0.08, when + 0.01);
            }
        }

        // ---- sbor: ležící „á“ pod nápěvem, až v nejvyšším stupni ----
        if (tier >= 2 && bar % 4 === 0 && inBar === 0) {
            this.#chantChord(root, t.stepDur * 14, 0.04, when);
        }
    }

    /**
     * Matematika: minimalistický běh. Puls drží metronom (bicí by tady zněly
     * jako z jiné hry), spodek je ležící sinusovka a melodie se proti taktu
     * postupně posouvá, takže se souzvuky pořád přeskládávají. Harmonii shrne
     * jednou za dva takty souzvuk v přirozeném ladění – opět jediné místo ve
     * skladbě, kde je slyšet celý akord naráz.
     */
    #arrangeMath({t, root, bar, inBar, step, tier, when}) {
        // ---- puls: měkký kopák na čtvrtky, metronom mezi nimi ----
        if (inBar % 4 === 0) this.#kick(when, {top: 140, bottom: 50, dur: 0.14, gain: 0.5});
        if (tier >= 1 && inBar % 2 === 1) this.#tick(when, inBar % 8 === 7);
        if (tier >= 2 && inBar % 8 === 4) this.#snare(when, false);

        // ---- spodek: ležící základ, na půlce taktu kvinta ----
        if (inBar === 0) this.#bassSub(root, t.stepDur * 7, when);
        if (tier >= 1 && inBar === 8) this.#bassSub(root * 1.5, t.stepDur * 6.5, when);

        // ---- melodie: skleněný tón, buňka se proti taktu posouvá ----
        const note = t.melody[step];
        if (note !== null && (tier >= 1 || inBar % 2 === 0)) {
            this.#glass(root * 4 * semitone(note), t.stepDur * (tier >= 1 ? 2.4 : 1.6),
                        tier >= 1 ? 0.10 : 0.07, when);
        }

        // ---- souzvuk v přirozeném ladění: jediná plná harmonie ve skladbě ----
        if (tier >= 1 && bar % 2 === 0 && inBar === 0) {
            this.#ratioChord(root, t.stepDur * 5, tier >= 2 ? 0.06 : 0.045, when);
        }

        // ---- arpeggio v nejvyšším stupni: šestnáctiny přes kvintu a oktávu ----
        if (tier >= 2) {
            const arpNote = t.profile.arp[inBar % t.profile.arp.length];
            this.#tone({
                freq: root * 8 * semitone(arpNote), type: 'triangle',
                dur: t.stepDur * 0.7, gain: 0.04, when, dest: this.musicGain,
            });
        }
    }

    /**
     * Džungle: bubnový kruh. Kostrou je zvonová linka `BELL` – hraje ji
     * dvouzvučný zvonec (gankogui) a opírá se o ni basa i balafonové ostinato.
     * Djembe naproti tomu hrají **do mezer mezi jejími údery**; teprve tím
     * vznikne prokládaná polyrytmika, kvůli které to zní jako víc bubeníků,
     * a ne jako jeden rytmus posílený nástroji.
     *
     * Nahoře je volání a odpověď: sbor hlasů zazpívá harmonii, o dva takty
     * později mu odpoví píšťala. Bicích je tu schválně hodně vrstev – šamanská
     * hudba stojí na hustotě úderů, ne na akordech.
     */
    #arrangeJungle({t, root, bar, inBar, step, tier, when}) {
        // ---- dundun: hluboký buben na těžké doby ----
        if (inBar === 0 || inBar === 8) {
            this.#kick(when, {top: 150, bottom: 44, dur: 0.24, gain: 0.58});
        }
        if (tier >= 2 && inBar === 14) {
            this.#kick(when, {top: 140, bottom: 44, dur: 0.16, gain: 0.52});
        }

        // ---- gankogui: nižší zvon na těžké doby linky, vyšší na zbytek ----
        if (tier >= 1 && BELL.includes(inBar)) {
            this.#gankogui(when, inBar !== 0 && inBar !== 8);
        }

        // ---- djembe: údery mezi doby zvonce (proto ta čísla nejsou v BELL) ----
        if (inBar === 0 || inBar === 10) this.#djembe(when, 'bass');
        if (tier >= 1 && (inBar === 4 || inBar === 12)) this.#djembe(when, 'tone');
        if (tier >= 1 && (inBar === 7 || inBar === 15)) this.#djembe(when, 'slap');
        if (tier >= 2 && (inBar === 2 || inBar === 5 || inBar === 13)) {
            this.#djembe(when, inBar === 5 ? 'slap' : 'tone');
        }

        // ---- chřestidlo: šestnáctinový podklad, na konci taktu otevřené ----
        if (tier >= 1 && inBar % 2 === 1) this.#shekere(when, inBar === 15);

        // ---- basa: doby zvonce, ne ležící tón – z toho je ten tah dopředu ----
        if (BELL.includes(inBar) && (tier >= 1 || inBar % 8 === 0)) {
            this.#bassSub(root, t.stepDur * (inBar === 6 ? 2 : 2.6), when);
        }

        // ---- balafon: ostinato zaklesnuté do bubnů ----
        const note = t.melody[step];
        if (note !== null && (tier >= 1 || bar % 2 === 0)) {
            this.#woodBar(root * 4 * semitone(note), t.stepDur * 2.2,
                          tier >= 1 ? 0.13 : 0.09, when, this.leadGain);
        }

        // ---- sbor hlasů: jediné místo, kde zazní celá harmonie naráz ----
        if (tier >= 1 && bar % 2 === 0 && inBar === 0) {
            this.#chantChord(root, t.stepDur * 7, tier >= 2 ? 0.075 : 0.055, when);
        }

        // ---- odpověď píšťaly na volání sboru (až v nejvyšším stupni) ----
        if (tier >= 2 && bar % 2 === 1 && inBar === 8) {
            this.#flute(root * 4 * semitone(degreeAt(t.scale, bar % 4 === 1 ? 4 : 2)),
                        t.stepDur * 6, 0.08, when);
        }
    }

    // ---- Zvukové efekty ----

    play(name) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;

        switch (name) {
            case 'jump':
                this.#tone({freq: 300, freqTo: 540, type: 'triangle', dur: 0.09, gain: 0.30, when: t});
                break;
            case 'pad':
                this.#tone({freq: 200, freqTo: 900, type: 'square', dur: 0.20, gain: 0.26, when: t});
                break;
            case 'ring':
                this.#tone({freq: 880, type: 'sine', dur: 0.28, gain: 0.26, when: t});
                this.#tone({freq: 1320, type: 'sine', dur: 0.22, gain: 0.16, when: t + 0.02});
                break;
            case 'portal':
                this.#tone({freq: 240, freqTo: 1100, type: 'sawtooth', dur: 0.32, gain: 0.16, when: t});
                break;
            case 'coin':
                this.#tone({freq: 1046, type: 'triangle', dur: 0.08, gain: 0.26, when: t});
                this.#tone({freq: 1568, type: 'triangle', dur: 0.14, gain: 0.24, when: t + 0.06});
                break;
            case 'death':
                this.#tone({freq: 320, freqTo: 55, type: 'square', dur: 0.45, gain: 0.30, when: t});
                this.#tone({freq: 90, freqTo: 40, type: 'sine', dur: 0.6, gain: 0.35, when: t});
                this.#noise({dur: 0.4, gain: 0.35, when: t, type: 'lowpass', freq: 1400});
                break;
            case 'complete':
                // Durový akord na závěr – jediné světlé místo ve hře
                [0, 4, 7, 12].forEach((n, i) => this.#tone({
                    freq: 523 * semitone(n), type: 'triangle', dur: 0.22,
                    gain: 0.28, when: t + i * 0.1,
                }));
                [0, 4, 7, 12].forEach(n => this.#tone({
                    freq: 523 * semitone(n), type: 'triangle', dur: 0.9,
                    gain: 0.14, when: t + 0.42,
                }));
                break;
            case 'win':
                [0, 4, 7, 12, 16, 19].forEach((n, i) => this.#tone({
                    freq: 523 * semitone(n), type: 'triangle', dur: 0.3,
                    gain: 0.26, when: t + i * 0.12,
                }));
                [0, 7, 12, 16].forEach(n => this.#tone({
                    freq: 523 * semitone(n), type: 'triangle', dur: 1.4,
                    gain: 0.16, when: t + 0.78,
                }));
                break;
        }
    }

    // ---- Stavební kameny ----

    /** Jeden tón s obálkou (rychlý náběh, exponenciální doznění). */
    #tone({freq, freqTo, type = 'square', dur, gain, when, dest = this.sfxGain}) {
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, when);
        if (freqTo) osc.frequency.exponentialRampToValueAtTime(freqTo, when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        osc.connect(env).connect(dest);
        osc.start(when);
        osc.stop(when + dur + 0.02);
    }

    // ---- Basy jednotlivých témat ----

    /** Basa ze dvou rozladěných pil – hustší a naléhavější než jeden oscilátor. */
    #bassSaw(freq, dur, when) {
        for (const detune of [-7, 7]) {
            const osc = this.ctx.createOscillator();
            const env = this.ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, when);
            osc.detune.value = detune;

            env.gain.setValueAtTime(0.0001, when);
            env.gain.exponentialRampToValueAtTime(0.16, when + 0.01);
            env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

            osc.connect(env).connect(this.musicGain);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }
    }

    /**
     * Ledový spodek: čistý sinusový základ s kvintou, pomalý náběh a dlouhé
     * doznění – nedusá, jen leží pod zvonky.
     */
    #bassSub(freq, dur, when) {
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(0.2, when + 0.09);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        env.connect(this.musicGain);

        for (const [ratio, type, level] of [[1, 'sine', 1], [1.5, 'triangle', 0.22]]) {
            const osc = this.ctx.createOscillator();
            const mix = this.ctx.createGain();
            mix.gain.value = level;
            osc.type = type;
            osc.frequency.value = freq * ratio;
            osc.connect(mix).connect(env);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }
    }

    /** Ohnivá basa: pila se spodním čtvercem přes měkké oříznutí – chraplavá a špinavá. */
    #bassGrowl(freq, dur, when) {
        const shaper = this.ctx.createWaveShaper();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        shaper.curve = DIST_CURVE;
        filter.type = 'lowpass';        // oříznutí nasype výšky, filtr je zase uklidí
        filter.frequency.value = 1900;

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(0.19, when + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        shaper.connect(filter).connect(env).connect(this.musicGain);

        for (const [ratio, type, level] of [[1, 'sawtooth', 0.7], [0.5, 'square', 0.5]]) {
            const osc = this.ctx.createOscillator();
            const mix = this.ctx.createGain();
            mix.gain.value = level;
            osc.type = type;
            osc.frequency.value = freq * ratio;
            osc.connect(mix).connect(shaper);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }
    }

    /**
     * Hluboká drnknutá struna zdvojená oktávou (guitarrón). Zní dřevěně
     * a měkce, takže na pouštní pláni drží spodek, aniž by dupala jako basa
     * ostatních témat.
     */
    #guitarron(freq, dur, gain, when) {
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        filter.type = 'lowpass';
        filter.Q.value = 1;
        filter.frequency.setValueAtTime(freq * 9, when);
        filter.frequency.exponentialRampToValueAtTime(freq * 2, when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        filter.connect(env).connect(this.musicGain);

        for (const [ratio, type, level] of [[1, 'triangle', 1], [2, 'sawtooth', 0.3]]) {
            const osc = this.ctx.createOscillator();
            const mix = this.ctx.createGain();
            mix.gain.value = level;
            osc.type = type;
            osc.frequency.value = freq * ratio;
            osc.connect(mix).connect(filter);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }
    }

    // ---- Melodické hlasy ----

    /**
     * Ledový zvonek: kmitočtová modulace v nesouzvučném poměru. Index modulace
     * hned opadne, takže náraz zazvoní kovově a doznívá už čistý tón.
     */
    #bell(freq, dur, gain, when) {
        const carrier = this.ctx.createOscillator();
        const mod = this.ctx.createOscillator();
        const modGain = this.ctx.createGain();
        const env = this.ctx.createGain();

        carrier.type = 'sine';
        carrier.frequency.value = freq;
        mod.type = 'sine';
        mod.frequency.value = freq * 2.76;      // poměr zvonu, ne harmonická řada

        modGain.gain.setValueAtTime(freq * 3, when);
        modGain.gain.exponentialRampToValueAtTime(freq * 0.05, when + dur * 0.35);
        mod.connect(modGain).connect(carrier.frequency);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        carrier.connect(env).connect(this.leadGain);
        for (const osc of [carrier, mod]) {
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }
    }

    /**
     * Mariachi trubka. Žesť dělá otevírající se dolní propust vedená obálkou –
     * na nasazení to „zaskočí“ a pak tón sedne. Krátké nasazení zdola je jen
     * naznačené (ne portamento) a vibrato nastupuje **až v druhé půlce tónu** –
     * kdyby drželo od začátku, zněla by z toho harmonika, ne trubka.
     */
    #trumpet(freq, dur, gain, when) {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 0.975, when);
        osc.frequency.linearRampToValueAtTime(freq, when + 0.03);

        lfo.type = 'sine';
        lfo.frequency.value = 5.2;
        lfoGain.gain.setValueAtTime(0, when);
        lfoGain.gain.setValueAtTime(0, when + dur * 0.45);
        lfoGain.gain.linearRampToValueAtTime(14, when + dur);   // vibrato v centech
        lfo.connect(lfoGain).connect(osc.detune);

        filter.type = 'lowpass';
        filter.Q.value = 1.2;
        filter.frequency.setValueAtTime(500, when);
        filter.frequency.linearRampToValueAtTime(Math.min(freq * 7, 7000), when + 0.05);
        filter.frequency.exponentialRampToValueAtTime(Math.min(freq * 3, 4000), when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.025);
        env.gain.setValueAtTime(gain, when + dur * 0.7);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        osc.connect(filter).connect(env).connect(this.leadGain);
        for (const node of [osc, lfo]) {
            node.start(when);
            node.stop(when + dur + 0.02);
        }
    }

    /**
     * Westernová kytara. Struna se drnkne přes úzké pásmo kolem 2 kHz – odtud
     * ten kovový „twang“ – a hlasitost pak rozkmitá **tremolo** (tepání kolem
     * 7 Hz). Právě to chvění, a ne ozvěna, dělá ze sólové kytary western:
     * poušť žádnou ozvěnu nemá, protože v jejím tempu se každý odraz slije
     * s nápěvem.
     *
     * Tón na nasazení krátce klesne, jako když prst uhne po struně – bez toho
     * zní kytara jako varhany.
     */
    #twang(freq, dur, gain, when) {
        const body = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();
        const trem = this.ctx.createGain();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();

        body.type = 'peaking';
        body.frequency.value = 2000;
        body.Q.value = 1.4;
        body.gain.value = 9;

        // Tremolo: hlasitost se kolem střední hodnoty houpe nahoru a dolů
        trem.gain.value = 0.72;
        lfo.type = 'sine';
        lfo.frequency.value = 7;
        lfoGain.gain.value = 0.28;
        lfo.connect(lfoGain).connect(trem.gain);
        lfo.start(when);
        lfo.stop(when + dur + 0.02);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.008);
        env.gain.exponentialRampToValueAtTime(gain * 0.35, when + dur * 0.5);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        body.connect(trem).connect(env).connect(this.leadGain);

        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 1.03, when);
        osc.frequency.exponentialRampToValueAtTime(freq, when + 0.05);
        osc.connect(body);
        osc.start(when);
        osc.stop(when + dur + 0.02);
    }

    /**
     * Hvízdání. Skoro čistá sinusovka s náznakem druhé harmonické – lidský
     * hvizd nemá vyšší složky, a proto je nejlíp slyšet i přes cval. Tón se
     * nabere krátkým sklouznutím zdola a vibrato nastupuje až ve druhé půlce;
     * kdyby drželo od začátku, byla by z toho siréna, ne člověk.
     */
    #whistle(freq, dur, gain, when) {
        const env = this.ctx.createGain();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.05);
        env.gain.setValueAtTime(gain, when + dur * 0.8);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        env.connect(this.leadGain);

        lfo.type = 'sine';
        lfo.frequency.value = 5.4;
        lfoGain.gain.setValueAtTime(0, when);
        lfoGain.gain.setValueAtTime(0, when + dur * 0.45);
        lfoGain.gain.linearRampToValueAtTime(22, when + dur);    // vibrato v centech
        lfo.connect(lfoGain);
        lfo.start(when);
        lfo.stop(when + dur + 0.02);

        for (const [ratio, level] of [[1, 1], [2, 0.06]]) {
            const osc = this.ctx.createOscillator();
            const mix = this.ctx.createGain();
            mix.gain.value = level;
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq * ratio * 0.97, when);
            osc.frequency.exponentialRampToValueAtTime(freq * ratio, when + 0.06);
            lfoGain.connect(osc.detune);
            osc.connect(mix).connect(env);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }

        // Dech kolem tónu – bez něj je hvizd jen pípnutí generátoru
        this.#noise({dur: dur * 0.4, gain: gain * 0.12, when, type: 'bandpass',
                     freq, q: 18, dest: env});
    }

    /**
     * Skleněný tón matematického světa: sinus se svou kvintou a oktávou
     * v čistých poměrech (3/2 a 2/1), měkký náběh a dlouhý dozvuk. Nemá
     * chvění ani ostrou hranu – proto zní jako skleněná harmonika, ne jako
     * syntezátor, a nepere se s tikáním metronomu.
     */
    #glass(freq, dur, gain, when) {
        const env = this.ctx.createGain();

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.035);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        env.connect(this.leadGain);

        for (const [ratio, level] of [[1, 1], [1.5, 0.28], [2, 0.16]]) {
            const osc = this.ctx.createOscillator();
            const mix = this.ctx.createGain();
            mix.gain.value = level;
            osc.type = 'sine';
            osc.frequency.value = freq * ratio;
            osc.connect(mix).connect(env);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }
    }

    /**
     * Balafon (africký předchůdce marimby). Kromě základního tónu zní i čtvrtá
     * harmonická, tedy tón o dvě oktávy výš – přesně na ni se dřevěné desky
     * vybrušují a právě podle ní je nástroj slyšet. Vyšší složky hned opadnou,
     * takže z nich zbude jen ťuknutí paličky a dál doznívá čistý tón.
     *
     * Na rezonátorech z tykví jsou navíc napnuté blány (mirlitony), které
     * k tónu přidávají brnění – bez něj by z toho byla koncertní marimba,
     * ne nástroj z bubnového kruhu.
     */
    #woodBar(freq, dur, gain, when, dest = this.musicGain) {
        const env = this.ctx.createGain();

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        env.connect(dest);

        for (const [ratio, level, decay] of [[1, 1, 1], [4, 0.45, 0.22], [10, 0.1, 0.1]]) {
            const osc = this.ctx.createOscillator();
            const mix = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq * ratio;
            mix.gain.setValueAtTime(level, when);
            mix.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(dur * decay, 0.02));
            osc.connect(mix).connect(env);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }

        // Brnění mirlitonů – krátké a tiché, jinak přebije samotný tón
        this.#noise({dur: Math.min(dur * 0.45, 0.12), gain: gain * 0.3, when,
                     type: 'bandpass', freq: Math.min(freq * 3, 6000), q: 6, dest});
    }

    /**
     * Dřevěná píšťala. Sinusový tón se slabou oktávou a k němu dech – úzký
     * pásek šumu kolem téhož kmitočtu. Nasazení je měkké a vibrato nastupuje
     * až ve druhé půlce tónu; kdyby drželo od začátku, byla by z toho zase
     * harmonika (viz pouštní trubka).
     */
    #flute(freq, dur, gain, when) {
        const env = this.ctx.createGain();

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.07);
        env.gain.setValueAtTime(gain, when + dur * 0.6);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        env.connect(this.leadGain);

        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 4.6;
        lfoGain.gain.setValueAtTime(0, when);
        lfoGain.gain.setValueAtTime(0, when + dur * 0.5);
        lfoGain.gain.linearRampToValueAtTime(11, when + dur);    // vibrato v centech
        lfo.connect(lfoGain);
        lfo.start(when);
        lfo.stop(when + dur + 0.02);

        for (const [ratio, level] of [[1, 1], [2, 0.12]]) {
            const osc = this.ctx.createOscillator();
            const mix = this.ctx.createGain();
            mix.gain.value = level;
            osc.type = 'sine';
            osc.frequency.value = freq * ratio;
            lfoGain.connect(osc.detune);
            osc.connect(mix).connect(env);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }

        // Dech kolem tónu – bez něj by to byla jen sinusovka, ne píšťala
        this.#noise({dur, gain: gain * 0.6, when, type: 'bandpass', freq, q: 14, dest: env});
    }

    /** Drnknutá struna (kytara): pila přes rychle se zavírající filtr. */
    #pluck(freq, dur, gain, when, dest = this.musicGain) {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.value = freq;

        filter.type = 'lowpass';
        filter.Q.value = 2;
        filter.frequency.setValueAtTime(Math.min(freq * 6, 4200), when);
        filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.2, 200), when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        osc.connect(filter).connect(env).connect(dest);
        osc.start(when);
        osc.stop(when + dur + 0.02);
    }

    // ---- Akordy: v každém tématu jinak, ale vždycky jen jako interpunkce ----

    /**
     * Akordový úder. Čtyři rozladěné pily zahrají mollový akord přes filtr,
     * který se s úderem otevře a hned zase přivře – odtud ten „wow“ náraz.
     * Ve skladbě je to jediné místo, kde zazní celá harmonie naráz: basa drží
     * jen základní tón a melodie jednohlas, takže střed jinak zeje prázdnotou.
     * Zní jen jako interpunkce (každý druhý takt), ne jako podklad.
     */
    #stab(root, dur, gain, when) {
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        filter.type = 'lowpass';
        filter.Q.value = 3;
        filter.frequency.setValueAtTime(3400, when);
        filter.frequency.exponentialRampToValueAtTime(520, when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        filter.connect(env).connect(this.musicGain);

        this.track.profile.chord.forEach((note, i) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = root * 2 * semitone(note);
            osc.detune.value = [-8, -3, 3, 8][i % 4];   // rozladění dá akordu šířku
            osc.connect(filter);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        });
    }

    /** Ledová plocha: akord s pomalým náběhem, který se otevře a zase zavře. */
    #swell(root, dur, gain, when) {
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        filter.type = 'lowpass';
        filter.Q.value = 1.5;
        filter.frequency.setValueAtTime(700, when);
        filter.frequency.exponentialRampToValueAtTime(2800, when + dur * 0.5);
        filter.frequency.exponentialRampToValueAtTime(900, when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + dur * 0.4);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        filter.connect(env).connect(this.musicGain);

        this.track.profile.chord.forEach((note, i) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.value = root * 2 * semitone(note);
            osc.detune.value = [-9, -4, 4, 9, 0][i % 5];
            osc.connect(filter);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        });
    }

    /**
     * Elektrická kytara přes nakopnutý aparát: struny → **jedno** zkreslení →
     * reproduktorová bedna. To, že jdou všechny tóny do téhož zkreslení, je na
     * tom podstatné – teprve tím, že se v něm potkají, vznikne ten drásavý
     * souzvuk kvintakordu. Kdyby se každý tón zkreslil zvlášť a sečetl až
     * potom, zněly by spolu jako varhany.
     *
     * `mute` je dlaň položená na struny u kobylky: tón se utne a ztmavne, čímž
     * z akordů vznikne dusaný chod.
     */
    #guitar(freqs, dur, gain, when, {mute = false} = {}) {
        const strings = this.ctx.createGain();
        const drive = this.ctx.createGain();
        const shaper = this.ctx.createWaveShaper();
        const tone = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        strings.gain.value = 1 / freqs.length;  // hmat nesmí být hlasitější jen tím, že má víc strun
        drive.gain.value = mute ? 3.4 : 4.5;    // „gain“ na aparátu: čím víc, tím špinavěji
        shaper.curve = AMP_CURVE;

        tone.type = 'lowpass';
        tone.Q.value = 0.9;
        // Dlaň barvu s dozníváním stahuje, volná struna zůstane otevřená
        tone.frequency.setValueAtTime(mute ? 2600 : 4600, when);
        if (mute) tone.frequency.exponentialRampToValueAtTime(1100, when + dur);

        // Zkreslený tón drží skoro celou délku a pustí se až na konci
        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.004);
        env.gain.setValueAtTime(gain, when + dur * (mute ? 0.45 : 0.75));
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        strings.connect(drive).connect(shaper).connect(tone).connect(this.#cabinet(env));
        env.connect(this.musicGain);

        freqs.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = freq;
            osc.detune.value = [0, 7, -7, 11][i % 4];   // struny nejsou nikdy naladěné úplně přesně
            osc.connect(strings);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        });
    }

    /**
     * Reproduktorová bedna kytarového aparátu. Zkreslená pila je sama o sobě
     * bzučák: teprve když se z ní ořízne spodek, vyzdvihne střed kolem 2 kHz
     * a nad 5 kHz utne sykot, zní jako kytara v kombu. Horní propust zároveň
     * odvádí stejnosměrnou složku z nesouměrné `AMP_CURVE`.
     *
     * Vrací **vstup** řetězu, výstup je rovnou zapojený do `dest`.
     */
    #cabinet(dest) {
        const cut = this.ctx.createBiquadFilter();
        const body = this.ctx.createBiquadFilter();
        const air = this.ctx.createBiquadFilter();

        cut.type = 'highpass';
        cut.frequency.value = 85;
        body.type = 'peaking';
        body.frequency.value = 2100;
        body.Q.value = 1.1;
        body.gain.value = 7;
        air.type = 'lowpass';
        air.frequency.value = 5200;
        air.Q.value = 0.9;

        cut.connect(body).connect(air).connect(dest);
        return cut;
    }

    /**
     * Ohnivý úder: kvintakord bez tercie ze stejného aparátu jako doprovod
     * (`#guitar`), ale **o oktávu výš** – zní jako druhá kytara, která se do
     * jedničky opře, ne jako zesílený doprovod. Kdyby hrál ve stejné poloze,
     * jen by figuru zdvojil a v mixu by se ztratil.
     */
    #powerStab(root, dur, gain, when) {
        this.#guitar(this.track.profile.chord.map(note => root * 4 * semitone(note)),
                     dur, gain, when);
    }

    /**
     * Souzvuk matematického světa: mollový akord laděný podíly celých čísel
     * (`JUST_MINOR`), ne půltóny. Tóny se do sebe zamknou beze zázněje – vedle
     * temperovaného zbytku hry to zní nezvykle čistě, skoro jako varhany.
     * Filtr se s úderem otevře a hned zase přivírá, aby to zůstala interpunkce
     * a ne ležící plocha.
     */
    #ratioChord(root, dur, gain, when) {
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        filter.type = 'lowpass';
        filter.Q.value = 1;
        filter.frequency.setValueAtTime(2800, when);
        filter.frequency.exponentialRampToValueAtTime(700, when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.05);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        filter.connect(env).connect(this.musicGain);

        JUST_MINOR.forEach((ratio, i) => {
            const osc = this.ctx.createOscillator();
            const mix = this.ctx.createGain();
            // Vyšší tóny akordu tišeji, ať souzvuk drží tvar
            mix.gain.value = 1 / (1 + i * 0.6);
            osc.type = i % 2 === 0 ? 'sine' : 'triangle';
            osc.frequency.value = root * 2 * ratio;
            osc.connect(mix).connect(filter);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        });
    }

    /**
     * Kytarové drnknutí: tóny akordu těsně za sebou, jak je palec přejede.
     * `shape` je akord (mollový, na dominantě dur se septimou), `spread`
     * rozestup strun – čím kratší, tím ostřejší přiťuknutí.
     */
    #strum(root, shape, dur, gain, when, spread) {
        shape.forEach((note, i) => {
            this.#pluck(root * 2 * semitone(note), dur, gain, when + i * spread, this.musicGain);
        });
    }

    /**
     * Lidský hlas. Dvě rozladěné pily vede trojice pásmových propustí naladěná
     * na formanty samohlásky „á“ (700, 1150 a 2600 Hz) – právě formanty dělají
     * z tónu hlas, bez nich by ze sboru byla obyčejná plocha. Tón se nabírá
     * krátkým náběhem zdola a vibrato nastupuje až ve druhé půlce; kdyby drželo
     * od začátku, zněla by z toho siréna.
     */
    #chant(freq, dur, gain, when, dest = this.musicGain) {
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.1);
        env.gain.setValueAtTime(gain, when + dur * 0.6);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        env.connect(dest);

        // Společný zdroj obou pil, ze kterého si formanty berou svoje pásma
        const source = this.ctx.createGain();
        source.gain.value = 0.5;
        for (const [freqHz, q, level] of [[700, 8, 1], [1150, 10, 0.5], [2600, 12, 0.2]]) {
            const formant = this.ctx.createBiquadFilter();
            const mix = this.ctx.createGain();
            formant.type = 'bandpass';
            formant.frequency.value = freqHz;
            formant.Q.value = q;
            mix.gain.value = level;
            source.connect(formant).connect(mix).connect(env);
        }

        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 5;
        lfoGain.gain.setValueAtTime(0, when);
        lfoGain.gain.setValueAtTime(0, when + dur * 0.5);
        lfoGain.gain.linearRampToValueAtTime(16, when + dur);    // vibrato v centech
        lfo.connect(lfoGain);
        lfo.start(when);
        lfo.stop(when + dur + 0.02);

        // Dva zpěváci nikdy nezazpívají úplně stejný tón – z toho je ta šířka
        for (const detune of [-7, 8]) {
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq * 0.94, when);
            osc.frequency.exponentialRampToValueAtTime(freq, when + 0.08);
            osc.detune.value = detune;
            lfoGain.connect(osc.detune);
            osc.connect(source);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }
    }

    /**
     * Sbor: hlasy nasadí krátce po sobě, jak se lidi v kruhu přidávají. Je to
     * jediné místo ve skladbě, kde zazní celá harmonie naráz – basa drží jen
     * základ a balafonové ostinato je jednohlas.
     */
    #chantChord(root, dur, gain, when) {
        this.track.profile.chord.forEach((note, i) => {
            this.#chant(root * 2 * semitone(note), dur - i * 0.06,
                        gain * (1 - i * 0.15), when + i * 0.06);
        });
    }

    // ---- Bicí ----

    /** Šumový úder (bicí, výbuch) přes filtr. */
    #noise({dur, gain, when, type = 'highpass', freq = 1000, q = 1, dest = this.sfxGain}) {
        const src = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        src.buffer = this.noiseBuffer;
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;

        env.gain.setValueAtTime(gain, when);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        src.connect(filter).connect(env).connect(dest);
        src.start(when);
        src.stop(when + dur + 0.02);
    }

    /** Kopák: sinusový pád. Témata si mění barvu i délku. */
    #kick(when, {top = 170, bottom = 42, dur = 0.16, gain = 0.62} = {}) {
        this.#tone({freq: top, freqTo: bottom, type: 'sine', dur, gain, when, dest: this.musicGain});
    }

    #snare(when, drop) {
        this.#noise({dur: drop ? 0.18 : 0.12, gain: drop ? 0.26 : 0.18,
                     when, freq: 1200, dest: this.musicGain});
        this.#tone({freq: 220, freqTo: 130, type: 'triangle', dur: 0.09,
                    gain: 0.16, when, dest: this.musicGain});
    }

    /** Tom: krátký sešup s dřevěným tělem – z něj se skládá nájezd na konci smyčky. */
    #tom(when, freq) {
        this.#tone({freq, freqTo: freq * 0.6, type: 'sine', dur: 0.2, gain: 0.3,
                    when, dest: this.musicGain});
        this.#noise({dur: 0.06, gain: 0.05, when, type: 'lowpass', freq: 1200,
                     dest: this.musicGain});
    }

    #hat(when, open) {
        this.#noise({dur: open ? 0.16 : 0.03, gain: open ? 0.09 : 0.06,
                     when, freq: 7000, dest: this.musicGain});
    }

    /**
     * Rolničky: hrst malých kulatých zvonečků, kterými se zatřese. Zvuk je
     * schválně **nesouzvučný** – zvonečky nejsou navzájem naladěné, takže z nich
     * není akord, ale třpyt. Skládá se proto z šumu v pásmu kolem 4 kHz (to je
     * ten kovový chřest) a tří vysokých sinusovek v nesoudělných poměrech;
     * harmonické poměry by z hrsti zvonečků udělaly jeden zvon.
     *
     * `accent` je doba: hlasitější a o něco delší, aby se v běhu osminek
     * poznalo, kde takt začíná.
     */
    #sleighBells(when, accent) {
        const gain = accent ? 0.08 : 0.05;
        const dur = accent ? 0.17 : 0.11;

        this.#noise({dur, gain: gain * 0.9, when, type: 'bandpass', freq: 4200, q: 2,
                     dest: this.musicGain});
        this.#noise({dur: dur * 0.6, gain: gain * 0.5, when, type: 'bandpass', freq: 7400,
                     q: 3, dest: this.musicGain});

        for (const [ratio, level] of [[1, 0.5], [1.37, 0.34], [1.83, 0.24]]) {
            this.#tone({freq: 2900 * ratio, type: 'sine', dur: dur * 0.8,
                        gain: gain * level, when, dest: this.musicGain});
        }
    }

    /** Prasknutí ledu místo virblu: suché lupnutí a ozvěna vysokého šumu. */
    #iceCrack(when) {
        this.#noise({dur: 0.05, gain: 0.24, when, freq: 5200, dest: this.musicGain});
        this.#noise({dur: 0.3, gain: 0.07, when: when + 0.02, type: 'bandpass',
                     freq: 3000, q: 6, dest: this.musicGain});
        this.#tone({freq: 1800, freqTo: 700, type: 'triangle', dur: 0.05,
                    gain: 0.1, when, dest: this.musicGain});
    }

    /** Ohnivý uhlík: krátké prasknutí uprostřed pásma. */
    #crackle(when) {
        this.#noise({dur: 0.07, gain: 0.1, when, type: 'bandpass',
                     freq: 1800, q: 4, dest: this.musicGain});
    }

    /**
     * Metronom místo hi-hat: cvaknutí odměřující puls, na konci taktu vyšší.
     * Krátké schválně – delší zvuk by z něj udělal nástroj, a on má být měřítko.
     */
    #tick(when, accent) {
        this.#tone({freq: accent ? 3200 : 2500, type: 'sine', dur: 0.02,
                    gain: accent ? 0.1 : 0.06, when, dest: this.musicGain});
        this.#noise({dur: 0.012, gain: 0.05, when, freq: 6500, dest: this.musicGain});
    }

    /**
     * Kopyta cválajícího koně – **tlukot dvou kokosových skořápek**, jak se
     * kůň odjakživa dělá u filmu. Dutá skořápka po úderu chvíli zvoní, k tomu
     * cvakne dřevo o dřevo a pod tím žuchne dopad do písku.
     *
     * `weight` říká, jak kůň došlápne: `strong` je dopad na přízvučnou dobu
     * (nejhlubší a nejdelší), `medium` našlápnutí, `soft` proklouznutí mezi
     * dobami. Bez těch tří vah zbude ze cvalu strojové ťukání.
     */
    #hooves(when, weight) {
        // Skořápka je dutá polokoule: má pár **vlastních tónů v nesoudělných
        // poměrech** (1 : 1,58 : 2,9), které po úderu rychle dozní. Kdyby byly
        // v harmonické řadě, zněl by z toho tón, a ne dřevo.
        const base = weight === 'strong' ? 380 : weight === 'soft' ? 610 : 470;
        // Doznělka je krátká schválně: na nejrychlejším pouštním levelu je mezi
        // údery jen osmdesát milisekund a delší zvonění by se slilo v hučení
        const ring = weight === 'strong' ? 0.075 : weight === 'soft' ? 0.038 : 0.055;
        const gain = weight === 'strong' ? 0.3 : weight === 'soft' ? 0.08 : 0.16;

        for (const [ratio, level, decay] of [[1, 1, 1], [1.58, 0.45, 0.65], [2.9, 0.14, 0.3]]) {
            const osc = this.ctx.createOscillator();
            const env = this.ctx.createGain();

            osc.type = 'sine';
            // Náraz tón na okamžik vytlačí nahoru a on pak sedne – to je ten
            // dřevěný „klop“; bez toho je z úderu pípnutí
            osc.frequency.setValueAtTime(base * ratio * 1.08, when);
            osc.frequency.exponentialRampToValueAtTime(base * ratio, when + 0.012);

            env.gain.setValueAtTime(0.0001, when);
            env.gain.exponentialRampToValueAtTime(gain * level, when + 0.002);
            env.gain.exponentialRampToValueAtTime(0.0001, when + ring * decay);

            osc.connect(env).connect(this.musicGain);
            osc.start(when);
            osc.stop(when + ring + 0.02);
        }

        // Cvaknutí skořápky o skořápku – teprve z něj je slyšet dřevo
        this.#noise({dur: 0.008, gain: gain * 0.5, when, type: 'highpass',
                     freq: 2600, dest: this.musicGain});
        // …a pod tím dusot: tupý dopad do písku
        this.#tone({freq: weight === 'strong' ? 150 : 190, freqTo: 70, type: 'sine',
                    dur: weight === 'strong' ? 0.06 : 0.035, gain: gain * 0.7,
                    when, dest: this.musicGain});
    }

    /**
     * Prásknutí bičem: ostrý šum shora a hned za ním krátký odraz od skal.
     * Otevírá frázi, takže musí být slyšet přes cval – ale je krátké, aby
     * z něj nebyl virbl.
     */
    #whipCrack(when) {
        this.#noise({dur: 0.02, gain: 0.26, when, freq: 6000, dest: this.musicGain});
        this.#noise({dur: 0.14, gain: 0.09, when: when + 0.015, type: 'bandpass',
                     freq: 2400, q: 1.2, dest: this.musicGain});
    }

    /**
     * Gankogui: kovaný dvouzvučný zvonec, kterým se v bubnovém kruhu udává
     * linka. Kov nezní v harmonické řadě, proto jsou složky v nenásobných
     * poměrech – a rychle opadnou, protože zvonec má cinknout, ne zpívat.
     */
    #gankogui(when, high) {
        const base = high ? 760 : 500;
        const dur = high ? 0.13 : 0.2;
        const env = this.ctx.createGain();

        env.gain.setValueAtTime(0.0001, when);
        // Zvonec musí prořezat bubny – v kruhu je to on, kdo drží linku
        env.gain.exponentialRampToValueAtTime(high ? 0.17 : 0.21, when + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        env.connect(this.musicGain);

        for (const [ratio, level] of [[1, 1], [2.41, 0.45], [3.83, 0.22]]) {
            const osc = this.ctx.createOscillator();
            const mix = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = base * ratio;
            mix.gain.value = level;
            osc.connect(mix).connect(env);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }

        // Úder paličky – bez něj zvonec nezačíná, jen se objeví
        this.#noise({dur: 0.012, gain: 0.045, when, freq: 5000, dest: this.musicGain});
    }

    /**
     * Djembe: jedna blána a tři různé údery. Basa je dutá rána do středu,
     * tón úder na okraj (výš a kratší) a slap plácnutí prsty – skoro jen šum.
     * Aby kruh zněl jako víc bubeníků, musí být slyšet rozdíl mezi údery,
     * ne jenom jejich hlasitost.
     */
    #djembe(when, kind) {
        const {top, bottom, dur, gain, hiss, band, q} = {
            bass: {top: 210, bottom: 86, dur: 0.3, gain: 0.36, hiss: 0.09, band: 320, q: 1},
            tone: {top: 340, bottom: 195, dur: 0.15, gain: 0.32, hiss: 0.1, band: 1200, q: 1.5},
            slap: {top: 640, bottom: 400, dur: 0.05, gain: 0.13, hiss: 0.2, band: 3400, q: 1.2},
        }[kind];

        this.#tone({freq: top, freqTo: bottom, type: 'sine', dur, gain, when,
                    dest: this.musicGain});
        this.#noise({dur: kind === 'slap' ? 0.06 : 0.045, gain: hiss, when,
                     type: 'bandpass', freq: band, q, dest: this.musicGain});
    }

    /** Chřestidlo z tykve v síti korálků – korálky nedopadnou úplně naráz. */
    #shekere(when, open) {
        this.#noise({dur: open ? 0.14 : 0.045, gain: open ? 0.075 : 0.055, when,
                     type: 'bandpass', freq: 5200, q: 1.2, dest: this.musicGain});
        this.#noise({dur: 0.03, gain: 0.03, when: when + 0.012, freq: 7000,
                     dest: this.musicGain});
    }

    #crash(when) {
        this.#noise({dur: 1.1, gain: 0.16, when, freq: 4500, dest: this.musicGain});
    }

    /** Nájezd: šum, kterému stoupá hlasitost i filtr, než se smyčka zopakuje. */
    #riser(when, dur) {
        const src = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        src.buffer = this.noiseBuffer;
        src.loop = true;
        filter.type = 'bandpass';
        filter.Q.value = 3;
        filter.frequency.setValueAtTime(400, when);
        filter.frequency.exponentialRampToValueAtTime(6000, when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(0.14, when + dur * 0.95);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        src.connect(filter).connect(env).connect(this.musicGain);
        src.start(when);
        src.stop(when + dur + 0.02);
    }
}

// Bílý šum na jednu sekundu – pro všechny šumové zvuky se pak jen přehrává znovu
function makeNoise(ctx) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

function readMuted() {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}
