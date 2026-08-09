/**
 * Zvuk hry. Efekty i hudba na pozadí se **skládají za běhu** přes Web Audio API
 * (oscilátory a šum) – nenačítá se žádný zvukový soubor. Hra tak zůstává bez
 * závislostí, funguje offline a v repozitáři nejsou binární data.
 *
 * Hudba je krokový sekvencer: 16 kroků na takt, harmonie se točí po osmi taktech.
 * Neroste ale s časem, nýbrž **s postupem v levelu** (`setIntensity`) – čím dál
 * kostka doběhne, tím je skladba plnější: nejdřív jen basa s kopákem, pak
 * naskočí virbl, melodie s dozvukem a občasný klouzavý synťák, nakonec arpeggio,
 * otevřené hi-hat a naplno otevřený filtr. Přechod mezi stupni podtrhne činel s nájezdem.
 * Po smrti se intenzita vrátí na začátek, takže hudba přímo odráží, jak se daří.
 *
 * (Kdyby gradace běžela na čas, nebyla by v praxi slyšet – po většinu pokusů
 * kostka umře dřív, než by skladba stihla nastoupit.)
 *
 * Každý level má vlastní mollovou stupnici, harmonii a tempo odvozené od své
 * rychlosti; melodie se losuje ze seedu podle čísla levelu, takže je pokaždé
 * stejná.
 *
 * `Game` zvuku jen říká, co se stalo (`play('jump')`) a jestli má hrát hudba
 * (`setMusicOn`). Zvuk sám o hře nic neví.
 */

const STORAGE_KEY = 'cube-runner-muted';

const STEPS_PER_BAR = 16;
const BARS = 8;
const PATTERN_STEPS = STEPS_PER_BAR * BARS;

// Hranice postupu levelem, na kterých se přidá další vrstva nástrojů
const TIERS = [0.28, 0.58];

// Otevření filtru pro jednotlivé stupně intenzity (Hz)
const TIER_CUTOFF = [1300, 2800, 4800];

// Hlasitost podkladu pro jednotlivé stupně – skladba i sílí, nejen se rozjasňuje
const TIER_GAIN = [0.45, 0.58, 0.72];

// O kolik dopředu se plánují tóny (s) – kryje výkyvy časovače
const LOOKAHEAD = 0.15;

// Stupnice jako půltóny od základního tónu. Všechny mollové – kvůli atmosféře.
const SCALES = [
    [0, 3, 5, 7, 10],          // mollová pentatonika
    [0, 2, 3, 5, 7, 8, 10],    // aiolská (přirozená moll)
    [0, 2, 3, 5, 7, 8, 11],    // harmonická moll – dramatická zvětšená sekunda
    [0, 1, 3, 5, 7, 8, 10],    // frygická – nejtemnější
];

// Harmonie: o kolik půltónů se posune základ v jednotlivých osmi taktech
const PROGRESSIONS = [
    [0, 0, 8, 7, 0, 0, 5, 7],
    [0, 10, 8, 7, 0, 10, 5, 3],
    [0, 0, 3, 5, 0, 0, 8, 7],
    [0, 5, 3, 10, 0, 5, 8, 7],
];

// Kroky v taktu, na kterých smí začít klouzavý synťák
const SLIDE_STEPS = [0, 6, 10];

// Základní tón levelu (půltóny od A1 = 55 Hz)
const ROOTS = [0, 3, 5, 7, 10];

const semitone = (n) => 2 ** (n / 12);

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

export class Sound {
    constructor() {
        this.ctx = null;
        this.muted = readMuted();
        this.track = null;      // {stepDur, root, prog, melody}
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
        this.filter.frequency.value = 1400;
        this.filter.Q.value = 1.2;
        this.filter.connect(this.master);

        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = TIER_GAIN[0];
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

    /** Nastaví skladbu levelu a vrátí sekvencer na začátek (po každé smrti). */
    setTrack(levelIndex, speedPct) {
        const scale = SCALES[levelIndex % SCALES.length];
        const random = rng(levelIndex * 2654435761 + 12345);
        const melody = [];

        for (let i = 0; i < PATTERN_STEPS; i++) {
            const degree = scale[Math.floor(random() * scale.length)];
            melody.push(i % 2 === 0 && random() < 0.5
                ? degree + (random() < 0.35 ? 12 : 0)
                : null);
        }

        // Rychlejší level = svižnější hudba (tempo roste s obtížností)
        const stepDur = 60 / (122 * speedPct / 100) / 4;

        // Klouzavý synťák: pro každý takt se předem rozhodne, jestli a odkud
        // kam přejede. Hraje jen občas, aby zůstal ozvláštněním, ne podkladem.
        const slides = [];
        for (let bar = 0; bar < BARS; bar++) {
            if (random() < 0.62) {
                slides.push(null);      // většinu taktů mlčí, ať zůstane ozvláštněním
                continue;
            }
            const from = scale[Math.floor(random() * scale.length)];
            // Cíl je blízký tón ze stupnice – přejezd v úzkém rozpětí
            const step = scale[Math.floor(random() * scale.length)];
            const near = Math.abs(step - from) <= 5 && step !== from;
            const to = near ? step : from + (random() < 0.5 ? 3 : -2);
            slides.push({
                from, to,
                start: SLIDE_STEPS[Math.floor(random() * SLIDE_STEPS.length)],
                bars: random() < 0.35 ? 2 : 1,
            });
        }

        this.track = {
            root: 55 * semitone(ROOTS[levelIndex % ROOTS.length]),
            prog: PROGRESSIONS[levelIndex % PROGRESSIONS.length],
            stepDur,
            melody,
            slides,
        };

        // Dozvuk na tečkovanou osminku, ať se drží tempa
        if (this.delay) this.delay.delayTime.value = stepDur * 3;

        this.step = 0;
        this.intensity = 0;
        this.tier = 0;
        if (this.ctx) {
            this.nextStepTime = this.ctx.currentTime;
            this.filter.frequency.setTargetAtTime(TIER_CUTOFF[0], this.ctx.currentTime, 0.2);
            this.musicGain.gain.setTargetAtTime(TIER_GAIN[0], this.ctx.currentTime, 0.2);
        }
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
            this.filter.frequency.setTargetAtTime(TIER_CUTOFF[tier], when, up ? 0.5 : 0.3);
            this.musicGain.gain.setTargetAtTime(TIER_GAIN[tier], when, 0.4);
        }
        this.tier = tier;

        // ---- bicí ----
        if (inBar % 4 === 0) this.#kick(when);
        if (tier >= 1 && inBar % 8 === 4) this.#snare(when, tier >= 2);
        if (tier >= 1 && inBar % 2 === 1) this.#hat(when, tier >= 2 && inBar % 8 === 7);

        // ---- basa: pravidelné osminky, ve vyšších stupních skoky o oktávu ----
        if (inBar % 2 === 0) {
            const octave = tier >= 1 && (inBar === 6 || inBar === 14) ? 2 : 1;
            this.#bass(root * octave, t.stepDur * 0.85, when);
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

        // ---- klouzavý synťák: občasný přejezd mezi dvěma blízkými tóny ----
        const slide = t.slides[bar];
        if (slide && tier >= 1 && inBar === slide.start) {
            this.#slide(
                root * 2 * semitone(slide.from),
                root * 2 * semitone(slide.to),
                t.stepDur * STEPS_PER_BAR * slide.bars * 0.75,
                when,
            );
        }

        // ---- arpeggio až v nejvyšším stupni: šestnáctiny přes mollový akord ----
        if (tier >= 2) {
            const triad = [0, 3, 7, 12][inBar % 4];
            this.#tone({
                freq: root * 8 * semitone(triad), type: 'triangle',
                dur: t.stepDur * 0.8, gain: 0.055, when, dest: this.musicGain,
            });
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

    /** Basa ze dvou rozladěných pil – hustší a naléhavější než jeden oscilátor. */
    #bass(freq, dur, when) {
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
     * Synťák, který plynule přejede z jednoho tónu na druhý. Jde přes rezonanční
     * dolní propust, která se sama otevře a zase zavře – proto to „zakvílí“
     * a nezůstane to jen u změny výšky.
     */
    #slide(from, to, dur, when) {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(from, when);
        // Přejezd začne až po chvilce, ať je slyšet výchozí tón
        osc.frequency.setValueAtTime(from, when + dur * 0.25);
        osc.frequency.exponentialRampToValueAtTime(to, when + dur * 0.8);

        filter.type = 'lowpass';
        filter.Q.value = 9;
        filter.frequency.setValueAtTime(from * 2, when);
        filter.frequency.exponentialRampToValueAtTime(Math.max(to, from) * 6, when + dur * 0.6);
        filter.frequency.exponentialRampToValueAtTime(from * 1.5, when + dur);

        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(0.075, when + dur * 0.3);
        env.gain.setValueAtTime(0.075, when + dur * 0.7);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        osc.connect(filter).connect(env).connect(this.leadGain);
        osc.start(when);
        osc.stop(when + dur + 0.05);
    }

    /** Šumový úder (bicí, výbuch) přes filtr. */
    #noise({dur, gain, when, type = 'highpass', freq = 1000, dest = this.sfxGain}) {
        const src = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        src.buffer = this.noiseBuffer;
        filter.type = type;
        filter.frequency.value = freq;

        env.gain.setValueAtTime(gain, when);
        env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

        src.connect(filter).connect(env).connect(dest);
        src.start(when);
        src.stop(when + dur + 0.02);
    }

    #kick(when) {
        this.#tone({freq: 170, freqTo: 42, type: 'sine', dur: 0.16,
                    gain: 0.62, when, dest: this.musicGain});
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
