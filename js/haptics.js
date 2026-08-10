/**
 * Haptická odezva – krátké zavibrování telefonu k tomu, co se právě stalo.
 * Doplňuje zvuk: na mobilu se hraje často se ztlumeným zvukem a v hluku, takže
 * je vibrace jediná zpětná vazba, která spolehlivě dojde. Skládá se z holé
 * `navigator.vibrate` – žádná knihovna, žádný soubor.
 *
 * Vazba je stejná jako u zvuku: `Game` jen říká, co se stalo (`play('jump')`),
 * haptika o hře nic neví.
 *
 * Vibrace se posílají **jen ke krátkým jednorázovým událostem**, ne jako
 * podkres – motor v telefonu se rozjíždí i doběhává, takže by se dlouhé vzory
 * slily v jedno hučení a přestalo by být poznat, co se stalo.
 */

const STORAGE_KEY = 'cube-runner-haptics';

/**
 * Vzory vibrací v milisekundách: sudé prvky se vibruje, liché se mlčí.
 * Délka nese význam – běžný skok je sotva znatelné ťuknutí, smrt dlouhý otřes,
 * cíl krátká fanfára. Každé volání předchozí vzor přeruší, takže na sebe smrt
 * a skok nenavrší.
 */
const PATTERNS = {
    coin: [8],
    jump: [10],
    ring: [8, 24, 14],
    pad: [26],
    portal: [12, 20, 12],
    death: [70, 45, 130],
    complete: [24, 40, 24, 40, 70],
    win: [30, 40, 30, 40, 30, 40, 150],
};

export class Haptics {
    constructor() {
        // Bez podpory (desktop bez motoru, iOS Safari) se nic nekreslí ani nepřepíná
        this.supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
        this.enabled = this.supported && readEnabled();
    }

    /** Přepne vibrace a zapamatuje si to do příště. Vrací nový stav. */
    toggle() {
        if (!this.supported) return false;

        this.enabled = !this.enabled;
        // Rozehraný vzor se vypnutím musí umlčet, ne dovibrovat
        if (!this.enabled) this.#vibrate(0);

        try {
            localStorage.setItem(STORAGE_KEY, this.enabled ? '1' : '0');
        } catch { /* v soukromém režimu nevadí, že se to nezapamatuje */ }

        return this.enabled;
    }

    /** Ohlásí událost – stejná jména jako u zvuku (`Sound.play`). */
    play(name) {
        if (!this.enabled) return;
        const pattern = PATTERNS[name];
        if (pattern) this.#vibrate(pattern);
    }

    /**
     * Prohlížeč vibraci odmítne, dokud stránka nedostala dotyk (a v pozadí ji
     * ignoruje úplně). Je to jeho věc, ne chyba hry – nesmí to shodit smyčku.
     */
    #vibrate(pattern) {
        try {
            navigator.vibrate(pattern);
        } catch { /* nevadí – vibrace je bonus, ne podmínka hry */ }
    }
}

// Ve výchozím stavu se vibruje – vypnout jde ikonou v HUD nebo klávesou
function readEnabled() {
    try {
        return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
        return true;
    }
}
