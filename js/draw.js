/**
 * Drobné pomůcky pro kreslení, které potřebuje hra i všechna prostředí
 * (`js/themes/`). Jsou tady, aby je nemusel každý soubor opisovat – a taky
 * proto, že `noise` a `wrap` drží pravidlo, na kterém stojí celé vykreslování:
 * kresba se počítá z místa, ne z pořadí, takže při posunu kamery neposkakuje.
 */

export const TAU = Math.PI * 2;

// Stálé „náhodné“ číslo 0–1 pro dané zadání – aby se kresba mezi snímky
// neměnila, ale přitom nebyla pravidelná (námraza, fáze plamenů, vločky)
export function noise(seed) {
    const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return v - Math.floor(v);
}

// Zbytek po dělení, který pro záporná čísla vrací kladnou hodnotu
export function wrap(value, size) {
    return ((value % size) + size) % size;
}

// Cesta zaobleného obdélníku (bez vykreslení – volající si zvolí fill/stroke)
export function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
