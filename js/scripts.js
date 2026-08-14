import {Game} from "./game.js";
import {level1} from "./levels/level1.js";
import {level2} from "./levels/level2.js";
import {level3} from "./levels/level3.js";
import {level4} from "./levels/level4.js";
import {level5} from "./levels/level5.js";
import {level6} from "./levels/level6.js";
import {level7} from "./levels/level7.js";
import {level8} from "./levels/level8.js";
import {level9} from "./levels/level9.js";
import {level10} from "./levels/level10.js";
import {level11} from "./levels/level11.js";
import {level12} from "./levels/level12.js";
import {level13} from "./levels/level13.js";
import {level14} from "./levels/level14.js";
import {level15} from "./levels/level15.js";
import {level16} from "./levels/level16.js";
import {level17} from "./levels/level17.js";
import {level18} from "./levels/level18.js";
import {level19} from "./levels/level19.js";
import {level20} from "./levels/level20.js";

const canvas = document.getElementsByTagName('canvas')[0];

const levels = [
    level1,
    level2,
    level3,
    level4,
    level5,
    level6,
    level7,
    level8,
    level9,
    level10,
    // Matematický svět – druhá třetina hry, o stupeň těžší
    level11,
    level12,
    level13,
    level14,
    level15,
    // Džungle – poslední třetina, nejrychlejší a nejdelší skoky
    level16,
    level17,
    level18,
    level19,
    level20,
];

const controls = {
    'jump': ['space', 'arrowUp', 'keyW', 'enter'],
    'pause': ['escape', 'keyP'],
    'restart': ['keyR'],
    'mute': ['keyM'],
    'haptics': ['keyH'],
};

// Instance je dostupná i z konzole prohlížeče – hodí se na ladění
// a používá ji automatický průchod levely (tools/playtest.mjs)
window.cubeRunner = new Game(canvas, levels, controls);

// Service worker – umožní instalaci hry a běh offline (PWA)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // '../sw.js' vůči tomuto modulu = kořen webu (scope celé hry)
        navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
    });
}
