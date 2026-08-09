/**
 * Fyzikální konstanty hry. Jednotky: políčka (tile) a sekundy.
 *
 * Z těchto čísel plyne tvar skoku, na kterém stojí návrh všech úrovní:
 *   výška skoku  = JUMP_SPEED² / (2·GRAVITY)          ≈ 2,5 políčka
 *   doba ve vzduchu = 2·JUMP_SPEED / GRAVITY          ≈ 0,65 s
 *   délka skoku  = BASE_SPEED · doba ve vzduchu       ≈ 5,2 políčka
 *
 * Kostka tedy vyskočí na blok vysoký 2 políčka a přeskočí díru širokou 4 políčka.
 * Když čísla změníš, přegeneruj úrovně (`python3 tools/gen_levels.py`) – generátor
 * má vlastní kopii těchto konstant a ověřuje jimi průchodnost map.
 */

export const BASE_SPEED = 8;      // vodorovná rychlost při 100 % (políček/s)
export const GRAVITY = 48;        // gravitační zrychlení (políček/s²)
export const JUMP_SPEED = 15.5;   // počáteční svislá rychlost skoku (políček/s)
export const PAD_BOOST = 1.4;     // násobek skoku pro odrazovou plošinu `J`
export const MAX_FALL = 40;       // maximální rychlost pádu (políček/s)

export const CUBE = 0.94;         // strana kostky pro kolize s bloky
export const HIT = 0.58;          // menší hitbox pro smrtící překážky (hroty, pily)

export const ROT_SPEED = Math.PI * 2 / 0.7;  // rychlost rotace kostky ve vzduchu (rad/s)
