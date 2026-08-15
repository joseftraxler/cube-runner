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
 * **Každé téma prostředí má vlastní motiv** (`THEMES`): jinou stupnici, harmonii,
 * tempo, nástroje i rytmus. Beztémové levely drží temné synthwave, led hraje
 * pomalé zvonky nad ležícím podkladem, oheň dusá chraplavým riffem, poušť
 * zní jako mexické mariachi – guitarrón, vihuela a dvojice trubek v terciích –,
 * matematický svět běží minimalisticky (metronom, skleněné tóny, souměrné
 * stupnice a melodická buňka, která se proti taktu posouvá) a džungle je africký
 * bubnový kruh: kovový zvonec drží linku, djembe hrají do jejích mezer, balafon
 * na to skládá ostinato a nad vším zpívá sbor hlasů.
 *
 * Dramatický ráz drží všechna témata kromě pouště – **mariachi je schválně
 * veselé**, hraje v dur na I–IV–V a nesnaží se o napětí. Mollová kadence
 * s clave a palmas z něj dělala obecnou „latinu“; tady má znít Mexiko.
 *
 * V rámci tématu má každý level vlastní stupnici, harmonii i základní tón podle
 * svého čísla a tempo podle své rychlosti; melodie se losuje ze seedu podle
 * čísla levelu, takže je pokaždé stejná.
 *
 * `Game` zvuku jen říká, co se stalo (`play('jump')`), jestli má hrát hudba
 * (`setMusicOn`) a jaké je téma levelu (`setTrack`). Zvuk sám o hře nic neví.
 */

const STORAGE_KEY = 'cube-runner-muted';

const STEPS_PER_BAR = 16;
const BARS = 8;
const PATTERN_STEPS = STEPS_PER_BAR * BARS;

// Hranice postupu levelem, na kterých se přidá další vrstva nástrojů
const TIERS = [0.28, 0.58];

// O kolik dopředu se plánují tóny (s) – kryje výkyvy časovače
const LOOKAHEAD = 0.15;

// Stupnice jako půltóny od základního tónu. Až na poušť samé mollové – kvůli
// atmosféře; mariachi je jediné téma, které má znít vesele, a to bez dur nejde.
const SCALE = {
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
    major: [0, 2, 4, 5, 7, 9, 11],          // durová – ranchera se hraje v dur
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
 * Motivy podle tématu prostředí. Každý drží stupnice, harmonie, základní tóny,
 * tempo, nastavení filtru a dozvuku a jméno aranžmá (`arrange`), podle kterého
 * `#playStep` vybere, čím a jak se hraje. Uvnitř tématu se pole indexují číslem
 * levelu, takže dva levely stejného tématu nezní stejně – proto mají čtyři prvky.
 */
const THEMES = {
    // Levely bez tématu – temné synthwave, jak hra zněla od začátku
    default: {
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
    },

    // Ledová jeskyně – pomalé zvonky, ležící plocha, praskání ledu místo virblu
    ice: {
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
    },

    // Sopečná sloj – chraplavá basa, dvojkopák, opakovaný riff a uhlíky v pozadí
    fire: {
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
        gain: [0.50, 0.64, 0.78],
        leadGain: 0.45,
        delay: {steps: 2, feedback: 0.18, mix: 0.25},   // těsná ozvěna, ať se riff nerozmaže
    },

    /**
     * Poušť – mexické mariachi, jak se hraje na náměstí: guitarrón, vihuela,
     * dvojice trubek v terciích a housle. **Jediné téma ve hře, které stojí
     * v dur a nemá být dramatické** – ranchera je veselá, a mollová kadence
     * z ní dělala něco mezi flamencem a filmovou hudbou.
     *
     * Harmonie je proto I–IV–V (0–5–7 půltónů) a nic víc; mollová šestka ani
     * snížená sedmička sem nepatří.
     */
    desert: {
        arrange: 'desert',
        melody: 'mariachi',
        bpm: 116,
        scales: [SCALE.major, SCALE.majorPenta, SCALE.majorHexa, SCALE.major],
        // Tercie druhé trubky se harmonizují po durové stupnici, i když melodie
        // běží po pentatonice – ta některé stupně nemá a vyšla by z toho kvarta
        harmony: SCALE.major,
        progressions: [
            [0, 0, 7, 7, 0, 0, 5, 7],
            [0, 0, 5, 5, 7, 7, 0, 0],
            [0, 5, 0, 7, 0, 5, 7, 0],
            [0, 0, 0, 7, 5, 5, 7, 0],
        ],
        roots: [2, 5, 7, 0],
        chord: [0, 4, 7, 12],           // durový akord vihuely
        chordSeventh: [0, 4, 7, 10],    // dominantní septakord na V – motor ranchery
        cutoff: [1900, 3600, 6400],     // žestě potřebují prostor nahoře
        // Kapela bez bubeníka je tišší než témata s bicími – vyrovnané je to
        // hlasitostí, ne dalším nástrojem (měří `tools/mixtest.mjs`)
        gain: [0.56, 0.70, 0.88],
        leadGain: 0.60,
        delay: {steps: 3, feedback: 0.18, mix: 0.22},   // jen náznak ozvěny náměstí
    },

    /**
     * Matematický svět – minimalistický běh šestnáctin: metronom místo bicích,
     * čisté sinusové tóny a melodická buňka nesoudělné délky, která se proti
     * taktu postupně posouvá. Stupnice jsou souměrné (celotónová a zmenšená se
     * zobrazí samy na sebe po posunu) a harmonie krouží po velkých a malých
     * terciích a po kvintách – všechno jsou to pravidelné dělení oktávy.
     *
     * Pole mají pět prvků, protože matematických levelů je pět (11–15) a každý
     * z nich má sáhnout na jinou stupnici, harmonii i základní tón.
     * `chord` tenhle motiv nemá schválně: akord hraje `#ratioChord`
     * v přirozeném ladění, ne v půltónech.
     */
    math: {
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
    },

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
    jungle: {
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
    },
};

/**
 * Zvonová linka západoafrických bubnových kruhů převedená do šestnáctin –
 * seskupení 3–3–2, na kterém stojí celý džunglový rytmus. Hraje ji gankogui
 * (dvouzvučný zvonec) a opírá se o ni basa i balafonové ostinato; djembe
 * naopak hrají do mezer mezi ní, a z toho vzniká prokládaná polyrytmika.
 */
const BELL = [0, 3, 6, 8, 11, 14];

/**
 * Rytmy trubkových frází mariachi v jednom taktu (šestnáctiny). Jsou to osminy
 * s ozdobami, ne běh šestnáctin – mariachi zpívá, nehraje etudu.
 */
const MARIACHI_RHYTHMS = [
    [0, 2, 4, 6, 8, 10, 12],
    [0, 2, 4, 8, 10, 12],
    [0, 3, 4, 6, 8, 12],
    [4, 6, 8, 10, 12, 14],
    [0, 2, 4, 6, 8],
];

// Rozsah trubky ve stupních stupnice – oktáva a půl nad základním tónem
const MARIACHI_RANGE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Křivka měkkého oříznutí pro waveshaper – dá ohnivé base a úderům chraplák
const DIST_CURVE = (() => {
    const size = 1024;
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        curve[i] = Math.tanh((i / (size - 1) * 2 - 1) * 4);
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
 * Tón o tercii výš ve stupnici. Druhá trubka v mariachi hraje s první
 * v paralelních terciích – jinak by to nebyla mariachi. Velká tercie má
 * přednost, malá naskočí tam, kde velká do stupnice nepatří; krok o dva
 * stupně by tady nestačil, protože v pentatonice by z něj vyšla kvarta.
 */
function thirdAbove(scale, note) {
    return note + (scale.includes(((note + 4) % 12 + 12) % 12) ? 4 : 3);
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
 * nejvíc. Harmonii (`prog`) potřebuje jen mariachi, které na ni váže fráze.
 */
function buildMelody(style, scale, random, prog) {
    const melody = new Array(PATTERN_STEPS).fill(null);

    switch (style) {
        // Led: řídké zvonky na čtvrtkách, občas o oktávu výš
        case 'bells':
            for (let i = 0; i < PATTERN_STEPS; i += 4) {
                if (random() < 0.55) {
                    const degree = degreeAt(scale, Math.floor(random() * scale.length));
                    melody[i] = degree + (random() < 0.4 ? 12 : 0);
                }
            }
            break;

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

        /**
         * Poušť: trubkové fráze mariachi po dvou taktech – takt běhu osminek
         * a takt, který uzavře dlouhý tón a nechá kapele nadechnout.
         *
         * Těžké doby a závěr fráze padají na **tóny právě znějícího akordu**
         * (proto sem jde `prog`), mezi ně se vkládají kroky po stupnici.
         * Bez té vazby melodie jen bloudila po stupnici a s harmonií se míjela.
         */
        case 'mariachi':
            for (let bar = 0; bar < BARS; bar++) {
                const root = prog[bar % prog.length];
                // Stupně stupnice, na kterých leží tóny akordu. Hledají se přes
                // půltóny, ne krokem po stupnici: pentatonika některé stupně nemá
                const chord = [0, 4, 7].map(n => ((root + n) % 12 + 12) % 12);
                const tones = MARIACHI_RANGE.filter(i => chord.includes(degreeAt(scale, i) % 12));
                if (!tones.length) tones.push(0);   // pojistka pro stupnici bez tónů akordu
                const closing = bar % 2 === 1;
                const hits = closing
                    ? [0, 2, 4, 8]      // závěr fráze: krátký nájezd a dlouhý tón
                    : MARIACHI_RHYTHMS[Math.floor(random() * MARIACHI_RHYTHMS.length)];

                let idx = tones[Math.floor(random() * tones.length)];
                hits.forEach((hit, k) => {
                    if (hit % 8 === 0 || (closing && k === hits.length - 1)) {
                        // Nejbližší tón akordu – melodie tím sedne na harmonii
                        idx = tones.reduce((a, b) =>
                            Math.abs(b - idx) < Math.abs(a - idx) ? b : a);
                    }
                    melody[bar * STEPS_PER_BAR + hit] = degreeAt(scale, idx);
                    // krok po stupnici, občas skok o tercii; u krajů rozsahu se
                    // fráze otočí zpátky, ať se nezasekne na jednom tónu
                    const dir = idx <= 1 ? 1 : idx >= 8 ? -1 : (random() < 0.55 ? 1 : -1);
                    idx += (random() < 0.7 ? 1 : 2) * dir;
                    idx = Math.max(0, Math.min(9, idx));
                });
            }
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
        const base = THEMES.default;

        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(ctx.destination);

        // Dolní propust drží klidnou půlku smyčky přidušenou, v nástupu se otevře
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = base.cutoff[0];
        this.filter.Q.value = 1.2;
        this.filter.connect(this.master);

        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = base.gain[0];
        this.musicGain.connect(this.filter);

        this.leadGain = ctx.createGain();
        this.leadGain.gain.value = base.leadGain;
        this.leadGain.connect(this.filter);

        // Dozvuk melodie – z pár tónů udělá prostor
        this.delay = ctx.createDelay(1.5);
        this.delay.delayTime.value = 0.25;
        this.feedback = ctx.createGain();
        this.feedback.gain.value = base.delay.feedback;
        this.delayGain = ctx.createGain();
        this.delayGain.gain.value = base.delay.mix;

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
     * `theme` je vizuální téma levelu – vybírá se podle něj celý motiv.
     */
    setTrack(levelIndex, speedPct, theme = null) {
        const profile = THEMES[theme] ?? THEMES.default;
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
        const bit = {t, root, bar, inBar, step, tier, when};
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
     * Led: poloviční tempo, ležící sinusový spodek a zvonky s dlouhou ozvěnou.
     * Místo virblu praskne led, místo hi-hat se zatřpytí jinovatka.
     */
    #arrangeIce({t, root, bar, inBar, step, tier, when}) {
        // ---- bicí: měkký kopák na jedničku, prasknutí ledu na půlce taktu ----
        if (inBar % 8 === 0) this.#kick(when, {top: 130, bottom: 38, dur: 0.3, gain: 0.5});
        if (tier >= 1 && inBar === 8) this.#iceCrack(when);
        if (tier >= 1 && inBar % 4 === 2) this.#shimmer(when, tier >= 2 && inBar === 14);
        if (tier >= 2 && inBar === 11) this.#kick(when, {top: 120, bottom: 38, dur: 0.24, gain: 0.36});

        // ---- ležící spodek: jeden tón na půl taktu, ať zůstane prostor ----
        if (inBar % 8 === 0) this.#bassSub(root, t.stepDur * 7.5, when);

        // ---- zvonky ----
        const note = t.melody[step];
        if (note !== null && (tier >= 1 || inBar % 8 === 0)) {
            this.#bell(root * 4 * semitone(note), t.stepDur * (tier >= 1 ? 7 : 5),
                       tier >= 1 ? 0.11 : 0.09, when);
        }

        // ---- plocha: pomalu nabíhající akord, jediná plná harmonie ve skladbě ----
        if (tier >= 1 && bar % 2 === 0 && inBar === 0) {
            this.#swell(root, t.stepDur * 13, tier >= 2 ? 0.05 : 0.035, when);
        }

        // ---- třpyt v nejvyšším stupni: skleněné šestnáctiny vysoko nad melodií ----
        if (tier >= 2 && inBar % 2 === 1) {
            const arpNote = t.profile.arp[Math.floor(inBar / 2) % t.profile.arp.length];
            this.#tone({
                freq: root * 8 * semitone(arpNote), type: 'sine',
                dur: t.stepDur * 1.2, gain: 0.04, when, dest: this.musicGain,
            });
        }
    }

    /**
     * Oheň: dvojkopák, chraplavá basa na šestnáctiny a riff, který se opakuje.
     * Údery jsou kvintakordy bez tercie a v pozadí praskají uhlíky.
     */
    #arrangeFire({t, root, bar, inBar, step, tier, when}) {
        // ---- bicí: tvrdý kopák, ve vyšších stupních cval ----
        if (inBar % 4 === 0) this.#kick(when, {top: 200, bottom: 36, dur: 0.13, gain: 0.72});
        if (tier >= 1 && inBar % 8 === 3) this.#kick(when, {top: 190, bottom: 36, dur: 0.1, gain: 0.5});
        if (tier >= 2 && inBar % 8 === 7) this.#kick(when, {top: 190, bottom: 36, dur: 0.1, gain: 0.5});
        if (tier >= 1 && inBar % 8 === 4) this.#snare(when, true);
        if (tier >= 1) this.#hat(when, tier >= 2 && inBar === 14);

        // ---- basa: dusané šestnáctiny přes měkké oříznutí ----
        if (tier >= 1 || inBar % 2 === 0) {
            this.#bassGrowl(root, t.stepDur * 0.9, when);
        }

        // ---- riff: pila s krátkým klesnutím, jako kytara ----
        const note = t.melody[step];
        if (note !== null && (tier >= 1 || inBar % 4 === 0)) {
            this.#tone({
                freq: root * 4 * semitone(note), freqTo: root * 4 * semitone(note) * 0.985,
                type: 'sawtooth', dur: t.stepDur * 1.1,
                gain: tier >= 1 ? 0.12 : 0.07, when, dest: this.leadGain,
            });
        }

        // ---- údery: kvintakord bez tercie, odpověď o půltón výš (nejtemnější krok) ----
        if (tier >= 1 && bar % 2 === 0) {
            if (inBar === 0) this.#powerStab(root, t.stepDur * 3, 0.07, when);
            if (tier >= 2 && inBar === 10) {
                this.#powerStab(root * semitone(1), t.stepDur * 1.6, 0.05, when);
            }
        }

        // ---- uhlíky: nepravidelné prasknutí, které se s taktem nepotkává ----
        if (tier >= 1 && step % 13 === 5) this.#crackle(when);

        // ---- arpeggio až v nejvyšším stupni: klesající šestnáctiny ----
        if (tier >= 2 && inBar % 2 === 0) {
            const arpNote = t.profile.arp[Math.floor(inBar / 2) % t.profile.arp.length];
            this.#tone({
                freq: root * 8 * semitone(arpNote), type: 'sawtooth',
                dur: t.stepDur * 0.7, gain: 0.045, when, dest: this.musicGain,
            });
        }
    }

    /**
     * Poušť: mexické mariachi. Guitarrón dupe základ a kvintu, vihuela mu
     * odsekává durový akord na lehkou dobu („bum-ča, bum-ča“) a nad tím zpívají
     * **dvě trubky v paralelních terciích** – ty jsou slyšet od prvního nástupu,
     * protože právě podle nich se mariachi pozná. V nejvyšším stupni je zdvojí
     * housle o oktávu níž, jak to v kapele dělá houslová sekce.
     *
     * **Bicí tady schválně nejsou**: mariachi hraje bez bubeníka, puls drží
     * basa s kytarou. Dřív to táhly claves a palmas – jenže clave je kubánská
     * a palmas španělské, takže z pouště zněla obecná „latina“, ne Mexiko.
     * Drive místo nich dělá zapateado (dupnutí na tarimu) pod odsekávaným akordem.
     */
    #arrangeDesert({t, root, bar, inBar, step, tier, when}) {
        // Dominanta se hraje se septimou – to je motor ranchery; jinak čistě durově
        const degree = t.prog[bar % t.prog.length];
        const shape = degree === 7 ? t.profile.chordSeventh : t.profile.chord;

        // ---- guitarrón: základ na jedničku, kvinta na trojku ----
        if (inBar === 0) this.#guitarron(root, t.stepDur * 3.2, 0.24, when);
        if (inBar === 8) this.#guitarron(root * 1.5, t.stepDur * 3.2, 0.2, when);
        // Před změnou akordu se basa rozeběhne k jeho základu zezdola –
        // tenhle krátký nájezd dělá guitarrón pořád a drží kapelu pohromadě
        if (tier >= 1 && inBar === 14) {
            const next = t.prog[(bar + 1) % t.prog.length];
            this.#guitarron(t.root * semitone(next - 1), t.stepDur * 1.4, 0.15, when);
        }

        // ---- vihuela: sekaný akord na lehkou dobu, jediná plná harmonie ve skladbě ----
        if (inBar === 4 || inBar === 12) {
            this.#strum(root, shape, t.stepDur * 2.2, tier >= 1 ? 0.1 : 0.075, when, 0.018);
            if (tier >= 1) this.#stomp(when, true);
        }
        // Rasgueado: rychlé přiťuknutí mezi doby, ať mánico nešlape na místě
        if (tier >= 2 && (inBar === 6 || inBar === 14)) {
            this.#strum(root, shape, t.stepDur * 1.1, 0.05, when, 0.01);
            this.#stomp(when, false);
        }

        // ---- trubky: melodie se drží tóniny, harmonie se pod ní mění ----
        const note = t.melody[step];
        if (note !== null && (tier >= 1 || bar % 2 === 0)) {
            // Délku určí mezera do dalšího tónu: běh osminek odsekává, závěr
            // fráze zůstane ležet – bez toho zněly všechny tóny stejně dlouho
            const dur = t.stepDur * stepsToNext(t.melody, step, 8) * 0.92;
            this.#trumpet(t.root * 4 * semitone(note), dur, tier >= 1 ? 0.1 : 0.075, when);
            this.#trumpet(t.root * 4 * semitone(thirdAbove(t.profile.harmony, note)), dur,
                          tier >= 1 ? 0.07 : 0.05, when + 0.01);
            if (tier >= 2) this.#violin(t.root * 2 * semitone(note), dur, 0.06, when);
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
     * Guitarrón: hluboká drnknutá struna zdvojená oktávou – přesně tak se na
     * něj hraje a odtud má mariachi svůj dřevěný, měkký spodek.
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
     * Houslová sekce mariachi. V kapele hraje houslistů víc naráz, proto jsou
     * pily dvě a každá jinak rozladěná – z toho je ta šířka. Tón nabíhá
     * smykem (ne úderem), tělo nástroje dělá zdůrazněné pásmo kolem 800 Hz
     * a vibrato nastupuje až ve druhé půlce; bez toho zní housle jako pila.
     */
    #violin(freq, dur, gain, when) {
        const body = this.ctx.createBiquadFilter();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();

        body.type = 'peaking';
        body.frequency.value = 800;
        body.Q.value = 1.2;
        body.gain.value = 6;

        filter.type = 'lowpass';
        filter.Q.value = 0.8;
        filter.frequency.setValueAtTime(Math.min(freq * 3, 3000), when);
        filter.frequency.linearRampToValueAtTime(Math.min(freq * 6, 6000), when + dur * 0.5);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.06);
        env.gain.setValueAtTime(gain, when + dur * 0.75);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        lfo.type = 'sine';
        lfo.frequency.value = 5.6;
        lfoGain.gain.setValueAtTime(0, when);
        lfoGain.gain.setValueAtTime(0, when + dur * 0.4);
        lfoGain.gain.linearRampToValueAtTime(18, when + dur);    // vibrato v centech
        lfo.connect(lfoGain);
        lfo.start(when);
        lfo.stop(when + dur + 0.02);

        body.connect(filter).connect(env).connect(this.leadGain);
        for (const detune of [-6, 7]) {
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = freq;
            osc.detune.value = detune;
            lfoGain.connect(osc.detune);
            osc.connect(body);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        }
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

    /** Ohnivý úder: kvintakord bez tercie přes měkké oříznutí – hrubá síla. */
    #powerStab(root, dur, gain, when) {
        const shaper = this.ctx.createWaveShaper();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        shaper.curve = DIST_CURVE;
        filter.type = 'lowpass';
        filter.Q.value = 2;
        filter.frequency.setValueAtTime(4200, when);
        filter.frequency.exponentialRampToValueAtTime(700, when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        shaper.connect(filter).connect(env).connect(this.musicGain);

        this.track.profile.chord.forEach((note, i) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = root * 2 * semitone(note);
            osc.detune.value = [-10, 0, 10][i % 3];
            osc.connect(shaper);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        });
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
     * `shape` je akord (durový, na dominantě se septimou), `spread` rozestup
     * strun – čím kratší, tím ostřejší přiťuknutí.
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

    #hat(when, open) {
        this.#noise({dur: open ? 0.16 : 0.03, gain: open ? 0.09 : 0.06,
                     when, freq: 7000, dest: this.musicGain});
    }

    /** Prasknutí ledu místo virblu: suché lupnutí a ozvěna vysokého šumu. */
    #iceCrack(when) {
        this.#noise({dur: 0.05, gain: 0.24, when, freq: 5200, dest: this.musicGain});
        this.#noise({dur: 0.3, gain: 0.07, when: when + 0.02, type: 'bandpass',
                     freq: 3000, q: 6, dest: this.musicGain});
        this.#tone({freq: 1800, freqTo: 700, type: 'triangle', dur: 0.05,
                    gain: 0.1, when, dest: this.musicGain});
    }

    /** Jinovatka místo hi-hat: úzký pásek šumu hodně vysoko. */
    #shimmer(when, long) {
        this.#noise({dur: long ? 0.5 : 0.09, gain: long ? 0.06 : 0.05, when,
                     type: 'bandpass', freq: 9000, q: 8, dest: this.musicGain});
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
     * Zapateado: dupnutí na dřevěnou tarimu – dutá rána podlahy a klapnutí
     * podpatku. Mariachi bubeníka nemá, tohle je jediná perkuse pouště: patou
     * (`heel`) na doby akordu, špičkou mezi ně.
     */
    #stomp(when, heel) {
        this.#tone({freq: heel ? 150 : 190, freqTo: heel ? 70 : 110, type: 'sine',
                    dur: heel ? 0.09 : 0.05, gain: heel ? 0.3 : 0.14,
                    when, dest: this.musicGain});
        this.#noise({dur: heel ? 0.05 : 0.03, gain: heel ? 0.09 : 0.05, when,
                     type: 'bandpass', freq: 2200, q: 1.6, dest: this.musicGain});
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
