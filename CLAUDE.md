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
node tools/playtest.mjs               # projde všech 15 levelů v Chromiu
node tools/swtest.mjs                 # ověří service worker (offline vs. aktuálnost souborů)
node tools/audiotest.mjs              # ověří, že z hry leze zvuk (analyzátor na výstupu)
```

Nástroje v Node.js potřebují Chromium přes `playwright` (`npm i -D playwright`) –
proto nejsou součástí hry, jen vývoje. `node tools/playtest.mjs --headed` ukáže,
co se v prohlížeči děje. Generátor běží na čistém Pythonu 3, bez balíčků.

## Architektura a klíčový princip

**Vazba jde jen jedním směrem: `Game` řídí, entity se starají samy o sebe.**

- `Game` (`js/game.js`) orchestruje hru: herní smyčka, stavy, kamera, kolize
  s překážkami, mince, skóre, vykreslení prostředí (bloky, hroty, portály, HUD)
  a rozhodnutí, **kam** se entita vykreslí.
- Entity (`js/entities/`) **nesmí ovládat hru**. Nemění skóre ani stav hry.
  Do světa jen *nahlížejí* kvůli vlastnímu pohybu (`this.game.level` kvůli
  blokům). `Player` si řeší svoji fyziku a náraz do zdi jen ohlásí příznakem
  `crashed` – že to znamená smrt, rozhoduje `Game`.
- `Entity` (`js/entities/entity.js`) drží startovní pozici, `reset()` a čas
  `animPhase`. `Entity.draw(ctx, cx, cy, size)` je abstraktní; `Player`/`Saw`/
  `Orbiter` ji implementují a **nesahají na `this.game`** – dostanou kontext
  i pozici parametrem. Tuhle nezávislost `draw` na hře zachovej.
- **Svět kreslí `Game.drawWorld`, HUD a překryv až po něm.** Horká témata
  (`Game.hazy` – ohnivé a pouštní) si `drawWorld` nechají vykreslit na pomocné
  plátno a přenesou ho po pruzích rozvlněné horkým vzduchem (`drawHeatHaze`) –
  texty se tím vlnit nesmí.
  Ozdoby závislé na místě (námraza, fáze plamenů, tvar kaktusu) počítej
  z `noise(x, y)`, ne z `Math.random()`, jinak budou při posunu kamery
  poskakovat.
- **Matematické symboly se rýsují čarami (`mathGlyph`), ne písmem.** Znaky jako
  ∑ nebo ∮ nemá každé zařízení ve fontu a místo symbolu by se ukázal prázdný
  obdélníček; rýsovaný tah navíc sedí k papíru v pozadí. Obrazce v pozadí
  (`drawMathFigures`) drží malý parallax a bledou barvu – pozadí má být hloubka,
  ne rozptýlení, překážky musí zůstat čitelné na první pohled.
- **Pozadí nesmí zaplnit propast.** Díra v podlaze je smrtelná, takže pod
  úrovní země patří tma – pouštní duny proto končí u horní hrany podlahy
  a zbytek plátna `drawDesert` přetře natmavo.
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
`scripts.js` (bootstrap – canvas, seznam levelů, ovládání, spuštění).

Instance hry visí na `window.cubeRunner` – sahá po ní ladění v konzoli i nástroje
(`playtest.mjs`, `screenshot.mjs`, `audiotest.mjs`), takže ji tam nech.

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
- místo čísla jde předat `{speed, theme}`; téma `'ice'` kreslí hroty jako modré
  krápníky, bloky jako namrzlé a nechá v pozadí padat sníh, téma `'fire'` mění
  hroty ze země v pohyblivé plameny, hroty ze stropu v malé sopky, pod mapu dá
  lávovou řeku a celý obraz rozvlní horkým vzduchem, téma `'desert'` staví místo
  hrotů ze země kaktusy, místo hrotů ze stropu poletující supy, bloky mění
  v pískovec, do pozadí dá duny se sluncem v prachu a taky se vlní horkem,
  téma `'math'` mění hroty v operátory Δ (ze země) a ∇ (ze stropu), bloky
  v dlaždice rýsovacího papíru se symbolem, minci v ražbu s π, prstenec
  v křivkový integrál (∮ – obíhající šipka ukazuje orientaci) a do pozadí dá
  rýsovací papír s geometrickými obrazci a vztahy mezi nimi.
  Téma navíc určuje **motiv hudby** (`THEMES` v `audio.js`) – na fyziku ani
  hitboxy ale nesahá. Drží je `LEVEL_THEMES` v generátoru.

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

**Levely 11–15 (matematický svět) jsou druhá půlka hry a o stupeň těžší** – běží
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

Ručně upravenou mapu ale generátor **nepřepíše**: v hlavičce každého souboru je
otisk mapy a když nesedí na obsah, soubor se přeskočí (`--force` to vynutí).
Takový level pak neodpovídá plánu – ověřuj ho přes
`python3 tools/gen_levels.py --verify js/levels/levelX.js`.

Před zápisem každý level ověří **simulací stejného pohybového modelu**: prohledáním
najde, jestli existuje posloupnost skoků, která dojde do cíle. Kontroluje se na
třech snímkových frekvencích a navíc s hrubým rastrem stisků (30 Hz) jako test
hratelnosti. Když level neprojde, skript skončí chybou a nic nezapíše.
Součástí stavu je i seznam využitých prstenců, ale **prstence, které kostka
minula, se ze stavu zahazují** – bez toho si prohledávání pamatuje zvlášť každou
kombinaci a u levelu s několika prstenci se ověření protáhne z desítek sekund
na minuty.

`tools/playtest.mjs` totéž ověří proti opravdovému kódu hry: nechá si od generátoru
spočítat čísla snímků, ve kterých se má skočit (`--paths`), a odehraje všech 15 levelů
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

## Zvuk

`js/audio.js` (třída `Sound`) skládá efekty i hudbu za běhu přes Web Audio API –
**žádné zvukové soubory**, ať zůstane hra bez závislostí a repozitář bez binárek.
Vazba je stejná jako u entit: `Game` zvuku říká, co se stalo (`play('jump')`)
a jestli má hrát hudba (`setMusicOn`), zvuk o hře nic neví.

- AudioContext smí vzniknout **až po interakci uživatele** – proto se `unlock()`
  volá z `handleAction`. Do té doby je `sound.ctx` null a `play()` nic nedělá.
- Hudba je krokový sekvencer plánovaný dopředu (`LOOKAHEAD`) na vlastním časovači,
  ne v herní smyčce – jinak by při propadu snímků vynechávala.
- **Každé téma prostředí má vlastní motiv** – drží ho `THEMES` (stupnice,
  harmonie, základní tóny, tempo, akord, filtr, dozvuk) a k němu dvojice
  „aranžmá + styl melodie“: beztémové levely temné synthwave, `ice` pomalé
  zvonky s praskáním ledu nad ležícím spodkem, `fire` dvojkopák s chraplavou
  basou a opakovaným riffem, `desert` mexické mariachi (guitarrón, odsekávaná
  kytara, trubky v terciích, claves a palmas), `math` minimalistický běh
  (metronom, skleněné tóny, souzvuk v přirozeném ladění). Nástroje jsou sdílené
  stavební kameny (`#bassGrowl`, `#bell`, `#trumpet`, `#pluck`, `#guitarron`,
  `#glass`…), aranžmá (`#arrangeIce` a spol.) rozhodují jen o tom, co kdy zazní.
- **Matematické téma je matematické i uvnitř, ne jen názvem.** Stupnice jsou
  souměrné (celotónová a zmenšená se posunem zobrazí samy na sebe), harmonie
  krouží po pravidelných děleních oktávy (velké a malé tercie, kvinty), melodie
  je buňka o **5, 7 nebo 9 krocích** – nesoudělná se šestnácti kroky taktu, takže
  se proti dobám posouvá a smyčka se nikdy nezopakuje stejně. Souzvuk `#ratioChord`
  je laděný podíly celých čísel (`JUST_MINOR`), ne půltóny: proti temperovanému
  zbytku hry je ta čistota slyšet. Když sem saháš, drž se toho – jinak z toho
  bude jen další synthwave.
- **Ležící rákosové hlasy zněly jako harmonika, ne jako prostředí.** Pouštní
  téma je na nich stálo (drón + píšťala s vibratem a portamentem) a vybočovalo;
  proto je nahradily drnkané a žesťové nástroje. Když do trubky (`#trumpet`)
  saháš, drž vibrato až na druhou půlku tónu a filtr veď obálkou – jinak se
  ta harmonika vrátí.
- Akord je v každém tématu jiný (`#stab`, `#swell`, `#powerStab`, `#strum`,
  `#ratioChord`), ale všude je to **jediné místo, kde zazní celá harmonie
  naráz** – basa drží jen
  základ a melodie je jednohlas, takže střed mixu by jinak zel prázdnotou.
  Zní jako interpunkce (jednička každého druhého taktu), ne jako podklad – delší
  ležící hlas se tam zkoušel a překážel. Výjimkou je pouštní kytara: ta odsekává
  akord na **lehkou** dobu proti guitarrónu na těžké („ta-dá“) a její kvalitu
  (mollová/durová) řídí stupeň harmonie, jinak by andaluská kadence nebyla poznat.
- Skladba graduje podle **postupu v levelu** (`setIntensity`), ne podle času.
  Gradace na čas by nebyla slyšet: kostka většinou umře dřív, než by skladba
  stihla nastoupit. Vrstvy nástrojů řídí `TIERS`, otevření filtru a hlasitost
  `cutoff`/`gain` v motivu tématu.
- `setTrack(levelIndex, speedPct, theme)` vybere motiv podle tématu a z čísla
  levelu v něm odvodí stupnici, harmonii i základní tón – proto mají pole motivu
  tolik prvků, kolik má téma levelů: čtyři u `ice`/`fire`/`desert` (3 a 6, 8 a 10)
  a **pět u `math`**, protože matematických levelů je pět (11–15) a jinak by dva
  z nich sáhly na totéž.
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
**a zvyš verzi** `CACHE` (`cube-runner-vN`) – jinak bude offline chybět. Levely 1–15
se v `ASSETS` generují smyčkou; jiný počet uprav.

## Náhled do README

`docs/preview.png` (obrázek v README) vyrábí `node tools/screenshot.mjs` – je to
skutečný snímek hry z Chromia. Po vizuální změně vykreslování ho přegeneruj.
Druhý obrázek `docs/math.png` ukazuje matematický svět a vzniká stejně:

```bash
node tools/screenshot.mjs --level 11 --x 62 --out docs/math.png
```

## Konvence

- **Komentáře a texty v UI česky, s plnou diakritikou.** Identifikátory anglicky.
- V importech vždy uváděj příponu **`.js`** (prohlížeč ji u ES modulů vyžaduje).
- Herní stavy: `ready | playing | paused | dying | levelComplete | won`.
  Smrt neznamená konec hry – po `dying` se level rozeběhne znovu a přičte se pokus.
