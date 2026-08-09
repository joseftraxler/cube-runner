import {Level} from "../level.js";

// Soubor generuje tools/gen_levels.py (otisk mapy 4ea51c9a).
// Ruční úpravu generátor podle otisku pozná a soubor nepřepíše;
// vynutit přegenerování jde přepínačem --force.
// První argument = rychlost běhu v % základní rychlosti (100 = BASE_SPEED).
const level8 = new Level(
    128,
    "                                                                                                                                                                        ",
    "                                                                                                                                                                        ",
    "                                                                                                                                                                        ",
    "                                                                                                                                                                        ",
    "                                                                                                                                                                        ",
    "                                                                                                                                                                        ",
    "                                                                              ##############                                                                            ",
    "                                                                              ##############                                                                            ",
    "                           *                                                  ##############                      *                         *                   *       ",
    "                                                    oo                           vv                                                                    *                ",
    "                                                                                                                 #####                                                  ",
    " P                        ^^                                                          ^                      #########                     ^^^                          ",
    "##################################################       ########################################################################################################F######",
    "##################################################       ########################################################################################################F######",
);

export {level8};
