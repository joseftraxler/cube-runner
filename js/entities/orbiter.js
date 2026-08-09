import {Entity} from "./entity.js";

// Poloměr oběhu (vzdálenost koule od kotvy) a poloměr samotné koule, v políčkách
export const ORBIT_RADIUS = 1.2;
export const BALL_RADIUS = 0.4;

// Úhlová rychlost oběhu (rad/s)
const ORBIT_SPEED = 2.2;

/**
 * Ostnatá koule na řetězu, která obíhá kolem pevné kotvy. Na rozdíl od pily
 * se pohybuje, takže je smrtící jinde v jinou chvíli – kostka musí projet ve
 * chvíli, kdy je koule na druhé straně.
 *
 * Poloha koule je čistá funkce času (`animPhase`), a protože kostka běží
 * konstantní rychlostí, je v každém místě levelu pokaždé stejná. Díky tomu se
 * úsek dá naučit a simulace v generátoru ho umí spočítat dopředu.
 */
export class Orbiter extends Entity {
    get angle() {
        return this.animPhase * ORBIT_SPEED;
    }

    // Střed koule ve světových souřadnicích (v políčkách)
    get ballX() {
        return this.x + Math.cos(this.angle) * ORBIT_RADIUS;
    }

    get ballY() {
        return this.y + Math.sin(this.angle) * ORBIT_RADIUS;
    }

    draw(ctx, cx, cy, size) {
        const bx = cx + Math.cos(this.angle) * ORBIT_RADIUS * size;
        const by = cy + Math.sin(this.angle) * ORBIT_RADIUS * size;

        // Řetěz – jen článek za článkem od kotvy ke kouli
        ctx.strokeStyle = 'rgba(215, 223, 232, 0.55)';
        ctx.lineWidth = Math.max(size * 0.05, 1);
        ctx.setLineDash([size * 0.12, size * 0.09]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);

        // Kotva
        ctx.fillStyle = '#5a6b7d';
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.12, 0, Math.PI * 2);
        ctx.fill();

        // Koule s trny
        const r = BALL_RADIUS * size;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(this.angle * 1.5);

        ctx.fillStyle = '#c4ccd6';
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a - 0.25) * r * 0.75, Math.sin(a - 0.25) * r * 0.75);
            ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
            ctx.lineTo(Math.cos(a + 0.25) * r * 0.75, Math.sin(a + 0.25) * r * 0.75);
            ctx.closePath();
            ctx.fill();
        }

        const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
        grad.addColorStop(0, '#8d99a8');
        grad.addColorStop(1, '#39485a');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#1d2836';
        ctx.lineWidth = Math.max(size * 0.03, 1);
        ctx.stroke();

        ctx.restore();
    }
}
