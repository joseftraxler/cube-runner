import {Entity} from "./entity.js";

// Poloměr pily v políčkách (kolizní i vykreslovací)
export const SAW_RADIUS = 0.45;

/**
 * Rotující pila – stojí na místě a točí se. Nepohybuje se, ale animaci i
 * vzhled si řeší sama, proto je to entita a ne jen znak v mapě.
 */
export class Saw extends Entity {
    draw(ctx, cx, cy, size) {
        const r = SAW_RADIUS * size;
        const teeth = 8;
        const angle = this.animPhase * 5.5;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);

        // Zuby dokola
        ctx.fillStyle = '#d7dfe8';
        ctx.beginPath();
        for (let i = 0; i < teeth * 2; i++) {
            const a = (i / (teeth * 2)) * Math.PI * 2;
            const rad = i % 2 === 0 ? r : r * 0.72;
            const px = Math.cos(a) * rad;
            const py = Math.sin(a) * rad;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#5a6b7d';
        ctx.lineWidth = Math.max(size * 0.04, 1);
        ctx.stroke();

        // Střed
        ctx.fillStyle = '#39485a';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#d7dfe8';
        ctx.beginPath();
        ctx.moveTo(-r * 0.55, 0);
        ctx.lineTo(r * 0.55, 0);
        ctx.stroke();

        ctx.restore();
    }
}
