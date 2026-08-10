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
 * pomalé zvonky nad ležícím podkladem, oheň dusá chraplavým riffem a poušť
 * rozeznívá ruční bubny s ozdobnými běhy nad drónem. Dramatický ráz zůstává
 * všude – mění se barva, ne nálada.
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

// Stupnice jako půltóny od základního tónu. Až na pouštní mody všechny mollové –
// a i ty pouštní mají zvětšené sekundy, takže drama zůstává.
const SCALE = {
    pentatonic: [0, 3, 5, 7, 10],           // mollová pentatonika
    aeolian: [0, 2, 3, 5, 7, 8, 10],        // přirozená moll
    harmonic: [0, 2, 3, 5, 7, 8, 11],       // harmonická moll – zvětšená sekunda
    phrygian: [0, 1, 3, 5, 7, 8, 10],       // frygická – nejtemnější
    kumoi: [0, 2, 3, 7, 9],                 // japonská, vzdušná a prázdná
    inSen: [0, 1, 5, 7, 10],                // japonská „in“ – mrazivá
    locrian: [0, 1, 3, 5, 6, 8, 10],        // lokrická – tritonus hned v základu
    blues: [0, 3, 5, 6, 7, 10],             // mollové blues se sníženou kvintou
    hijaz: [0, 1, 4, 5, 7, 8, 10],          // frygická dur – klasický pouštní zvuk
    doubleHarmonic: [0, 1, 4, 5, 7, 8, 11], // dvojitá harmonická – dvě zvětšené sekundy
    hungarian: [0, 2, 3, 6, 7, 8, 11],      // cikánská moll
    nikriz: [0, 2, 3, 6, 7, 9, 10],         // maqám nikriz
};

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

    // Poušť – drón, ruční bubny a ozdobné běhy exotických stupnic
    desert: {
        arrange: 'desert',
        melody: 'runs',
        bpm: 116,
        scales: [SCALE.doubleHarmonic, SCALE.hijaz, SCALE.hungarian, SCALE.nikriz],
        progressions: [
            [0, 0, 0, 0, 5, 0, 0, 0],
            [0, 0, 0, 5, 0, 0, 7, 5],
            [0, 0, 5, 5, 0, 0, 0, 3],
            [0, 0, 0, 0, 0, 5, 3, 0],
        ],
        roots: [5, 7, 9, 2],
        chord: [0, 7, 12, 17],      // kvarty a kvinty – bez tercie sedí na každý mod
        arp: [0, 1, 2, 3],          // stupně stupnice, ne pevné intervaly
        cutoff: [1600, 3200, 5600],
        gain: [0.44, 0.56, 0.70],
        leadGain: 0.50,
        delay: {steps: 3, feedback: 0.30, mix: 0.38},
    },
};

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
 * Melodie na celou smyčku (pole půltónů nad základem, `null` = pomlka).
 * Styl řídí rytmus i tvar fráze – tím se motivy témat liší nejvíc.
 */
function buildMelody(style, scale, random) {
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

        // Poušť: ozdobné běhy po stupnici a mezi nimi nádech
        case 'runs': {
            let i = 0;
            while (i < PATTERN_STEPS) {
                let idx = Math.floor(random() * scale.length);
                const dir = random() < 0.5 ? 1 : -1;
                const length = 3 + Math.floor(random() * 4);
                for (let k = 0; k < length && i < PATTERN_STEPS; k++, i++) {
                    melody[i] = degreeAt(scale, idx) + 12;
                    idx += random() < 0.75 ? dir : -dir;
                }
                i += 2 + Math.floor(random() * 5);
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
        const random = rng(levelIndex * 2654435761 + 12345);

        this.track = {
            root: 55 * semitone(profile.roots[levelIndex % profile.roots.length]),
            prog: profile.progressions[levelIndex % profile.progressions.length],
            // Rychlejší level = svižnější hudba (tempo roste s obtížností)
            stepDur: 60 / (profile.bpm * speedPct / 100) / 4,
            melody: buildMelody(profile.melody, scale, random),
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
     * Poušť: ruční bubny (dum–tek), ležící drón s kvintou, drnkaný podklad
     * a nad tím píšťala s vibratem, která ozdobné běhy váže portamentem.
     */
    #arrangeDesert({t, root, bar, inBar, step, tier, when}) {
        // ---- ruční bubny ----
        if (inBar === 0 || inBar === 10) this.#dum(when);
        if (tier >= 1 && (inBar === 4 || inBar === 6 || inBar === 12 || inBar === 14)) this.#tek(when);
        if (tier >= 1 && inBar % 2 === 1) this.#shaker(when, inBar % 8 === 7);
        if (tier >= 2 && inBar === 15) this.#tek(when);

        // ---- drón: ležící kvinta přes celý takt ----
        if (tier >= 1 && inBar === 0) this.#drone(root, t.stepDur * STEPS_PER_BAR, when);

        // ---- drnkaný podklad místo basy ----
        if (inBar === 0 || inBar === 6 || inBar === 8) {
            this.#pluck(root * 2, t.stepDur * 2.2, 0.16, when, this.musicGain);
        }
        if (tier >= 1 && inBar === 11) {
            this.#pluck(root * 3, t.stepDur * 1.6, 0.11, when, this.musicGain);
        }

        // ---- píšťala: běhy se vážou portamentem z předchozího tónu ----
        const note = t.melody[step];
        if (note !== null && (tier >= 1 || bar % 2 === 0)) {
            const prev = t.melody[(step - 1 + PATTERN_STEPS) % PATTERN_STEPS];
            const freq = root * 4 * semitone(note);
            this.#reed(freq, prev === null ? null : root * 4 * semitone(prev),
                       t.stepDur * 1.6, tier >= 1 ? 0.1 : 0.06, when);
        }

        // ---- brnknutý akord: kvarty a kvinty rozložené jako drnknutí přes struny ----
        if (tier >= 1 && bar % 2 === 0 && inBar === 0) {
            this.#strum(root, t.stepDur * 4, tier >= 2 ? 0.11 : 0.08, when);
        }

        // ---- v nejvyšším stupni běh po stupnici jako na kánúnu ----
        if (tier >= 2) {
            const degree = degreeAt(t.scale, t.profile.arp[inBar % t.profile.arp.length]
                                             + Math.floor(inBar / 4));
            this.#pluck(root * 8 * semitone(degree), t.stepDur * 0.9, 0.05, when, this.musicGain);
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

    /** Pouštní drón: ležící kvinta, které se pod rukou pomalu otevírá filtr. */
    #drone(freq, dur, when) {
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        filter.type = 'lowpass';
        filter.Q.value = 4;
        filter.frequency.setValueAtTime(500, when);
        filter.frequency.exponentialRampToValueAtTime(1500, when + dur * 0.5);
        filter.frequency.exponentialRampToValueAtTime(500, when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(0.1, when + dur * 0.25);
        env.gain.setValueAtTime(0.1, when + dur * 0.7);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        filter.connect(env).connect(this.musicGain);

        for (const [ratio, detune] of [[1, -6], [1.5, 6]]) {
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = freq * ratio;
            osc.detune.value = detune;
            osc.connect(filter);
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
     * Pouštní píšťala: nosový tón s vibratem, které se rozjede až po nasazení.
     * `from` (kmitočet předchozího tónu) sváže běh portamentem.
     */
    #reed(freq, from, dur, gain, when) {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();

        osc.type = 'sawtooth';
        if (from) {
            osc.frequency.setValueAtTime(from, when);
            osc.frequency.exponentialRampToValueAtTime(freq, when + Math.min(0.05, dur * 0.3));
        } else {
            osc.frequency.setValueAtTime(freq, when);
        }

        lfo.type = 'sine';
        lfo.frequency.value = 5.5;
        lfoGain.gain.setValueAtTime(0, when);
        lfoGain.gain.linearRampToValueAtTime(28, when + dur * 0.6);   // vibrato v centech
        lfo.connect(lfoGain).connect(osc.detune);

        filter.type = 'bandpass';
        filter.Q.value = 2.2;
        filter.frequency.value = freq * 2.2;

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(gain, when + 0.03);
        env.gain.setValueAtTime(gain, when + dur * 0.6);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        osc.connect(filter).connect(env).connect(this.leadGain);
        for (const node of [osc, lfo]) {
            node.start(when);
            node.stop(when + dur + 0.02);
        }
    }

    /** Drnknutá struna: pila přes rychle se zavírající filtr. */
    #pluck(freq, dur, gain, when, dest = this.musicGain) {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.value = freq;

        filter.type = 'lowpass';
        filter.Q.value = 2;
        filter.frequency.setValueAtTime(Math.min(freq * 8, 6000), when);
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

    /** Pouštní drnknutí: tóny akordu za sebou, jako když palec přejede struny. */
    #strum(root, dur, gain, when) {
        this.track.profile.chord.forEach((note, i) => {
            this.#pluck(root * 2 * semitone(note), dur, gain, when + i * 0.035, this.musicGain);
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

    /** Darbuka „dum“: dutá rána doprostřed blány. */
    #dum(when) {
        this.#tone({freq: 190, freqTo: 62, type: 'sine', dur: 0.22,
                    gain: 0.6, when, dest: this.musicGain});
        this.#noise({dur: 0.05, gain: 0.08, when, type: 'lowpass',
                     freq: 900, dest: this.musicGain});
    }

    /** Darbuka „tek“: ostré ťuknutí na okraj. */
    #tek(when) {
        this.#noise({dur: 0.05, gain: 0.16, when, type: 'bandpass',
                     freq: 2600, q: 3, dest: this.musicGain});
        this.#tone({freq: 520, freqTo: 300, type: 'triangle', dur: 0.04,
                    gain: 0.1, when, dest: this.musicGain});
    }

    /** Řehtačka: sotva slyšitelný sypký šum, který drží šestnáctiny. */
    #shaker(when, accent) {
        this.#noise({dur: accent ? 0.06 : 0.03, gain: accent ? 0.07 : 0.045,
                     when, freq: 8200, dest: this.musicGain});
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
