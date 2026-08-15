import {Default} from "./default.js";
import {Ice} from "./ice.js";
import {Fire} from "./fire.js";
import {Desert} from "./desert.js";
import {MathTheme} from "./math.js";
import {Jungle} from "./jungle.js";

/**
 * Jméno tématu v mapě levelu (`{speed, theme}`) → třída prostředí. Je to
 * **jediné místo v celé hře, kde se téma pozná podle jména**; všude jinde se
 * hra ptá instance. Nové prostředí se přidává sem (a do `ASSETS` v `sw.js`).
 */
const THEMES = {
    ice: Ice,
    fire: Fire,
    desert: Desert,
    math: MathTheme,
    jungle: Jungle,
};

/**
 * Prostředí pro daný level. Bez tématu (a u neznámého jména) hra vypadá
 * a zní tak, jak vypadala od začátku.
 *
 * @param {string|null} name
 * @param {import("../game.js").Game} game
 * @returns {import("../theme.js").Theme}
 */
export function themeFor(name, game) {
    return new (THEMES[name] ?? Default)(game);
}
