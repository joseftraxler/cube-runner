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
python3 tools/gen_levels.py --verify js/levels/level18.js   # totéž pro ručně upravenou mapu
node tools/playtest.mjs               # projde všech 20 levelů v Chromiu
node tools/swtest.mjs                 # ověří service worker (offline vs. aktuálnost souborů)
node tools/audiotest.mjs              # ověří, že z hry leze zvuk (analyzátor na výstupu)
node tools/mixtest.mjs                # porovná hlasitost hudby mezi tématy
node tools/perftest.mjs               # změří cenu snímku v každém tématu
```

Po zásahu do kreslení pusť `perftest.mjs` a porovnej témata mezi sebou – čísla
jsou relativní k počítači, na kterém běží, ale poměry mezi tématy sedí.

Nástroje v Node.js potřebují Chromium přes `playwright` (`npm i -D playwright`) –
proto nejsou součástí hry, jen vývoje. `node tools/playtest.mjs --headed` ukáže,
co se v prohlížeči děje. Generátor běží na čistém Pythonu 3, bez balíčků.

## Architektura a klíčový princip

**Vazba jde jen jedním směrem: `Game` řídí, entity i prostředí se starají samy
o sebe.**

- `Game` (`js/game.js`) orchestruje hru: herní smyčka, stavy, kamera, kolize
  s překážkami, mince, skóre, vykreslení věcí společných všem světům (prstence,
  portály, plošiny, mince, cíl, HUD) a rozhodnutí, **kdy a kam** se co vykreslí.
- Entity (`js/entities/`) **nesmí ovládat hru**. Nemění skóre ani stav hry.
  Do světa jen *nahlížejí* kvůli vlastnímu pohybu (`this.game.level` kvůli
  blokům). `Player` si řeší svoji fyziku a náraz do zdi jen ohlásí příznakem
  `crashed` – že to znamená smrt, rozhoduje `Game`.
- `Entity` (`js/entities/entity.js`) drží startovní pozici, `reset()` a čas
  `animPhase`. `Entity.draw(ctx, cx, cy, size)` je abstraktní; `Player`/`Saw`/
  `Orbiter` ji implementují a **nesahají na `this.game`** – dostanou kontext
  i pozici parametrem. Tuhle nezávislost `draw` na hře zachovej.
- **Kostku převléká prostředí, ne kostka sama.** Když má svět vlastní podobu
  kostky (v ledu je z ní dárek), kreslí ji `Theme.decorateCube` **přes** hotovou
  kostku – volá to `Game.drawWorld` hned za `player.draw`. `Player` o tématu
  pořád neví a kreslí se stejně ve všech světech; kdyby si téma bralo do ruky
  `Player.draw`, obrátila by se vazba, na které celá hra stojí. Převlek musí
  být **neprůhledný a čitelný**: kostka je to, podle čeho hráč pozná, kde je
  a jak je otočený, takže nesmí splynout s pozadím.
- **Prostředí je třída, ne podmínka.** Každé téma má vlastní soubor
  v `js/themes/` a je to potomek `Theme` (`js/theme.js`): říká o sobě odstín
  (`hue`), jestli je v něm horko (`hazy`, `hazeAmplitude`) a jak se jmenuje
  (`name`), kreslí všechno, co se tématem mění (`drawBackground`,
  `drawForeground`, `drawGroundLine`, `paintBlock`, `drawSpikeUp`/`drawSpikeDown`,
  `decorateRing`, `decorateCoin`, `decorateCube`) a vrací motiv hudby (`audio`). `Game` si
  prostředí drží v `this.theme` (staví ho `themeFor` v `js/themes/registry.js`)
  a **nikde se nevětví podle jména tématu** – jediné místo, kde se jméno na třídu
  převádí, je ten registr. Nová podmínka `if (theme === …)` v `game.js` znamená,
  že v `Theme` chybí metoda.
  Sama `Theme` je zároveň prostředí levelů bez tématu (tmavá obloha s mřížkou,
  prosté bloky, rudé hroty, synthwave), takže si každý svět přepisuje jen to,
  čím se liší. Vazba je stejná jako u entit: **téma hru neřídí**, jen do ní
  nahlíží zkratkami (`this.tile`, `this.px`, `this.level`) a kreslí.
- **Svět kreslí `Game.drawWorld`, HUD a překryv až po něm.** Horká témata
  (`Theme.hazy` – ohnivé a pouštní) nechají hotový obraz rozvlnit horkým vzduchem
  (`Game.drawHeatHaze`, sílu vlnění říká `Theme.hazeAmplitude`) – texty se tím
  vlnit nesmí.
  Ozdoby závislé na místě (námraza, fáze plamenů, tvar kaktusu) počítej
  z `noise(x, y)`, ne z `Math.random()`, jinak budou při posunu kamery
  poskakovat.
- **Co se mezi snímky nemění, kresli jednou a pak kopíruj.** Rasterizace je
  na slabších zařízeních dražší než všechno ostatní dohromady (viz *Výkon*):
  bloky se berou z dlaždic (`bakeBlock`), nehybné pozadí z obrazu
  (`drawBackdrop`). Mezipaměti platí pro téma, odstín a velikost políčka –
  zahazuje je `#dropStaleCaches` v `resize()`. Přibude-li kresba, která se
  mění každý snímek, patří mimo ně.
- **Matematické symboly se rýsují čarami (`mathGlyph` v `js/themes/math.js`),
  ne písmem.** Znaky jako ∑ nebo ∮ nemá každé zařízení ve fontu a místo symbolu
  by se ukázal prázdný obdélníček; rýsovaný tah navíc sedí k papíru v pozadí.
  Obrazce v pozadí (`drawFigures`) drží malý parallax a bledou barvu – pozadí má
  být hloubka, ne rozptýlení, překážky musí zůstat čitelné na první pohled.
- **Pozadí nesmí zaplnit propast.** Díra v podlaze je smrtelná, takže pod
  úrovní země patří tma – pouštní duny proto končí u horní hrany podlahy
  a zbytek plátna `Desert.drawBackground` přetře natmavo.
- **Prvky mapy vyhodnocuje `Game`, ne `Player`.** Odrazovou plošinu a gravitační
  portál řeší `Game.applyTriggers` (volá `player.jump(PAD_BOOST)`, přepíná
  `player.gravity`), prstenec `Game.tryJump`. Kostka o nich nic neví.
- Stav pokusu žije v `Game`: využité prstence (`usedRings`), sebrané mince,
  postup (`progress`/`best`). `loadLevel` level znovu rozparsuje, takže se po
  smrti mince i prstence obnoví.
- **Pohyblivé překážky se hýbou jen ve stavu `playing`** (`Game.update` je krokuje
  až za kontrolou stavu). Jejich `animPhase` je tím pádem přesně odehraný čas
  a poloha je čistá funkce místa v levelu – bez toho by je generátor nemohl
  odsimulovat a playtest by se s hrou rozešel.

Ostatní moduly: `level.js` (parsování mapy), `physics.js` (konstanty pohybu),
`input.js` (mapování kláves na akce), `audio.js` (zvuk), `haptics.js` (vibrace),
`draw.js` (sdílené pomůcky pro kreslení – `noise`, `wrap`, `TAU`),
`scripts.js` (bootstrap – canvas, seznam levelů, ovládání, spuštění).

Instance hry visí na `window.cubeRunner` – sahá po ní ladění v konzoli i nástroje
(`playtest.mjs`, `screenshot.mjs`, `audiotest.mjs`, `perftest.mjs`), takže ji tam nech.

## Výkon

Hra běží na telefonech, takže **na snímek je rozpočet pár milisekund**. Měření
(`tools/perftest.mjs`) ukázalo, kde se peníze utrácejí, a z toho plynou tři
pravidla:

- **Nejdražší je rasterizace, ne JavaScript.** Fyzika stojí tisíciny milisekundy,
  zvuk kolem procenta času – ale přemalovat plátno stojí milisekundy. Optimalizuj
  podle toho, kolik pixelů a kolik kreslicích volání ze snímku leze, ne podle
  toho, kolik je v kódu řádků.
- **Kopie plátna se nesmí zvětšovat ani posouvat o zlomky pixelu.** Roztažená
  kopie se počítá pixel po pixelu, kopie 1:1 na celé pixely je přesun paměti.
  Vlnění horkého vzduchu na tom stálo: než se srovnalo (celá čísla, jen spodek
  obrazu, žádná cesta přes pomocné plátno a zpátky), bralo si přes 11 ms ze
  snímku – víc než celý zbytek hry.
- **Předkreslené kusy obrazu drž stálé.** Dlaždice bloků se vybírají ze souřadnic
  políčka (`BLOCK_VARIANTS` podob), ne z pořadí kreslení – jinak by se kresba při
  posunu kamery přeskládávala. Totéž u pozadí: obraz v `drawBackdrop` se smí jen
  posouvat do strany, cokoliv animovaného patří až přes něj.

## Ovládání

Klávesy, dotyk i myš vedou do jedné metody `Game.handleAction(action)` (action =
`jump`/`pause`/`restart`/`mute`/`haptics`), puštění tlačítka do
`Game.handleRelease(action)`.
Klávesnice mapuje přes `input.js`, dotyk a myš řeší `Game.bindPointer` (horní pruh
= pauza, jeho pravý roh = zvuk, pruh vedle = vibrace, zbytek plochy = skok). Nové
vstupy směruj taky tam, ať se logika neduplikuje. Přepínače v rohu HUD se kreslí
do stejně širokých pruhů (`ICON_ZONE`), do jakých se ťuká – ikona i dotyková
plocha tak drží pohromadě.

Do horního pruhu se na telefonu všechno nevejde, takže `drawHud` texty **měří
a zkracuje po stupních**: nejdřív zmizí procenta uprostřed (postup ukazuje i pruh
nad nimi), pak popisek `POKUS` a nakonec slovo `LEVEL`. Kdyby se místo měření
odhadovalo podle šířky okna, delší čísla (stovky pokusů, vysoké skóre) by se
zase překryla.

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
- Hroty, pily i koule mají menší hitbox (`HIT`) než kolize s bloky (`CUBE`) – aby
  hra odpouštěla těsné průlety. Kulaté překážky se měří vzdáleností od hitboxu
  (`Game.hitsCircle`), hroty zmenšeným obdélníkem.

Konstanty jsou v `js/physics.js` a plyne z nich tvar skoku (výška 2,5 políčka,
délka ~5,2 políčka při 100 %). **Když je změníš, přegeneruj a přeověř úrovně** –
`tools/gen_levels.py` má vlastní kopii těchto konstant a musí sedět.

## Formát levelu

`new Level(speed, ...rows)`:

- **`speed`** = rychlost běhu v **procentech základní rychlosti** (100 = `BASE_SPEED`).
  Skutečná rychlost se počítá v `Game.loadLevel`.
- **řádky mapy** – legenda: `#` blok, `^` hrot ze země, `v` hrot ze stropu,
  `S` pila, `@` koule na řetězu, `J` odrazová plošina, `o` skokový prstenec,
  `D`/`U` gravitační portál (dolů/vzhůru), `*` mince, `P` start, `F` cíl,
  mezera = prázdno.
- místo čísla jde předat `{speed, theme}`; jméno tématu si `Game` vymění za
  třídu prostředí (`js/themes/`), takže **kresba i hudba světa jsou v jednom
  souboru**. Téma `'ice'` jsou **Vánoce v ledové jeskyni**: hroty ze země jsou
  zasněžené stromečky s hvězdou na špici, hroty ze stropu rampouchy, bloky jsou
  namrzlé, v pozadí padá sníh a z kostky je dárek (`decorateCube`), téma `'fire'` mění
  hroty ze země v pohyblivé plameny, hroty ze stropu v malé sopky, pod mapu dá
  lávovou řeku a celý obraz rozvlní horkým vzduchem, téma `'desert'` staví místo
  hrotů ze země kaktusy, místo hrotů ze stropu poletující supy, bloky mění
  v pískovec, do pozadí dá duny se sluncem v prachu a taky se vlní horkem,
  téma `'math'` mění hroty v operátory Δ (ze země) a ∇ (ze stropu), bloky
  v dlaždice rýsovacího papíru se symbolem, minci v ražbu s π, prstenec
  v křivkový integrál (∮ – obíhající šipka ukazuje orientaci) a do pozadí dá
  rýsovací papír s geometrickými obrazci a vztahy mezi nimi, téma `'jungle'`
  staví místo hrotů ze země masožravé rostliny, místo hrotů ze stropu hady
  na liánách, bloky mění v zarostlé chrámové kvádry (mech na volné horní hraně)
  a do pozadí dá koruny stromů s pruhy světla, kmeny v mlze, houpající se liány
  a světlušky. Rudá tlama a jantarové pruhy jsou v zeleném prostředí schválně:
  zelená rostlina by splynula s pozadím a nebylo by poznat, co zabíjí.
  Téma navíc určuje **motiv hudby** (`Theme.audio()`) – na fyziku ani hitboxy
  ale nesahá. Přiřazení témat levelům drží `LEVEL_THEMES` v generátoru.
- **Světy se po hře střídají, nejdou po blocích.** Prostředí se přiřazuje
  nezávisle na tom, z jaké kapitoly jsou úseky levelu: hráč tak vidí všechna
  prostředí od začátku a žádná část hry nevypadá dlouho stejně. Úseky se ale
  nestěhují – ty jsou svázané s rychlostí levelu (viz níž), takže vzhled a mapa
  spolu nesouvisí a názvy úseků (`canopy`, `parabola`) říkají jen, pro který svět
  vznikly. Bez tématu zůstávají levely 1, 8 a 15 – i „žádné téma“ je prostředí
  a taky se střídá.
- **Dva levely stejného tématu si nesmí sáhnout na tentýž motiv.** Hudba vybírá
  obměnu jako `levelIndex % počet` (`Sound.setTrack`) a `Theme.hue` odvozuje
  z čísla levelu i odstín, takže třeba dva ledové levely se stejným zbytkem
  by zněly i vypadaly úplně stejně. Hlídá to `check_theme_variety()`
  v generátoru – jeho `THEME_VOICES` musí sedět s poli, která vrací
  `Theme.audio()`.

Mince jsou nepovinné, level končí doběhnutím k `F`. Prostor mimo mapu není pevný –
díra v podlaze je smrtelný pád. `Level.viewTop` počítá, odkud nahoře už je jen
prázdno; hra pak kreslí jen využitou část mapy (kvůli přiblížení obrazu).

## Generování a ověřování úrovní

Mapy staví generátor `tools/gen_levels.py` (`python3 tools/gen_levels.py`) – skládá
je z pojmenovaných úseků (`PATTERNS`) podle `LEVEL_PLAN` a přepíše `js/levels/*.js`.
Každá úroveň stojí v plánu na **vlastní sadě úseků**, které se jinde skoro
neobjeví (propasti, terén, pohyblivé překážky, stropy, odrazové plošiny,
prstence, gravitace). Jen jiné pořadí stejných úseků nestačí – kola pak působí
stejně. Obecné hroty (`spike*`) slouží jako spojovací materiál, ne jako náplň.
Gravitační portál jde přeskočit, pokud je nízký – úsek `gravity` proto má
překážky **na stropě i na podlaze** a obě cesty musí být průchozí (ověřuj obojí
zvlášť tak, že tu druhou zataraseš). Naproti tomu `gravitylock` má portál tři
políčka vysoký, takže ho přeskočit nejde (skok zvládne 2,5 políčka), a výstupní
portál leží o řádek pod dráhou po stropě – musí se do něj záměrně klesnout,
jinak kostka na konci stropu vyletí z mapy.
Hustotu řídí šířka oddechu mezi úseky: `flat` (8 políček) na klid, `flat4` (4) tam,
kde mají překážky navazovat. Úseky samotné mají okraje co nejužší – prázdno
uvnitř úseku se sčítá s oddechem a level pak působí prázdně.
Standardní cesta k úpravě levelu je **změnit úsek nebo plán** a generátor pustit
znovu (je idempotentní).

Všechny úseky mají pevnou geometrii: přesně `HEIGHT` (14) řádků, podlaha od řádku
`GROUND_ROW` (12), v zápisu se místo mezery píše `.` (funkce `pattern` to převede).
Vizuální téma se levelu přiřadí v `LEVEL_THEMES` podle jeho čísla.

**Levely 11–15 jsou prostřední kapitola a o stupeň těžší** – běží
na 160–185 % a stojí na vlastních úsecích, kde už nestačí jedna překážka:
`ringspan` a `padring` mají propast, přes kterou se dostaneš jen prstencem
(a `padring` až kombinací odrazové plošiny a prstence), `ringtrap` nad prstenec
zavěsí hroty, takže se z něj nesmí odrazit hned ve vrcholu skoku, `gravitygap`
vede portálem nad propastí (podlaha pod ním chybí, přeskočit ho nejde),
`skyroad` běží po stropě, ve kterém jsou díry (obrácená gravitace kostku dírou
vynese z mapy), `underpass` nabízí dvě cesty naráz, `pillars` má rozteč sloupů
sladěnou s délkou skoku a `crusher` škrtí skok stropem i nad propastí.
Protože **délka skoku roste s rychlostí levelu** (~8,3 políčka na 160 %, ~9,6 na
185 %), tyhle úseky nejdou bez ověření přesadit do pomalejšího levelu – rozteče
by přestaly sedět. Fáze koulí na řetězu (`pendulum`) navíc závisí na tom, kde
v levelu úsek leží, takže se ověřuje **na svém místě v plánu**, ne zvlášť.

**Levely 16–20 jsou poslední kapitola a běží na 190–210 %.** Tam už je
skok dlouhý přes deset políček, takže hustotou překážek se obtížnost dělat nedá –
jedním obloukem by se přeskákaly. Tyhle úseky proto stojí na něčem jiném:
`canopy` a `treehop` na doskocích do korun (pod plošinami jsou trny, takže spodem
cesta nevede), `lilypads` a `stiltpath` mají rozteč ostrůvků sladěnou s délkou
skoku, `trapfloor` nechá strop uříznout vrchol oblouku zrovna nad dírami,
`idolgap` nutí doskočit na vyvýšenou římsu, `templegate` otevře jen odrazová
plošina (zeď je tři políčka vysoká), `ringroots` prodlouží skok prstencem přes
čtyřpolíčkovou stěnu a `jungleheart` spojí plošinu i prstenec – každé zvlášť
skončí v rokli (ověřeno tak, že se to druhé z mapy vyškrtne).
`snakerun` je jediný úsek postavený na hustotě: hadi visí přesně ve výšce vrcholu
skoku, takže odraz musí padnout tak, aby se vrchol trefil do mezery mezi ně.
Rozteče jsou počítané na rychlost svého levelu, takže **přesazení jinam se musí
ověřit** – na 210 % je skok o políčko delší než na 190 %.

Ručně upravenou mapu ale generátor **nepřepíše**: v hlavičce každého souboru je
otisk mapy a když nesedí na obsah, soubor se přeskočí (`--force` to vynutí).
Takový level pak neodpovídá plánu – ověřuj ho přes
`python3 tools/gen_levels.py --verify js/levels/levelX.js`.

**Ručně doladěné jsou levely 12, 18, 19 a 20** – proti `LEVEL_PLAN` jsou těžší
a `LEVEL_PLAN` je tedy u nich už jen historie toho, z čeho vznikly:
dvanáctka přidala do slalomu koule na řetězu a další pilu, chodby s hroty
zavěšenými nad hlavou a prstenec v díře v podlaze; osmnáctka a dvacítka nechávají
podlahu na dlouhých úsecích úplně chybět a nahrazují ji řadou prstenců vedle sebe
(kostka propast přeletí od jednoho k druhému), nad ni věší strop z hrotů
a přidávají gravitační portály, takže se kus levelu běží po stropě;
u devatenáctky jde jen o přesunutou minci. Z toho plyne:

- **`--check` na ně nesahá** – ověřuje podobu z plánu, ne obsah souborů. Ty
  kontroluje `--verify` (a proti opravdovému kódu hry `playtest.mjs`, který mapy
  čte ze souborů).
- **`--force` je zahodí** a přepíše plánovanou verzí. Nepouštěj ho, dokud nechceš
  přesně tohle; běžné `python3 tools/gen_levels.py` je bezpečné, ty čtyři soubory
  přeskočí.
- `--verify` na nich trvá dlouho: level 18 má přes sto prstenců, každý z nich je
  v každém snímku další větev prohledávání, a projít třikrát celý level plus
  hratelnostní běh zabere kolem čtvrt hodiny (12, 19 a 20 jsou do pár minut).
  Není to zaseknutí, jen cena za ty prstence. `--paths` (a tím i `playtest.mjs`
  se `screenshot.mjs`) tím netrpí – hledá jednu cestu s hrubým rastrem stisků
  a má všech 20 levelů pod minutu.
- Úpravu plánu, která se má na těchhle levelech projevit, musíš promítnout
  **i do souboru** – z generátoru se do nich nic nedostane.

Před zápisem každý level ověří **simulací stejného pohybového modelu**: prohledáním
najde, jestli existuje posloupnost skoků, která dojde do cíle. Kontroluje se na
třech snímkových frekvencích a navíc s hrubým rastrem stisků (30 Hz) jako test
hratelnosti. Když level neprojde, skript skončí chybou a nic nezapíše.
Součástí stavu je i seznam využitých prstenců, ale **prstence, které kostka
minula, se ze stavu zahazují** – bez toho si prohledávání pamatuje zvlášť každou
kombinaci a u levelu s několika prstenci se ověření protáhne z desítek sekund
na minuty.

`tools/playtest.mjs` totéž ověří proti opravdovému kódu hry: nechá si od generátoru
spočítat čísla snímků, ve kterých se má skočit (`--paths`), a odehraje všech 20 levelů
v Chromiu. Čísla snímků se počítají **z hotových souborů v `js/levels/`**, ne z plánu,
takže playtest sedí i na ručně upravené mapy. Ze stejného zdroje si bere skoky
i `tools/screenshot.mjs`, když přetáčí level na místo pro náhled.
Je to zároveň test, že si JS a simulace v Pythonu odpovídají snímek po snímku –
když se rozejdou, playtest spadne.

### Přidání levelu

1. Přidej úsek do `PATTERNS` a plán do `LEVEL_PLAN` v `tools/gen_levels.py`
   (případně téma do `LEVEL_THEMES`).
2. Spusť generátor – vznikne `js/levels/levelX.js`.
3. Naimportuj a přidej do pole `levels` v `js/scripts.js`. Pořadí = pořadí ve hře.
4. Přidej soubor do `ASSETS` v `sw.js` a zvyš verzi `CACHE`.

### Přidání prostředí

1. Založ `js/themes/<jméno>.js` s potomkem `Theme` – povinné je jen `name()`,
   zbytek přepiš jen tam, kde se svět liší od výchozího vzhledu.
2. Zapiš ho do `THEMES` v `js/themes/registry.js` (jediné místo, kde se jméno
   z mapy převádí na třídu).
3. Doplň téma do `LEVEL_THEMES` a jeho počet obměn do `THEME_VOICES`
   v `tools/gen_levels.py` – ten pak ohlídá, že si dva levely téhož světa
   nesáhnou na stejný motiv.
4. Přidej soubor do `ASSETS` v `sw.js` a zvyš verzi `CACHE`.
5. Pusť `node tools/mixtest.mjs` (hlasitost motivu proti ostatním)
   a `node tools/perftest.mjs` (cena snímku).

## Zvuk

`js/audio.js` (třída `Sound`) skládá efekty i hudbu za běhu přes Web Audio API –
**žádné zvukové soubory**, ať zůstane hra bez závislostí a repozitář bez binárek.
Vazba je stejná jako u entit: `Game` zvuku říká, co se stalo (`play('jump')`)
a jestli má hrát hudba (`setMusicOn`), zvuk o hře nic neví.

- AudioContext smí vzniknout **až po interakci uživatele** – proto se `unlock()`
  volá z `handleAction`. Do té doby je `sound.ctx` null a `play()` nic nedělá.
- Hudba je krokový sekvencer plánovaný dopředu (`LOOKAHEAD`) na vlastním časovači,
  ne v herní smyčce – jinak by při propadu snímků vynechávala. Krok je
  šestnáctina, takt jich má vždycky 16 (`STEPS_PER_BAR`). Jiné metrum se dělá
  **přízvuky uvnitř taktu**, ne jinou délkou taktu: poušť se počítá na dvě
  a bere jeden takt sekvenceru jako dvě dvojčtvrťové míry (kroky 0–7 a 8–15).
  Zkoušelo se to i tak, že si téma řeklo o vlastní délku taktu, ale zůstal
  z toho jen nepoužitý parametr navíc.
- **Každé téma prostředí má vlastní motiv** – drží ho ale **prostředí**
  (`Theme.audio()` v `js/themes/`), ne zvuk: v `audio.js` je *jak* se hraje
  (nástroje a aranžmá), v tématu *co* se hraje (stupnice, harmonie, základní
  tóny, tempo, akord, filtr, dozvuk) a k tomu dvojice „aranžmá + styl melodie“: beztémové levely temné synthwave, `ice` Vánoce
  (rolničky, zvonkohra s koledou, teplý durový akord, praskání ledu), `fire` dvojkopák s chraplavou
  basou, opakovaným riffem a kvintakordy elektrické kytary, `desert` western
  na dvě doby (cval kopyt, „bum-ča“
  basa s kytarou, tremolová kytara, hvízdání, bič a trubka), `math` minimalistický běh
  (metronom, skleněné tóny, souzvuk v přirozeném ladění), `jungle` africký
  bubnový kruh (dvouzvučný zvonec, djembe, chřestidlo, balafon a sbor hlasů).
  Nástroje jsou sdílené
  stavební kameny (`#bassGrowl`, `#bell`, `#sleighBells`, `#trumpet`, `#guitar`, `#twang`, `#whistle`,
  `#pluck`, `#guitarron`, `#glass`, `#woodBar`, `#djembe`, `#gankogui`, `#chant`,
  `#flute`…), aranžmá (`#arrangeIce` a spol.) rozhodují jen o tom, co kdy zazní.
- **Elektrická kytara (`#guitar`) jde celá do jednoho zkreslení a pak do bedny
  (`#cabinet`).** Obojí je podstatné: kdyby se každý tón kvintakordu zkreslil
  zvlášť a sečetl až potom, zněly by spolu jako varhany – ten drásavý souzvuk
  vzniká právě tím, že se struny potkají uvnitř zkreslení. A zkreslená pila je
  bez bedny bzučák; teprve řez pod 85 Hz, zdvih kolem 2 kHz a strop nad 5 kHz
  z ní udělají kytaru v kombu. Křivka aparátu (`AMP_CURVE`) je **nesouměrná**
  kvůli sudým harmonickým (souměrné oříznutí dává čtvercovou vlnu). V ohni
  hraje kytara kvintakordy v synkopované figuře (`FIRE_FIGURE`): dusané akordy
  (`mute`) na jedničku, hned za ni a za třetí dobu, a na čtvrtou dobu běh po
  strunách, který vtáhne do dalšího taktu. Druhá doba zůstává prázdná schválně –
  tam je slyšet riff. Figura je v každém taktu stejná a **nehoustne se stupni** –
  sílu přidává otevírající se filtr a zbytek kapely; na 205 % (level 19) by
  z hustšího chodu byl bzučák. Kytary jsou
  v ohni tři a **každá v jiné poloze**, jinak by si lezly do cesty: doprovod
  drží figuru uprostřed, úder (`#powerStab`) se opře do jedničky o oktávu výš
  a v nejvyšším stupni nad tím jede klesající lick.
- **Nápěv se píše, negeneruje.** Poušť i led stojí na hotových dvojtaktích
  (`WESTERN_PHRASES`, `CAROL_PHRASES`), která `writePhrases` rozepíše do formy
  **A – A – B – závěr**; level si losuje jen to, které dva nápěvy zazní.
  Vzniklo to z pouštní zkušenosti: náhodné tóny dají procházku po stupnici, ne
  téma, které se dá zabroukat – a u koledy to platí dvojnásob, protože koleda
  se pozná právě podle toho, že se dá zpívat. Fráze jsou zapsané v půltónech,
  aby si držely tvar, a do stupnice levelu se převedou až v `writePhrases`.
- **Led je jediné téma v dur a rolničky v něm hrají místo bicích.** Koleda musí
  znít vlídně, takže harmonie jsou ty nejobyčejnější (I–vi–IV–V); moll by z ní
  udělala truchlivou zimu. Dobu nese `#sleighBells` – hrst zvonečků, které
  **nejsou navzájem naladěné** (šum kolem 4 kHz a tři sinusovky v nesoudělných
  poměrech), protože harmonické poměry by z hrsti udělaly jeden zvon. Virbl ani
  hi-hat k nim nepatří: v soupravě by se rolničky ztratily a z koledy by byla
  popová písnička se zvonečky navrch.
- **Rychlé levely se v aranžmá prořídí, ne zrychlí.** Tempo se počítá z rychlosti
  levelu, takže rychlé kolo má stejný počet šestnáctin jako pomalé, ale padají
  skoro dvakrát hustěji – co na 118 % zní jako chod, je na 205 % plocha.
  `#playStep` proto předá aranžmá příznak `fast` (délka kroku pod `FAST_STEP`)
  a to si podle něj zahraje řidčeji. Oheň se v něm **hraje na polovinu**: kopák
  drží půlové doby, basa čtvrtky, riff a lick osminky, kytara zahraje jen akord
  na jedničku a všechno, co takt drobí (dvojkopák, virbl, nájezd, činel, běh po
  strunách), vypadne. Rychlá kola tím vyjdou vzdušná, ne hustší. Ostatní témata
  si `fast` zatím neberou – když bude některé na rychlém levelu drnčet, je to
  první, po čem sáhnout.
- **Džungli drží rytmus, ne harmonie, a hraje ji celý bubnový kruh.** Zvonovou
  linku 3–3–2 (`BELL`) drží kovový zvonec `#gankogui` a opírá se o ni basa
  i balafonové ostinato; **djembe (`#djembe`) ale hrají do mezer mezi jejími
  údery** – teprve z toho vznikne prokládaná polyrytmika, kvůli které to zní
  jako víc bubeníků, a ne jako jeden rytmus posílený nástroji. Kdyby bubny
  padaly na doby zvonce, sesype se to zpátky do pochodu. Zvonec musí zůstat
  slyšet **nad** bubny (v kruhu drží linku on) a balafon (`#woodBar`) zní kromě
  základního tónu i čtvrtou harmonickou a k tomu brní mirlitony na rezonátorech –
  bez nich je z toho koncertní marimba. Harmonie se za celou smyčku skoro nehne;
  celý akord zazní jen ve sboru hlasů (`#chantChord`), kterému o dva takty
  později odpoví píšťala. Když sem saháš, drž rytmus a nepodkládej melodii akordy.
- **Hlasitost motivů se hlídá měřením, ne odhadem.** Motivy se skládají z jiných
  nástrojů, takže se jejich hlasitosti samy od sebe rozejdou a řídké téma pak
  působí jako chyba (přesně tohle se stalo první verzi džungle). `node
  tools/mixtest.mjs` změří RMS i špičku každého tématu a spadne, když je mezi
  nejhlasitějším a nejtišším víc než 6 dB. Špičku drž bezpečně pod jedničkou –
  přes hudbu hrají ještě efekty a nad nimi už žádná rezerva není.
- **Matematické téma je matematické i uvnitř, ne jen názvem.** Stupnice jsou
  souměrné (celotónová a zmenšená se posunem zobrazí samy na sebe), harmonie
  krouží po pravidelných děleních oktávy (velké a malé tercie, kvinty), melodie
  je buňka o **5, 7 nebo 9 krocích** – nesoudělná se šestnácti kroky taktu, takže
  se proti dobám posouvá a smyčka se nikdy nezopakuje stejně. Souzvuk `#ratioChord`
  je laděný podíly celých čísel (`JUST_MINOR`), ne půltóny: proti temperovanému
  zbytku hry je ta čistota slyšet. Když sem saháš, drž se toho – jinak z toho
  bude jen další synthwave.
- **Poušť je western: jízda plání na dvě doby.** Prostředí je Sonora (kaktusy,
  stolové hory, supi), ne Sahara – proto jezdecká hudba, a ne orientální drón.
  Pět dřívějších verzí se neujalo a je z nich vidět, kudy cesta nevede: ležící
  rákosové hlasy (drón a píšťala s vibratem, spíš harmonika než prostředí),
  andaluská kadence s clave a palmas (clave je kubánská a palmas španělské,
  takže z toho byla obecná „latina“), čtyřdobá ranchera s generovanou melodií
  (správné nástroje, ale zněla jako etuda – procházka po stupnici není nápěv),
  norteño s harmonikou (mexické, ale polka; hospoda, ne poušť) a nakonec
  minimalistický šestiosminový spaghetti western (atmosféra ano, ale ke hře
  o běhu chyběl tah). Na čem stojí ten současný:
  - **dvoučtvrťový takt s tečkovaným spádem**: takt sekvenceru drží **dvě
    míry** (kroky 0–7 a 8–15), doba padá na každý čtvrtý krok a nápěvy mají
    šestnáctinu těsně před dobou (kroky 3, 7, 11, 15). Ten hopsavý rytmus je
    to, čím se jízda liší od pochodu; rovné osminky z toho udělají cirkus,
  - **přízvuk na druhé době**: „bum-**ČA**“. Jednička patří base (guitarrón
    střídá základ a kvintu po mírách), na dvojku dopadnou kopyta, odsek
    kytary i virbl. Kdyby se přizvukovala jednička, je z jízdy pochod,
  - **kopyta jsou kokosové skořápky** (`#hooves`), jak se kůň dělá u filmu:
    dutá polokoule zvoní **nesoudělnými** vlastními tóny (1 : 1,58 : 2,9),
    k tomu cvakne dřevo o dřevo a pod tím žuchne dopad do písku. Harmonické
    poměry by z úderu udělaly tón. Váhy jsou tři (`strong` na přízvuk,
    `medium` na jedničku, `soft` mezi doby) a hrají **od prvního pokusu
    v plné sazbě** – nesou celou skladbu, protože poušť nemá ani bicí
    soupravu, ani ozvěnu, která by prostor vyplnila za ně,
  - **rychle**: `bpm` je počet čtvrtek za minutu, a protože je takt
    dvoučtvrťový, znamená 196 zhruba 110–186 celých taktů „bum-ČA“ za minutu
    podle rychlosti levelu. Vyladěno poslechem: poloviční tempo znělo jako
    klusající povoz, o čtvrtinu rychlejší bylo na posledním pouštním levelu
    (190 %) už neposlouchatelné,
  - **žádná ozvěna** (`delay.mix: 0`) – jediné téma ve hře bez ní. V tomhle
    tempu se tóny sypou tak hustě, že se i slabý slapback slil s nápěvem
    v kaši. Prostor drží dusot kopyt, ne dozvuk,
  - **kovbojská harmonie I–♭VII–IV** (`progressions` v půltónech 0–10–5):
    durový základ se sníženou sedmičkou zní jako Amerika. Čistá moll z toho
    dělá Leoneho drama, čistá dur veselou zábavu na náměstí,
  - **prázdné kvinty místo akordů** (`chord: [0, 7, 12, 19]`): bez tercie sedí
    kytara pod durovými i mollovými stupnicemi vyšších levelů a zní jako pláň,
  - **napsané nápěvy, ne generované fráze** (`WESTERN_PHRASES`): dvojtaktí
    s nástupem, vrcholem a závěrem plus společná kadence (`WESTERN_CADENCE`),
    která nechá oktávu ležet přes celý takt. Smyčka má formu A – A – B – závěr
    a level si losuje jen to, které dva nápěvy zazní,
  - **nápěv se za harmonií posouvá kratší cestou** (`chordShift`): kvinta
    nahoru = kvarta dolů, takže melodie zůstane v poloze, ve které se dá
    hvízdat. Posun vždycky nahoru ji na dominantě vystřelil o kvintu výš
    a smyčka uskakovala z rejstříku do rejstříku,
  - **gradace přidává hlasy k nápěvu**: kytara vede vždycky, ve druhém stupni
    ji zdvojí hvízdání (`#whistle`) a ve třetím trubka se sborem – teprve tam
    je z toho ta velká širokoúhlá jízda.
  Když saháš do kytary (`#twang`), nech jí tremolo (houpání hlasitosti kolem
  7 Hz) a krátký pokles tónu na nasazení – bez nich z ní budou varhany.
  U hvízdání (`#whistle`) drž vibrato až na druhou půlku tónu, jinak z toho
  je siréna.
- Akord je v každém tématu jiný (`#stab`, `#swell`, `#powerStab`, `#strum`,
  `#ratioChord`, `#chantChord`), ale všude je to **jediné místo, kde zazní celá harmonie
  naráz** – basa drží jen
  základ a melodie je jednohlas, takže střed mixu by jinak zel prázdnotou.
  Zní jako interpunkce (jednička každého druhého taktu), ne jako podklad – delší
  ležící hlas se tam zkoušel a překážel. Na poušti to obstará tlumené drnknutí
  kytary (`#strum`) mezi doby – a jako jediné ve hře **bez tercie**, protože
  prázdná kvinta sedí pod durovými i mollovými stupnicemi jejích levelů.
- Skladba graduje podle **postupu v levelu** (`setIntensity`), ne podle času.
  Gradace na čas by nebyla slyšet: kostka většinou umře dřív, než by skladba
  stihla nastoupit. Vrstvy nástrojů řídí `TIERS`, otevření filtru a hlasitost
  `cutoff`/`gain` v motivu tématu.
- `setTrack(levelIndex, speedPct, profile)` dostane motiv hotový od prostředí
  (`Game.loadLevel` mu předá `this.theme.audio()`) a z čísla levelu v něm odvodí
  stupnici, harmonii i základní tón – proto mají pole motivu
  aspoň tolik prvků, kolik má téma levelů: čtyři u `ice`/`fire`/`desert`
  a **pět u `math` i `jungle`**. Protože se světy po hře střídají, nestačí
  počet: čísla levelů daného tématu musí dávat **různé zbytky** po dělení tím
  počtem, jinak dva levely sáhnou na tentýž motiv. Hlídá to
  `check_theme_variety()` v generátoru.
  Melodii složí z generátoru náhodných čísel nasazeného na index levelu, takže
  každý level zní jinak, ale pokaždé stejně. Tempo se počítá z rychlosti levelu,
  takže rychlejší kolo hraje rychleji.
- Nastavení motivu do grafu přenáší `#applyTrack` – volá ho `setTrack` i `unlock`.
  Level se totiž načte dřív, než smí vzniknout AudioContext, takže bez volání
  z `unlock()` by první skladba hrála s cizím dozvukem a filtrem.
- `Game.loop` každý snímek nastaví `setMusicOn(state === 'playing')`; stav hudby
  se tak neroztahuje po celém kódu. `setTrack` v `loadLevel` vrací skladbu na
  začátek, takže po smrti hraje znovu od začátku.
- Ztlumení se pamatuje v `localStorage` a je řešené hlasitostí (ne přeskočením
  kódu), aby se i ztlumeně pořád testovaly stejné cesty.

## Vibrace

`js/haptics.js` (třída `Haptics`) přidává ke zvuku haptickou odezvu přes
`navigator.vibrate`. Vazba je stejná jako u zvuku: `Game` říká, co se stalo,
haptika o hře nic neví.

- **Události hlas i vibrace dostávají jedním voláním `Game.feedback(name)`**,
  ne dvěma vedle sebe – jinak by u nové události snadno zůstala jen jedna z nich.
  Jména událostí jsou proto v `Sound.play` a `Haptics.play` stejná.
- Vzory (`PATTERNS`) jsou krátké a jejich délka nese význam: skok je ťuknutí,
  smrt otřes, cíl fanfára. Delší vzory nedávají smysl – motor se rozjíždí
  i doběhává, takže by se slily v hučení a nebylo by poznat, co se stalo.
- Bez podpory (`navigator.vibrate` chybí) se přepínač ani nekreslí, ani nereaguje
  – přepínal by nic. Zapnutí se proto potvrdí vibrací, jinak by na ztlumeném
  telefonu nebylo poznat, že tlačítko zabralo.
- **iOS Vibration API nemá** – na iPhonu ani iPadu (všechny tamní prohlížeče
  běží na WebKitu) se proto nevibruje a ikona se nekreslí. Není to chyba
  a nedá se to obejít ničím, co by umělo vzory: jediná cesta v Safari je haptika
  systémového přepínače, což je jedno ťuknutí bez odstínů.
- Stav se pamatuje v `localStorage` (klíč `cube-runner-haptics`, výchozí zapnuto),
  vypnutí rozehraný vzor rovnou umlčí (`vibrate(0)`).

## PWA / offline

Hra je instalovatelná PWA: `manifest.json`, `icon.svg`, service worker `sw.js`
(registruje se v `scripts.js`). Do cache `CACHE` se při instalaci přednačte seznam
`ASSETS`, aby hra fungovala offline.

Tři pravidla, na kterých v `sw.js` záleží (všechna hlídá `node tools/swtest.mjs`):

- **Network-first, ne cache-first.** Online se vždycky použije aktuální soubor
  a jen se uloží stranou; do cache se sahá, až když síť selže. Cache-first by
  znamenal, že se upravený level po reloadu vůbec nenačte a hraje se stará verze.
- **„Ze sítě“ musí obejít i cache prohlížeče** (`fresh()` = `cache: 'no-cache'`,
  a to i při přednačtení v `install`). Samotné `fetch(req)` smí odpovědět
  z HTTP cache a GitHub Pages posílá `max-age=600` – nasazená verze by se pak
  na mobilu objevila až za deset minut a vypadalo by to, že se změna neprojevila.
  Revalidace nic nestojí: nezměněný soubor server odbaví odpovědí 304.
- **Mažou se jen vlastní cache** (podle prefixu `cube-runner-`). Na stejné doméně
  (třeba GitHub Pages) běží i jiné appky a jejich cache nám nepatří.

**Když přidáš/přejmenuješ soubor** (modul, level, asset), přidej ho do `ASSETS`
**a zvyš verzi** `CACHE` (`cube-runner-vN`) – jinak bude offline chybět. Levely 1–20
se v `ASSETS` generují smyčkou; jiný počet uprav.

## Náhled do README

`docs/preview.png` (obrázek v README) vyrábí `node tools/screenshot.mjs` – je to
skutečný snímek hry z Chromia. Po vizuální změně vykreslování ho přegeneruj.
Další dva obrázky ukazují matematický svět a džungli a vznikají stejně:

```bash
node tools/screenshot.mjs --level 11 --x 62 --out docs/math.png
node tools/screenshot.mjs --level 20 --x 30 --out docs/jungle.png
```

## Konvence

- **Komentáře a texty v UI česky, s plnou diakritikou.** Identifikátory anglicky.
- V importech vždy uváděj příponu **`.js`** (prohlížeč ji u ES modulů vyžaduje).
- Herní stavy: `ready | playing | paused | dying | levelComplete | won`.
  Smrt neznamená konec hry – po `dying` se level rozeběhne znovu a přičte se pokus.
