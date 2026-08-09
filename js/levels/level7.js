import {Level} from "../level.js";

// Soubor generuje tools/gen_levels.py (otisk mapy 62fe2b1d).
// Ruční úpravu generátor podle otisku pozná a soubor nepřepíše;
// vynutit přegenerování jde přepínačem --force.
// První argument = rychlost běhu v % základní rychlosti (100 = BASE_SPEED).
const level7 = new Level(
    124,
    "                                                                                                                                                              ",
    "                                                                                                                                                              ",
    "                                                                                                                                                              ",
    "                                                                                                                                                              ",
    "                                                                                                                                                              ",
    "                                                                                                                                                              ",
    "                                                                                                                                                              ",
    "                                                                                                                                                              ",
    "                           *                             *                       *                                                 *                  *       ",
    "                             ######                                                                                                          *                ",
    "                             ######                                           ######                                                                          ",
    " P                      J    ######                     ^^                    ^^^^^^                     S                                                    ",
    "#################################################################################################################################    ##################F######",
    "#################################################################################################################################    ##################F######",
);

export {level7};
