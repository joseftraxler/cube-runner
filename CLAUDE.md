# CLAUDE.md

Pokyny pro práci na této hře. Drž se jich, ať zůstane konzistentní.

## Co to je

Skákací arkáda ve stylu Geometry Dash v čistém JavaScriptu (ES moduly), běží celá
na HTML `<canvas>`. Bez frameworků, bez závislostí, bez build kroku.

## Spuštění a testování

ES moduly se **nenačtou přes `file://`** – je nutný statický HTTP server:

```bash
python3 -m http.server 8000   # pak http://localhost:8000
```

Není žádný test runner ani linter. Co ale existuje a **po zásahu do fyziky nebo
levelů se má pustit**:

```bash
python3 tools/gen_levels.py --check   # ověří simulací, že jdou levely doběhnout
node tools/playtest.mjs               # projde všech 10 levelů v Chromiu (potřebuje playwright)
node tools/swtest.mjs                 # ověří service worker (offline vs. aktuálnost souborů)
node tools/audiotest.mjs              # ověří, že z hry leze zvuk (analyzátor na výstupu)
```

## Architektura a klíčový princip

**Vazba jde jen jedním směrem: `Game` řídí, entity se starají samy o sebe.**

- `Game` (`js/game.js`) orchestruje hru: herní smyčka, stavy, kamera, kolize
  s překážkami, mince, skóre, vykreslení prostředí (bloky, hroty, portály, HUD)
  a rozhodnutí, **kam** se entita vykreslí.
- Entity (`js/entities/`) **nesmí ovládat hru**. Nemění skóre ani stav hry.
  Do světa jen *nahlížejí* kvůli vlastnímu pohybu (`this.game.level` kvůli
  blokům). `Player` si řeší svoji fyziku a náraz do zdi jen ohlásí příznakem
  `crashed` – že to znamená smrt, rozhoduje `Game`.
- `Entity.draw(ctx, cx, cy, size)` je abstraktní; `Player`/`Saw` ji implementují
  a **nesahají na `this.game`** – dostanou kontext i pozici parametrem. Tuhle
  nezávislost `draw` na hře zachovej.

Ostatní moduly: `level.js` (parsování mapy), `physics.js` (konstanty pohybu),
`input.js` (mapování kláves na akce), `audio.js` (zvuk), `scripts.js` (bootstrap –
canvas, seznam levelů, ovládání, spuštění).

## Ovládání

Klávesy, dotyk i myš vedou do jedné metody `Game.handleAction(action)` (action =
`jump`/`pause`/`restart`/`mute`), puštění tlačítka do `Game.handleRelease(action)`.
Klávesnice mapuje přes `input.js`, dotyk a myš řeší `Game.bindPointer`. Nové vstupy
směruj taky tam, ať se logika neduplikuje.

Držené tlačítko skoku (`holdJump`) skáče znovu hned po dopadu – řeší to `Game.update`,
ne `Player`.

## Pohybový model

Kostka běží konstantní rychlostí doprava, jediná svislá síla je gravitace.
Souřadnice entit jsou **střed** objektu v jednotkách políček.

- Pohyb se počítá po osách zvlášť (`Player.#substep`): nejdřív vodorovně, pak
  svisle. Náraz do bloku vodorovně = `crashed`; svisle = přistání nebo bouchnutí
  hlavou (to nezabíjí).
- Krok se dělí na podkroky max. `MAX_SUBSTEP` políčka, aby kostka neproletěla blokem.
- Gravitaci lze otočit (`Player.gravity` = ±1). Při obrácené gravitaci kostka
  „stojí“ na stropě a skok ji posílá dolů.
- Hroty a pily mají menší hitbox (`HIT`) než kolize s bloky (`CUBE`) – aby hra
  odpouštěla těsné průlety.

Konstanty jsou v `js/physics.js` a plyne z nich tvar skoku (výška 2,5 políčka,
délka ~5,2 políčka při 100 %). **Když je změníš, přegeneruj a přeověř úrovně** –
`tools/gen_levels.py` má vlastní kopii těchto konstant a musí sedět.

## Formát levelu

`new Level(speed, ...rows)`:

- **`speed`** = rychlost běhu v **procentech základní rychlosti** (100 = `BASE_SPEED`).
  Skutečná rychlost se počítá v `Game.loadLevel`.
- **řádky mapy** – legenda: `#` blok, `^` hrot ze země, `v` hrot ze stropu,
  `S` pila, `J` odrazová plošina, `o` skokový prstenec, `D`/`U` gravitační portál
  (dolů/vzhůru), `*` mince, `P` start, `F` cíl, mezera = prázdno.

Mince jsou nepovinné, level končí doběhnutím k `F`. Prostor mimo mapu není pevný –
díra v podlaze je smrtelný pád. `Level.viewTop` počítá, odkud nahoře už je jen
prázdno; hra pak kreslí jen využitou část mapy (kvůli přiblížení obrazu).

## Generování a ověřování úrovní

Mapy staví generátor `tools/gen_levels.py` (`python3 tools/gen_levels.py`) – skládá
je z pojmenovaných úseků (`PATTERNS`) podle `LEVEL_PLAN` a přepíše `js/levels/*.js`.
Standardní cesta k úpravě levelu je **změnit úsek nebo plán** a generátor pustit
znovu (je idempotentní).

Ručně upravenou mapu ale generátor **nepřepíše**: v hlavičce každého souboru je
otisk mapy a když nesedí na obsah, soubor se přeskočí (`--force` to vynutí).
Takový level pak neodpovídá plánu – ověřuj ho přes
`python3 tools/gen_levels.py --verify js/levels/levelX.js`.

Před zápisem každý level ověří **simulací stejného pohybového modelu**: prohledáním
najde, jestli existuje posloupnost skoků, která dojde do cíle. Kontroluje se na
třech snímkových frekvencích a navíc s hrubým rastrem stisků (30 Hz) jako test
hratelnosti. Když level neprojde, skript skončí chybou a nic nezapíše.

`tools/playtest.mjs` totéž ověří proti opravdovému kódu hry: nechá si od generátoru
spočítat čísla snímků, ve kterých se má skočit, a odehraje všech 10 levelů v Chromiu.
Čísla snímků se počítají **z hotových souborů v `js/levels/`**, ne z plánu, takže
playtest sedí i na ručně upravené mapy.
Je to zároveň test, že si JS a simulace v Pythonu odpovídají snímek po snímku –
když se rozejdou, playtest spadne.

### Přidání levelu

1. Přidej úsek do `PATTERNS` a plán do `LEVEL_PLAN` v `tools/gen_levels.py`.
2. Spusť generátor – vznikne `js/levels/levelX.js`.
3. Naimportuj a přidej do pole `levels` v `js/scripts.js`. Pořadí = pořadí ve hře.
4. Přidej soubor do `ASSETS` v `sw.js`.

## Zvuk

`js/audio.js` (třída `Sound`) skládá efekty i hudbu za běhu přes Web Audio API –
**žádné zvukové soubory**, ať zůstane hra bez závislostí a repozitář bez binárek.
Vazba je stejná jako u entit: `Game` zvuku říká, co se stalo (`play('jump')`)
a jestli má hrát hudba (`setMusicOn`), zvuk o hře nic neví.

- AudioContext smí vzniknout **až po interakci uživatele** – proto se `unlock()`
  volá z `handleAction`. Do té doby je `sound.ctx` null a `play()` nic nedělá.
- Hudba je krokový sekvencer plánovaný dopředu (`LOOKAHEAD`) na vlastním časovači,
  ne v herní smyčce – jinak by při propadu snímků vynechávala.
- `Game.loop` každý snímek nastaví `setMusicOn(state === 'playing')`; stav hudby
  se tak neroztahuje po celém kódu. `setTrack` v `loadLevel` vrací skladbu na
  začátek, takže po smrti hraje znovu od začátku.
- Ztlumení se pamatuje v `localStorage` a je řešené hlasitostí (ne přeskočením
  kódu), aby se i ztlumeně pořád testovaly stejné cesty.

## PWA / offline

Hra je instalovatelná PWA: `manifest.json`, `icon.svg`, service worker `sw.js`
(registruje se v `scripts.js`). Do cache `CACHE` se při instalaci přednačte seznam
`ASSETS`, aby hra fungovala offline.

Dvě pravidla, na kterých v `sw.js` záleží (obojí hlídá `node tools/swtest.mjs`):

- **Network-first, ne cache-first.** Online se vždycky použije aktuální soubor
  a jen se uloží stranou; do cache se sahá, až když síť selže. Cache-first by
  znamenal, že se upravený level po reloadu vůbec nenačte a hraje se stará verze.
- **Mažou se jen vlastní cache** (podle prefixu `cube-runner-`). Na stejné doméně
  (třeba GitHub Pages) běží i jiné appky a jejich cache nám nepatří.

**Když přidáš/přejmenuješ soubor** (modul, level, asset), přidej ho do `ASSETS`
**a zvyš verzi** `CACHE` (`cube-runner-vN`) – jinak bude offline chybět. Levely 1–10
se v `ASSETS` generují smyčkou; jiný počet uprav.

## Náhled do README

`docs/preview.png` (obrázek v README) vyrábí `node tools/screenshot.mjs` – je to
skutečný snímek hry z Chromia. Po vizuální změně vykreslování ho přegeneruj.

## Konvence

- **Komentáře a texty v UI česky, s plnou diakritikou.** Identifikátory anglicky.
- V importech vždy uváděj příponu **`.js`** (prohlížeč ji u ES modulů vyžaduje).
- Herní stavy: `ready | playing | paused | dying | levelComplete | won`.
  Smrt neznamená konec hry – po `dying` se level rozeběhne znovu a přičte se pokus.
