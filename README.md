# Cube Runner

Skákací arkáda ve stylu Geometry Dash napsaná v čistém JavaScriptu (ES moduly),
která běží celá na HTML `<canvas>`. Bez frameworků, bez závislostí, bez build kroku.

Kostka běží sama pořád doprava a jediné, co s ní hráč dělá, je skok. Hra obsahuje
10 úrovní, každou s vlastním tématem – propasti, plošiny, pily, nízké stropy,
odrazové plošiny, skokové prstence, obrácená gravitace – a s rostoucí rychlostí
i hustotou překážek. Poslední úroveň běží o polovinu rychleji než první a je
skoro dvakrát delší.
Zvukové efekty i hudba na pozadí se skládají přímo v prohlížeči, takže hra
nepotřebuje žádné zvukové soubory.

**▶️ Zahrát online: <https://joseftraxler.github.io/cube-runner/>**

![Náhled hry Cube Runner – 6. úroveň, kostka přeskakuje odrazovou plošinu pod visícími hroty](docs/preview.png)

## Ovládání

| Akce                          | Klávesy                          | Dotyk / myš               |
|-------------------------------|----------------------------------|---------------------------|
| Skok                          | `mezerník`, `↑`, `W` nebo `Enter`| ťuknutí kamkoli do hry    |
| Pauza                         | `P` nebo `Esc`                   | ťuknutí do horního pruhu  |
| Restart úrovně                | `R`                              | –                         |
| Zvuk zapnout / vypnout        | `M`                              | ťuknutí na ikonu vpravo nahoře |
| Start / pokračování           | `mezerník`                       | ťuknutí                   |

Tlačítko skoku se dá **držet** – kostka pak vyskočí znovu hned, jak dopadne.
Skákat jde jen ze země (nebo ze skokového prstence), ve vzduchu už s letem nic
neuděláš, takže jde všechno o načasování.

Cílem je doběhnout na konec úrovně. Náraz do hrotu, do pily i do boku bloku
znamená smrt, stejně jako pád do propasti. Umřít nevadí – úroveň se hned rozeběhne
znovu od začátku, počítá se jen počet pokusů a nejdále dosažený postup (bílá
značka v ukazateli nahoře). Po cestě se dají sbírat **mince** za body; k dokončení
úrovně potřeba nejsou.

## Herní prvky

| Prvek                | Co dělá                                                              |
|----------------------|----------------------------------------------------------------------|
| Blok                 | Dá se na něj doskočit shora. Náraz do boku = smrt.                    |
| Hrot                 | Smrtící. Stojí na zemi, nebo visí ze stropu.                          |
| Propast              | Díra v podlaze – kostka propadne a umře.                              |
| Pila                 | Rotující kotouč, smrtící při dotyku.                                  |
| Odrazová plošina     | Při dotyku vymrští kostku o dost výš než běžný skok (i bez stisku).   |
| Skokový prstenec     | Ve vzduchu z něj jde na stisk skočit znovu. Jednou za pokus.          |
| Gravitační portál    | Otočí gravitaci – kostka spadne na strop a běží po něm hlavou dolů.   |
| Mince                | Bonusové body, sbírání je nepovinné.                                  |
| Rozcestí             | Dvě cesty vedle sebe: dole se jen skáče, nahoře jsou mince navíc.     |
| Past                 | Odrazová plošina pod visícími hroty – kdo na ni šlápne, je vymrštěn do nich. Musí se přeskočit. |

Skok je vždycky stejně vysoký: vyskočí na blok vysoký **2 políčka** a přeskočí
díru širokou **4 políčka**. S vyšší rychlostí úrovně se skok neprodlužuje do výšky,
ale doletí dál – a času na reakci je míň.

## Zvuk

Hra nepoužívá žádné zvukové soubory – **efekty i hudba se skládají za běhu**
přes Web Audio API (oscilátory a šum). Každá úroveň má vlastní mollovou stupnici,
harmonii i tempo odvozené od své rychlosti, takže s obtížností roste i tah hudby.

Skladba navíc **graduje podle toho, jak daleko doběhneš**: na začátku hraje jen
temná basa s kopákem a přivřeným filtrem, kolem třetiny úrovně naskočí virbl,
hi-hat, melodie s dozvukem a éterický protihlas – táhlá sinusovka bez ostrého
náběhu, která se pomalu nadechne, plynule překlouže pár sousedních tónů stupnice
a zase vyhasne, přičemž jí výšku lehce rozechvívá pomalé vibrato. Po nadpoloviční
části se přidá arpeggio a filtr se otevře naplno. Každý přechod podtrhne činel s nájezdem. Po smrti se intenzita vrátí na
začátek – hudba tak přímo odráží, jak se ti daří.

Zvuk naběhne až po prvním stisku (prohlížeče dřív přehrávání nepovolí).
Ztlumení klávesou `M` se pamatuje do příště.

## Spuštění

Hra používá ES moduly, které prohlížeč **nenačte přes `file://`** – je potřeba
statický HTTP server. Nejjednodušší varianty:

```bash
# Python 3
python3 -m http.server 8000
```

```bash
# Node.js (balíček serve)
npx serve
```

Poté otevři `http://localhost:8000` v prohlížeči.

## Instalace (PWA)

Hra je progresivní webová aplikace – z prohlížeče ji lze **nainstalovat** (na ploše
„Instalovat aplikaci“, na mobilu „Přidat na plochu“) a díky service workeru pak
**běží i offline**. Stačí navštívit [živou verzi](https://joseftraxler.github.io/cube-runner/)
a použít nabídku instalace.

## Struktura projektu

```
index.html              vstupní stránka s <canvas>
css/styles.css          roztažení plátna přes celé okno
manifest.json           PWA manifest (instalace hry)
sw.js                   service worker (běh offline)
icon.svg                ikona aplikace
js/
├── scripts.js          bootstrap – canvas, ovládání, seznam levelů, spuštění hry
├── game.js             Game – herní smyčka, stavy, kolize s překážkami, vykreslování
├── level.js            Level – parsování mapy a rychlosti
├── audio.js            Sound – syntéza zvukových efektů a hudby (Web Audio)
├── physics.js          fyzikální konstanty (gravitace, skok, velikost kostky)
├── input.js            mapování kláves na akce
├── entities/
│   ├── entity.js       Entity – základ pohyblivého objektu (abstraktní draw)
│   ├── player.js       Player – fyzika kostky a její vykreslení
│   └── saw.js          Saw – rotující pila
└── levels/
    └── level1.js … level10.js   definice jednotlivých úrovní
tools/
├── gen_levels.py       generátor úrovní + ověření průchodnosti simulací
├── playtest.mjs        automatické projití všech levelů v prohlížeči
├── swtest.mjs          test service workeru (offline vs. aktuálnost souborů)
├── audiotest.mjs       test zvuku (měří signál na výstupu hry)
└── screenshot.mjs      náhled hry do README
```

Zodpovědnosti jsou rozdělené: `Game` řídí hru a entitám říká, kam se mají
vykreslit, zatímco každá entita se stará jen sama o sebe (svůj pohyb a vzhled).

## Formát úrovně

Úroveň je instance třídy `Level`. Prvním argumentem je rychlost běhu v procentech
základní rychlosti (100 = základ, 140 = o 40 % rychleji), následují řádky mapy:

```js
import {Level} from "../level.js";

const level1 = new Level(
    100,                          // rychlost v % základní rychlosti
    "                        ",
    "                        ",
    "            *           ",
    "                        ",
    " P     ^        ####    ",
    "#####################F##",
);

export {level1};
```

Legenda znaků mapy:

| Znak      | Význam                                                        |
|-----------|---------------------------------------------------------------|
| `#`       | pevný blok (podlaha, plošina, zeď)                            |
| `^`       | hrot stojící na zemi                                          |
| `v`       | hrot visící ze stropu                                         |
| `S`       | rotující pila                                                 |
| `J`       | odrazová plošina                                              |
| `o`       | skokový prstenec                                              |
| `D`       | gravitační portál – gravitace dolů (normální)                 |
| `U`       | gravitační portál – gravitace vzhůru (obrácená)               |
| `*`       | mince (nepovinná)                                             |
| `P`       | startovní pozice kostky                                       |
| `F`       | cíl úrovně                                                    |
| (mezera)  | prázdné políčko                                               |

Řádky nemusí být stejně dlouhé – chybějící znaky se berou jako prázdno. Prostor
mimo mapu není pevný, takže díra v podlaze znamená pád mimo úroveň.

### Přidání vlastní úrovně

1. Vytvoř soubor `js/levels/levelX.js` podle vzoru výše.
2. V `js/scripts.js` ho naimportuj a přidej do pole `levels`.
3. Přidej cestu k souboru do seznamu `ASSETS` v `sw.js` a zvyš verzi cache.

Pořadí v poli určuje pořadí úrovní ve hře.

## Nástroje

Úrovně v `js/levels/` nejsou psané ručně – skládá je generátor z hotových úseků
(hrot, propast, plošina, strop, portál …) a **ověřuje simulací, že jdou doběhnout**:

```bash
python3 tools/gen_levels.py           # vygeneruje js/levels/level1..10.js
python3 tools/gen_levels.py --check   # jen ověří průchodnost, nic nepřepíše
```

Level jde upravit i ručně přímo v `js/levels/levelX.js` – generátor pozná podle
otisku v hlavičce, že do souboru někdo sáhl, a **nepřepíše ho** (`--force` to
vynutí). Takovou mapu si ověř zvlášť:

```bash
python3 tools/gen_levels.py --verify js/levels/level3.js
```

Simulace používá stejný pohybový model jako hra a prohledá všechny možnosti, kdy
lze skočit. Kromě průchodnosti kontroluje i hratelnost – level musí jít doběhnout
i tomu, kdo mačká jen 30× za sekundu.

Volitelně (potřebuje Node.js a `npm i -D playwright`) jde hru nechat celou projít
v opravdovém prohlížeči a vyrobit náhled:

```bash
node tools/playtest.mjs               # projde všech 10 levelů skutečným kódem hry
node tools/swtest.mjs                 # ověří chování service workeru (offline vs. aktuálnost)
node tools/audiotest.mjs              # ověří, že z hry opravdu leze zvuk
node tools/screenshot.mjs             # přegeneruje docs/preview.png
```

### Když se úprava levelu neprojeví

Hra je PWA se service workerem, takže do hry vstupuje ještě cache. Service worker
je nastavený **network-first** – online tedy vždycky dostaneš aktuální soubor.
Pokud se přesto načítá stará verze, bývá to jednou z těchto věcí:

- **starý service worker** z dřívější návštěvy: v DevTools → Application →
  Service Workers zaškrtni „Update on reload“, nebo dej „Unregister“ a načti znovu;
- **cache prohlížeče**: hard reload (`Ctrl`/`Cmd` + `Shift` + `R`);
- **GitHub Pages** posílá u statických souborů `Cache-Control: max-age=600`,
  takže se změna na živé verzi může projevit až za pár minut.

Ruční úpravu mapy generátor nepřepíše (viz [Nástroje](#nástroje)), takže o ni
tímhle způsobem nepřijdeš.

## Licence

Projekt je dostupný pod licencí [MIT](LICENSE).

## Poznámka

Jde o studijní/hobby projekt inspirovaný hrou Geometry Dash. S jejím autorem
(RobTop Games) nemá nic společného a není jím nijak podporovaný.
