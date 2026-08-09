import {Level} from "../level.js";

// Soubor generuje tools/gen_levels.py (otisk mapy 49575789).
// Ruční úpravu generátor podle otisku pozná a soubor nepřepíše;
// vynutit přegenerování jde přepínačem --force.
// První argument = rychlost běhu v % základní rychlosti (100 = BASE_SPEED).
const level5 = new Level(
    116,
    "                                                                                                                                                            ",
    "                                                                                                                                                            ",
    "                                                                                                                                                            ",
    "                                                                                                                                                            ",
    "                                                                                                                                                            ",
    "                                                                                                                                                            ",
    "                                                                                                                                                            ",
    "                                                                                                                                                            ",
    "                           *                       *                                                  *                          *                  *       ",
    "                                                                                                                                           *                ",
    "                                                ######                                               #####                                                  ",
    " P                        ^^                    ^^^^^^                     S                     #########                                                  ",
    "###############################################################################################################################    ##################F######",
    "###############################################################################################################################    ##################F######",
);

export {level5};
