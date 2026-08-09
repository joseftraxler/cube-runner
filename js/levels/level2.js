import {Level} from "../level.js";

// Soubor generuje tools/gen_levels.py (otisk mapy 07a48b89).
// Ruční úpravu generátor podle otisku pozná a soubor nepřepíše;
// vynutit přegenerování jde přepínačem --force.
// První argument = rychlost běhu v % základní rychlosti (100 = BASE_SPEED).
const level2 = new Level(
    104,
    "                                                                                                                                                  ",
    "                                                                                                                                                  ",
    "                                                                                                                                                  ",
    "                                                                                                                                                  ",
    "                                                                                                                                                  ",
    "                                                                                                                                                  ",
    "                                                                                                                                                  ",
    "                 ^^                                                                                                                               ",
    "                 ##        *                     *                                                                                        *       ",
    "                 vv                                                           *                                                                   ",
    "                                                                                                                                                  ",
    " P       ^^          ^^                         ^^^^^J^^^^                                                                                        ",
    "###########################################################################################################################################F######",
    "###########################################################################################################################################F######",
);

export {level2};
