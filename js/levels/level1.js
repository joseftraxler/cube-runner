import {Level} from "../level.js";

// Soubor generuje tools/gen_levels.py (otisk mapy 4fa7ac26).
// Ruční úpravu generátor podle otisku pozná a soubor nepřepíše;
// vynutit přegenerování jde přepínačem --force.
// První argument = rychlost běhu v % základní rychlosti (100 = BASE_SPEED).
const level1 = new Level(
    100,
    "                                                                                                                                        ",
    "                                                                                                                                        ",
    "                                                                                                                                        ",
    "                                                                                                                                        ",
    "                                                                                                                                        ",
    "                                                                                                                                        ",
    "                                                                                                                                        ",
    "                                                                                                                                        ",
    "                                                                   *                                                            *       ",
    "                                                       *                                                                                ",
    "                                                                                                                                        ",
    " P                        ^                   ^                   ^^                    ####                  ^                         ",
    "#################################################################################################################################F######",
    "#################################################################################################################################F######",
);

export {level1};
