# Notepad téma a přepínač vzhledu

Datum: 2026-08-10

## Cíl

Přidat druhé vizuální téma, které vypadá jako klasický Windows Notepad (éra
Win95/XP), a přepínač, kterým si ho uživatel volitelně zapne. Součástí je
přestavba CSS tak, aby přidání dalšího tématu později znamenalo jeden soubor
a jeden řádek v registru — ne další sadu úprav napříč `App.css`.

Motivace je čistě estetická: aplikace dnes má jediný tmavý „dossier" vzhled a
nedá se změnit. Zároveň je to příležitost dotáhnout tokenizaci, která je dnes
hotová z devadesáti procent.

## Rozsah

**V rozsahu:** tokenizace zbytku `App.css`, téma `notepad`, registr témat,
přepínač v `Account.tsx`, uložení preference, kontrolní test.

**Mimo rozsah:**

- **Plug-iny a uživatelská témata.** Vědomě vynecháno. Cizí CSS uvnitř
  zero-knowledge aplikace otevírá kanál ven — pravidlo navázané na selektor
  a `background-image: url(https://cizi-host/…)` prozradí, že podmínka platí,
  a s `:has()` a atributovými selektory se dá odkapávat struktura. Obsah
  poznámek to nepřečte, ale je to okno v aplikaci, která jinak tvrdí, že ven
  nejde nic. Kdyby na to jednou došlo, minimální podmínka je tvrdá CSP
  (`img-src 'self' blob:`, `font-src 'self'`) a samostatné rozhodnutí, ne
  přílepek k tomuto specu.
- **Nová funkcionalita v UI.** Status bar nebude počítat `Ln x, Col y`,
  menu strip nebude rozbalovací. Obojí jsou jen přeskinované existující prvky.
- **Světlá varianta stávajícího tématu.** Registr ji umožní přidat později.

## Vizuální jazyk

Výchozím bodem je XP/Luna (`#ECE9D8`), ne šedivější Win95 `#D4D0C8` — je teplejší
a lidem se vybaví okamžitě.

| token | dossier (dnes) | notepad |
|---|---|---|
| `--ground` | `#0E1524` | `#ECE9D8` |
| `--surface` | `#172136` | `#FFFFFF` |
| `--surface-hover` | `#1F2C46` | `#D8E5F5` |
| `--ink` | `#EEF2FA` | `#000000` |
| `--ink-dim` | `#8B98B4` | `#5A5750` |
| `--accent` | `#22B183` | `#000080` |
| `--sky` | `#5B8DEF` | `#316AC5` |
| `--amber` | `#F2C14E` | `#7F6000` |
| `--danger` | `#E0574A` | `#A00000` |
| `--hairline` | `rgba(238,242,250,.09)` | `#ACA899` |
| `--font` | system sans | `Tahoma, "MS Sans Serif", "Segoe UI", sans-serif` |
| `--font-note` | system sans, 16px/1.6 | `"Lucida Console", Consolas, monospace`, 13px/1.35 |
| `--radius` | `8px` | `0` |
| `--link` | `--accent` | `#0000EE`, navštívené `#551A8B` |
| `--desktop` | `#0E1524` | `#3A6EA5` |

Bevely nesou celou hodnotu `box-shadow` a v dossier tématu jsou `none`:

```css
--bevel-out:
  inset -1px -1px 0 #0A0A0A, inset 1px 1px 0 #FFFFFF,
  inset -2px -2px 0 #808080, inset 2px 2px 0 #DFDFDF;
--bevel-in:
  inset 1px 1px 0 #808080, inset -1px -1px 0 #FFFFFF,
  inset 2px 2px 0 #0A0A0A, inset -2px -2px 0 #DFDFDF;
--bevel-press:
  inset 1px 1px 0 #0A0A0A, inset -1px -1px 0 #FFFFFF,
  inset 2px 2px 0 #808080, inset -2px -2px 0 #DFDFDF;
```

Tohle je klíčový mechanismus celého návrhu. Windowsí 3D hrany nemají ve
stávajícím plochém tématu protějšek, a kdyby se řešily samostatnými pravidly,
skončí to dvěma stylesheety, které se během půl roku rozejdou. Jako hodnota
tokenu drží obě témata na jedné sadě komponentových pravidel.

Titulkový pruh: `linear-gradient(90deg, #0A246A 0%, #3A6EA5 60%, #A6CAF0 100%)`,
text bílý.

## Komponenty

**Hlavička → titulkový pruh a menu strip.** `.app-header` dnes obsahuje eyebrow,
wordmark a vpravo odkazy (`Help`, účet, `Log out`). Rozpadne se na dva pruhy:
nahoře navy gradient s ikonkou, názvem a `─ □ ✕` jako čistou dekorací, pod ním
světlý pruh, kde stávající odkazy vypadají jako položky menu s podtrženým
akcelerátorem. Žádná nová funkcionalita — ale právě ten pruh dělá Notepad
Notepadem.

**Seznam → listbox.** Bílé pozadí, zapuštěný rámeček přes `--bevel-in`, řádky bez
mezer a bez zaoblení, aktivní řádek plný `--sky` s bílým textem. Chevrony se
skryjí.

**Detail a editor → textová plocha.** Bílá, zapuštěná, `--font-note` 13px/1.35.
Markdown se dál renderuje, jen nadpisy jsou prostě tučné, odkazy `--link`
podtržené a bloky kódu dostanou `--accent-soft` líc s `--accent-line` rámečkem
(v monospace tématu už je nerozliší písmo).

**Tlačítka.** Jeden styl pro `.save-btn`, `.ghost-btn`, `.auth-btn`, `.copy-btn`:
`--btn-face` líc, `--bevel-out`, výška 23px, min-width 75px, `:active` přepne na
`--bevel-press`. Primární akce dostane 1px tmavý obrys — tak Windows značily
výchozí tlačítko.

**Focus** není glow, ale 1px tečkovaný černý obrys. Je to doslova Win95 focus
rect a zároveň dobře viditelný stav pro klávesnici.

**Tagy** ztratí pilulkový tvar, stanou se hranatými chipy s `--hairline` rámečkem.

**Bannery a modály → dialogy.** `.modal-card` dostane titulkový pruh s `✕` a tvrdý
stín `3px 3px 0 rgba(0,0,0,.35)` bez rozostření. Bannery jsou dialogové lišty
s glyfem vlevo.

**Patička → status bar.** Plná šířka, 1px světlá horní hrana, rozdělená na
zapuštěné buňky.

**Přihlášení a LockScreen.** `.auth-page` dostane klasickou modrou plochu
`--desktop` a karta se stane dialogem s titulkovým pruhem. Efekt je velký a stojí
prakticky nic.

**Scrollbary.** `::-webkit-scrollbar` a `::-webkit-scrollbar-button` zvládnou
čtvercové se šipkami. Firefox spadne na výchozí — přijatelné.

**`BpadMark.tsx`** má barvy zadrátované jako prezentační atributy v SVG. Nechává
se být: barevná 16px ikonka v titulkovém pruhu je dobově správně.

## Co tokeny neunesou

Zhruba tucet pravidel je genuinely strukturálních a bude scoped na
`[data-theme="notepad"]`:

- objeví se falešná okenní tlačítka (`display: none` v ostatních tématech),
- zmizí chevrony v seznamu,
- wordmark ustoupí titulkovému pruhu,
- versálky a `letter-spacing` u eyebrows a tlačítek se zruší (Windows je nemá),
- odsazení se srazí na windowsí metriky.

Je to vědomá výjimka z „vše přes tokeny", ne opomenutí. Ověřeno na náhledu —
bez těchto pravidel téma nesedí.

## Přístupnost

Pravé windowsí šedé `#808080` má na `#ECE9D8` kontrast 3,4:1 a padá pod AA,
proto `--ink-dim` je `#5A5750` (≈6:1). Jediné místo, kde se paleta vědomě
rozchází s originálem.

Černá na bílé v textové ploše je naopak lepší než dnešní stav.

## Mobil

Pravé 23px tlačítko se nedá trefit prstem. Pod `@media (pointer: coarse)` drží
řádky a tlačítka `min-height: 42px` bez ohledu na téma — chrome zůstává,
metriky ne. Výsledek vypadá jako „bachratá Windows"; je to vědomý ústupek
a jediné místo, kde pastiche ustupuje použitelnosti.

Bevely se na malých plochách zmenší na 1px.

## Architektura témat

```
frontend/src/themes/
  contract.css     všechny tokeny jednou na :root s výchozími hodnotami
  dossier.css      :root[data-theme="dossier"] { …hodnoty }
  notepad.css      hodnoty + [data-theme="notepad"] strukturální blok
  registry.ts      seznam témat pro přepínač
  theme.ts         čtení/zápis preference, aplikace na <html>
```

`contract.css` je smlouva: jediný seznam toho, co téma smí nastavit, a jediné
místo, kam se přidává nový token.

`registry.ts` drží pro každé téma `{ id, name, swatch: [ground, surface, accent] }`.
Přidání tématu je pak jeden soubor a jeden řádek — přepínač se doplní sám včetně
náhledového vzorku.

Tokenů bude zhruba 33: jedenáct barevných už existuje, přibude asi dvanáct
barevných (`--accent-soft`, `--accent-line`, `--select`, `--select-ink`,
`--titlebar`, `--titlebar-ink`, `--btn-face`, `--btn-ink`, `--field`,
`--field-border`, `--link`, `--desktop`), šest tvarových (`--radius`,
`--bevel-out`, `--bevel-in`, `--bevel-press`, `--shadow`, `--focus`) a čtyři
typografické (`--font-note`, `--note-size`, `--note-lh`, `--ui-size`) — vedle
už existujícího `--font` a škály `--text-xs/sm/md`. Závazný seznam je vždycky
`contract.css`; tenhle odstavec je jen odhad rozsahu. Držet ho co nejkratší —
každý token je závazek pro všechna budoucí témata.

**Doplněno 2026-08-10** (`2026-08-10-ubuntu-console-tema-design.md`): contract
narostl o dalších pět tokenů na zhruba 38 — `--radius-shell`, `--open`,
`--close`, `--prompt`, `--caret-w`. `--radius-shell` je skutečná díra, kterou
Notepad sám neodhalil: má okno i vnitřek hranatý, takže mu `--radius` stačil.
V `notepad.css` jsou všechny tyto tokeny neutrální (`0`, prázdné řetězce,
`1px`). Zároveň odtud platí pravidlo, kam se dál kreslí hranice: **řetězec je
hodnota, viditelnost je struktura** — `content:` patří do tokenu, přepínání
`display` do strukturálního pravidla.

`--note-size` v dossier tématu musí zůstat 16px. Velikost obsahu poznámky je
dnes vědomě mimo škálu `--text-*` (viz komentář v `:root`) a krok 1 nesmí nic
posunout.

## Preference a start aplikace

Preference je řetězcový enum `'dossier' | 'notepad'`, ne boolean — až přibude
třetí téma, nebude se to přepisovat. Neznámé id musí spadnout na výchozí, aby
novější build nerozbil starší synchronizací preference, které nerozumí.

`preferences.ts` už má přesně ten vzor (klíč v localStorage per uživatel + server
přes `savePreferences`/`getAccount`). Jeden rozdíl proti `sort` a `autolock`:
téma musí platit **i před přihlášením** (Landing, AuthGate, LockScreen,
`/restore`), takže potřebuje navíc globální klíč nezávislý na uživateli. Ten se
přečte v `main.tsx` před prvním renderem a po přihlášení se srovná se serverovou
hodnotou.

Bez toho aplikace při startu blikne tmavě, než se React rozběhne.

`<meta name="theme-color">` je potřeba přepsat za běhu, jinak bude mít mobilní
PWA tmavě modrý pruh nad šedou aplikací.

Přepínač patří do `Account.tsx` vedle auto-locku.

## Testy

`themes.test.ts` přečte `App.css` přes `fs` a spadne, když v něm najde literální
barvu (hex nebo `rgb()`/`rgba()`) nebo `border-radius` s jinou hodnotou než
token. Soubory pod `themes/` jsou z kontroly vyjmuté.

Testy běží v čistém Node bez jsdom, takže čtení souboru je jediné, co je potřeba
— žádná nová závislost.

Dál `theme.test.ts` na čtení a zápis preference, včetně fallbacku u neznámého id.
Vzorem je `preferences.test.ts`.

Vizuální kontrola zůstává ruční.

## Postup

1. Tokenizace: zbylých 31 literálních barev (většina jsou průhledné odstíny
   akcentu → `--accent-soft`, `--accent-line`) a 37 `border-radius` → `--radius`.
   Na konci tohoto kroku musí projít `themes.test.ts`, aplikace vypadá stejně.
2. Rozdělení do `themes/`, `contract.css`, `dossier.css`, registr.
3. `theme.ts`, aplikace atributu v `main.tsx`, `theme-color`.
4. `notepad.css` — hodnoty, pak strukturální blok, pak doladění.
5. Přepínač v `Account.tsx`.

Krok 1 je vlastní refaktoring bez viditelné změny a dá se merge-nout samostatně.

Odhad: tokenizace půl dne, struktura a preference dvě až tři hodiny, samotné
téma zhruba den včetně doladění.

## Rizika

**Trvalá daň.** Od zavedení témat musí každé nové CSS pravidlo jít přes tokeny,
jinak bude v jednom z témat vypadat rozbitě. `themes.test.ts` to hlídá u barev
a rohů, ale ne u odsazení a písem — tam zůstává disciplína.

**Dvojí testování.** Každá vizuální změna se od teď musí zkontrolovat v obou
tématech. To je reálná režie, kterou druhé téma přináší napořád.

## Reference

Interaktivní náhled obou témat (desktop, telefon, přihlašovací dialog, živá
tabulka tokenů): https://claude.ai/code/artifact/39ed850b-4325-4863-aa3f-077b0d7cab1f
