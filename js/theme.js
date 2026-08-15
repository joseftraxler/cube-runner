import {Game} from "./game.js";
import {SCALE} from "./audio.js";

export class Theme {
    /**
     * @param {Game} game
     */
    constructor(game)
    {
        this.game = game;
    }

    /**
     * @return {string}
     */
    name()
    {
        throw new Error('Theme name was not specified.');
    }

    /**
     * @returns {number}
     */
    hue()
    {
        return (205 + this.game.levelIndex * 31) % 360;
    }

    /**
     * Zda je v tematu horko
     *
     * @returns {boolean}
     */
    hazy()
    {
        return false;
    }

    drawWorld()
    {
        this.drawBackground();
        this.drawLevel();

        this.saws.forEach(s => s.draw(this.ctx, this.px(s.x), this.py(s.y), this.tile));
        this.orbiters.forEach(o => o.draw(this.ctx, this.px(o.x), this.py(o.y), this.tile));

        if (this.state !== 'dying') {
            this.player.draw(this.ctx, this.px(this.player.x), this.py(this.player.y), this.tile);
        }

        this.drawParticles();
        this.drawGroundLine();
    }

    drawSpikeUp()
    {
        // @todo render hrotu na zemi
    }

    drawSpikeDown()
    {
        // @todo render hrotu ze stropu
    }

    // @todo doplnit dasli vykresleni objektu

    audio()
    {
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
        }
    }
};
