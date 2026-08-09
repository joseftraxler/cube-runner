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
];

const controls = {
    'jump': ['space', 'arrowUp', 'keyW', 'enter'],
    'pause': ['escape', 'keyP'],
    'restart': ['keyR'],
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
