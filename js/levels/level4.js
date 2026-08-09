import {Level} from "../level.js";

// Soubor generuje tools/gen_levels.py (otisk mapy be2e7401).
// Ruční úpravu generátor podle otisku pozná a soubor nepřepíše;
// vynutit přegenerování jde přepínačem --force.
// První argument = rychlost běhu v % základní rychlosti (100 = BASE_SPEED).
const level4 = new Level(
    112,
    "                                                                                                                                                        ",
    "                                                                                                                                                        ",
    "                                                                                                                                                        ",
    "                                                                                                                                                        ",
    "                                                                                                                                                        ",
    "                                                                                                                                                        ",
    "                                                                                                                                                        ",
    "                                                                                                                                                        ",
    "                                                   *                                                 *                      *                   *       ",
    "                                                                                                                                       *                ",
    "                                                                          #####                                                                         ",
    " P                         S                      ^^                      #####                                            ^^^                          ",
    "###################################################################################################    ##########################################F######",
    "###################################################################################################    ##########################################F######",
);

export {level4};
