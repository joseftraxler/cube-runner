/**
 * Základní entita ve světě. Souřadnice `x`, `y` jsou **střed** entity
 * v jednotkách políček (střed políčka [3,5] je tedy 3.5, 5.5).
 *
 * Entita se stará jen sama o sebe: hýbe se a umí se vykreslit. Do světa
 * (`this.game.level`) jen nahlíží kvůli vlastnímu pohybu – nemění skóre ani
 * stav hry. O tom, co se stane (smrt, sebrání mince, konec levelu), rozhoduje
 * `Game`.
 */
export class Entity {
    constructor(game, x, y) {
        this.game = game;
        this.spawnX = x;
        this.spawnY = y;
        this.reset();
    }

    reset() {
        this.x = this.spawnX;
        this.y = this.spawnY;
        this.animPhase = 0; // naakumulovaný čas, slouží k animaci
    }

    step(dt) {
        this.animPhase += dt;
    }

    /**
     * Abstraktní metoda: vykreslení entity na canvas.
     * Hra (Game) předá kontext a pixelovou pozici středu i velikost políčka,
     * takže entita nemá žádnou vazbu na hru samotnou.
     *
     * @param {CanvasRenderingContext2D} ctx  kontext, do kterého se kreslí
     * @param {number} cx    x-ová souřadnice středu entity v pixelech
     * @param {number} cy    y-ová souřadnice středu entity v pixelech
     * @param {number} size  velikost políčka v pixelech
     */
    draw(ctx, cx, cy, size) {
        throw new Error('draw() musí být implementováno v podtřídě');
    }
}
