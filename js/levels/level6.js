import {Level} from "../level.js";

// Soubor generuje tools/gen_levels.py (otisk mapy 92592ac8).
// Ruční úpravu generátor podle otisku pozná a soubor nepřepíše;
// vynutit přegenerování jde přepínačem --force.
// První argument = rychlost běhu v % základní rychlosti (100 = BASE_SPEED).
const level6 = new Level(
    120,
    "                                                                                                                                                                    ",
    "                                                                                                                                                                    ",
    "                                                                                                                                                                    ",
    "                                                                                                                                                                    ",
    "                                                                                                                                                                    ",
    "                                                                                                                                                                    ",
    "                                                                          ############                                                                              ",
    "                                                                          ############                                                                              ",
    "                          S     S                     *                   ############                                                                      *       ",
    "                                                                                                                                                   *                ",
    "                                                                                                          #####                                                     ",
    " P                                                   ^^^                       ^                          #####                  ^       ^                          ",
    "#############################################################################################################################################################F######",
    "#############################################################################################################################################################F######",
);

export {level6};
