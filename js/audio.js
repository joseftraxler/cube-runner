/**
 * Zvuk hry. Efekty i hudba na pozadí se **skládají za běhu** přes Web Audio API
 * (oscilátory a šum) – nenačítá se žádný zvukový soubor. Hra tak zůstává bez
 * závislostí, funguje offline a v repozitáři nejsou binární data.
 *
 * Hudba je krokový sekvencer (16 kroků na takt, 4 takty dokola): basa, melodie
 * a bicí. Každý level má vlastní stupnici, harmonii i tempo odvozené od své
 * rychlosti; melodie se losuje ze seedu podle čísla levelu, takže je pokaždé
 * stejná.
 *
 * `Game` zvuku jen říká, co se stalo (`play('jump')`) a jestli má hrát hudba
 * (`setMusicOn`). Zvuk sám o hře nic neví.
 */

const STORAGE_KEY = 'cube-runner-muted';

const STEPS_PER_BAR = 16;
const BARS = 4;
const PATTERN_STEPS = STEPS_PER_BAR * BARS;

// O kolik snímků dopředu se plánují tóny (s) – kryje výkyvy časovače
const LOOKAHEAD = 0.15;

// Stupnice jako půltóny od základního tónu
const SCALES = [
    [0, 3, 5, 7, 10],          // mollová pentatonika
    [0, 2, 4, 7, 9],           // durová pentatonika
    [0, 2, 3, 5, 7, 8, 10],    // aiolská
];

// Harmonie – o kolik půltónů se posune základ v jednotlivých taktech
const PROGRESSIONS = [
    [0, 0, 5, 7],
    [0, 8, 5, 7],
    [0, 5, 3, 7],
    [0, 7, 8, 5],
];

// Základní tón levelu (půltóny od A2)
const ROOTS = [0, 3, 5, 7, 10];

// Kroky v taktu, na kterých hraje basa
const BASS_STEPS = [0, 3, 6, 8, 11, 14];

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

        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);

        // Hudba jde přes dolní propust, ať obdélníkové vlny tolik neřežou
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2600;
        filter.connect(this.master);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.5;
        this.musicGain.connect(filter);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.9;
        this.sfxGain.connect(this.master);

        this.noiseBuffer = makeNoise(this.ctx);

        this.nextStepTime = this.ctx.currentTime;
        this.timer = setInterval(() => this.#schedule(), 25);

        // V neaktivní záložce nemá cenu hrát
        document.addEventListener('visibilitychange', () => {
            if (!this.ctx) return;
            if (document.hidden) this.ctx.suspend();
            else if (this.musicOn || !this.muted) this.ctx.resume();
        });
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
            // Tón jen na osminách, ať melodie neuteče do drmolení
            const play = i % 2 === 0 && random() < 0.55;
            const degree = scale[Math.floor(random() * scale.length)];
            melody.push(play ? degree + (random() < 0.3 ? 12 : 0) : null);
        }

        this.track = {
            root: 110 * semitone(ROOTS[levelIndex % ROOTS.length]),
            prog: PROGRESSIONS[levelIndex % PROGRESSIONS.length],
            stepDur: 60 / (118 * speedPct / 100) / 4,   // rychlejší level = svižnější hudba
            melody,
        };

        this.step = 0;
        if (this.ctx) this.nextStepTime = this.ctx.currentTime;
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
        const inBar = step % STEPS_PER_BAR;
        const chord = t.prog[Math.floor(step / STEPS_PER_BAR) % t.prog.length];
        const root = t.root * semitone(chord);

        // bicí
        if (inBar % 4 === 0) this.#kick(when);
        if (inBar % 8 === 4) this.#snare(when);
        if (inBar % 2 === 1) this.#hat(when);

        // basa
        if (BASS_STEPS.includes(inBar)) {
            this.#tone({freq: root / 2, type: 'square', dur: t.stepDur * 0.9,
                        gain: 0.20, when, dest: this.musicGain});
        }

        // melodie
        const note = t.melody[step];
        if (note !== null) {
            this.#tone({freq: root * 2 * semitone(note), type: 'square',
                        dur: t.stepDur * 1.7, gain: 0.09, when, dest: this.musicGain});
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
                this.#noise({dur: 0.4, gain: 0.35, when: t, type: 'lowpass', freq: 1400});
                break;
            case 'complete':
                [0, 4, 7, 12].forEach((n, i) => this.#tone({
                    freq: 523 * semitone(n), type: 'triangle', dur: 0.22,
                    gain: 0.28, when: t + i * 0.1,
                }));
                break;
            case 'win':
                [0, 4, 7, 12, 16, 19].forEach((n, i) => this.#tone({
                    freq: 523 * semitone(n), type: 'triangle', dur: 0.3,
                    gain: 0.28, when: t + i * 0.12,
                }));
                this.#tone({freq: 523 * semitone(24), type: 'triangle', dur: 1.1,
                            gain: 0.3, when: t + 0.78});
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
        this.#tone({freq: 150, freqTo: 45, type: 'sine', dur: 0.13,
                    gain: 0.5, when, dest: this.musicGain});
    }

    #snare(when) {
        this.#noise({dur: 0.13, gain: 0.20, when, freq: 1300, dest: this.musicGain});
    }

    #hat(when) {
        this.#noise({dur: 0.03, gain: 0.07, when, freq: 7000, dest: this.musicGain});
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
