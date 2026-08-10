/**
 * Level rozparsuje mapu předanou jako seznam řádků (stringů).
 *
 * Prvním parametrem je rychlost běhu v procentech základní rychlosti
 * (100 = BASE_SPEED, 130 = o třetinu rychleji). Místo čísla jde předat objekt
 * `{speed, theme}` a levelu tím dát vizuální téma – `'ice'` vykreslí hroty jako
 * modré krápníky, bloky jako namrzlé a nechá padat sníh; `'fire'` mění hroty ze
 * země v plameny, hroty ze stropu v malé sopky, pod mapu dá lávovou řeku
 * a celý obraz rozvlní horkým vzduchem; `'desert'` staví místo hrotů ze země
 * kaktusy, místo hrotů ze stropu poletující supy, bloky mění v pískovec a do
 * pozadí dá duny se sluncem v prachu (taky se vlní horkem).
 * Téma je čistě vzhled, hra běží stejně.
 *
 * Mapa se čte zleva doprava, kostka běží sama a hráč jen skáče.
 * Legenda znaků:
 *   #        pevný blok (podlaha, plošina, zeď) – shora se na něj dá doskočit,
 *            náraz do jeho boku znamená smrt
 *   ^        hrot stojící na zemi (smrtící)
 *   v        hrot visící ze stropu (smrtící)
 *   S        rotující pila (smrtící)
 *   @        koule na řetězu obíhající kolem kotvy (smrtící, pohyblivá)
 *   J        odrazová plošina – při dotyku vymrští kostku výš než běžný skok
 *   o        skokový prstenec – ve vzduchu z něj lze na stisk znovu vyskočit
 *   D        portál s gravitací dolů (normální)
 *   U        portál s gravitací vzhůru (obrácená)
 *   *        mince (bonusové body, k dokončení není potřeba)
 *   P        startovní pozice kostky
 *   F        cíl úrovně
 *   mezera   prázdné políčko
 */
// Kolik políček volného prostoru nechat nad nejvyšší překážkou (kvůli skokům)
const HEADROOM = 2;

// Nejmenší počet řádků, které hra vykresluje (aby byl vidět vrchol skoku)
const MIN_ROWS = 6;

export class Level {
    constructor(options, ...rows) {
        const config = typeof options === 'number' ? {speed: options} : options;
        this.speed = config.speed;
        this.theme = config.theme ?? null;
        this.rows = rows;
        this.height = rows.length;
        this.width = Math.max(...rows.map(r => r.length));

        this.solids = [];     // solids[y][x] = true, pokud je blok
        this.hazards = [];    // hazards[y][x] = 'spikeUp' | 'spikeDown' | null
        this.triggers = [];   // triggers[y][x] = 'pad' | 'ring' | 'gravityDown' | 'gravityUp' | null
        this.coins = [];      // coins[y][x] = true, pokud tam je nesebraná mince
        this.coinCount = 0;
        this.sawSpawns = [];      // [{x, y}]
        this.orbiterSpawns = [];  // [{x, y}] – kotvy koulí na řetězu
        this.playerSpawn = {x: 1, y: this.height - 3};
        this.finishX = this.width;  // vodorovná souřadnice cíle
        this.contentTop = this.height;  // nejvyšší řádek, kde je něco k vidění

        this.#parse();

        // Prázdné nebe nad mapou se nevykresluje – hra tak může přiblížit obraz
        this.viewTop = Math.max(0, Math.min(this.contentTop - HEADROOM, this.height - MIN_ROWS));
    }

    #parse() {
        for (let y = 0; y < this.height; y++) {
            const solidRow = [];
            const hazardRow = [];
            const triggerRow = [];
            const coinRow = [];
            const row = this.rows[y] ?? '';

            for (let x = 0; x < this.width; x++) {
                const ch = row[x] ?? ' ';
                if (ch !== ' ') this.contentTop = Math.min(this.contentTop, y);

                let solid = false;
                let hazard = null;
                let trigger = null;
                let coin = false;

                switch (ch) {
                    case '#':
                        solid = true;
                        break;
                    case '^':
                        hazard = 'spikeUp';
                        break;
                    case 'v':
                        hazard = 'spikeDown';
                        break;
                    case 'S':
                        this.sawSpawns.push({x, y});
                        break;
                    case '@':
                        this.orbiterSpawns.push({x, y});
                        break;
                    case 'J':
                        trigger = 'pad';
                        break;
                    case 'o':
                        trigger = 'ring';
                        break;
                    case 'D':
                        trigger = 'gravityDown';
                        break;
                    case 'U':
                        trigger = 'gravityUp';
                        break;
                    case '*':
                        coin = true;
                        this.coinCount++;
                        break;
                    case 'P':
                        this.playerSpawn = {x, y};
                        break;
                    case 'F':
                        this.finishX = x;
                        break;
                }

                solidRow.push(solid);
                hazardRow.push(hazard);
                triggerRow.push(trigger);
                coinRow.push(coin);
            }

            this.solids.push(solidRow);
            this.hazards.push(hazardRow);
            this.triggers.push(triggerRow);
            this.coins.push(coinRow);
        }
    }

    #inside(x, y) {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }

    // Mimo mapu není nic – kostka tam propadne a zemře (o to jde u děr v podlaze)
    isSolid(x, y) {
        return this.#inside(x, y) && this.solids[y][x];
    }

    hazardAt(x, y) {
        return this.#inside(x, y) ? this.hazards[y][x] : null;
    }

    triggerAt(x, y) {
        return this.#inside(x, y) ? this.triggers[y][x] : null;
    }

    hasCoin(x, y) {
        return this.#inside(x, y) && this.coins[y][x];
    }

    // Sebere minci, vrátí true, pokud tam nějaká byla
    takeCoin(x, y) {
        if (this.hasCoin(x, y)) {
            this.coins[y][x] = false;
            return true;
        }
        return false;
    }
}
