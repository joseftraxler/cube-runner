import {Theme} from "../theme.js";

export class Fire extends Theme
{
    drawWorld() {
        this.drawBackground();
        this.drawLevel();
        // Láva teče spodním řádkem mapy, takže se kreslí až přes bloky
        if (this.level.theme === 'fire') this.drawLava();
        this.saws.forEach(s => s.draw(this.ctx, this.px(s.x), this.py(s.y), this.tile));
        this.orbiters.forEach(o => o.draw(this.ctx, this.px(o.x), this.py(o.y), this.tile));

        if (this.state !== 'dying') {
            this.player.draw(this.ctx, this.px(this.player.x), this.py(this.player.y), this.tile);
        }

        this.drawParticles();
        // V ohnivém tématu je pod mapou láva, tmavý pruh by ji jen přikryl
        if (this.level.theme !== 'fire') this.drawGroundLine();
    }
}
