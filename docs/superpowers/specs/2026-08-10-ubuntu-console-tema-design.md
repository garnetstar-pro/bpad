# Téma Ubuntu console

Datum: 2026-08-10

## Cíl

Třetí vizuální téma: GNOME Terminal na Ubuntu ve výchozím profilu. Aubergine
pozadí, Ubuntu Mono, Tango paleta, invertovaný výběr.

Tenhle spec **navazuje na `2026-08-10-notepad-tema-design.md`** a nepopisuje
znovu architekturu témat, registr, uložení preference ani hlídací test. Vše
odtud platí beze změny. Zde je jen to, co je pro tohle téma vlastní, plus
dvě doplnění contractu, která si vyžádalo.

Téma se dá postavit až po krocích 1–3 z Notepadového specu (tokenizace,
`themes/`, `theme.ts`). Na samotném Notepadu nezávisí — pořadí těch dvou témat
je libovolné.

## Rozsah

Stejné rozhodnutí jako u Notepadu: **přebarvit, layout nechat.** Dvousloupcový
layout, hlavička, composer a patička zůstávají, mění se hodnoty a hrstka
strukturálních pravidel.

Zvažovány a zamítnuty dvě radikálnější varianty: TUI panely kreslené znaky
`─│┌┐` a plná iluze shellu se záznamem sezení. Obojí vypadá lákavě, ale druhá
varianta fakticky mění aplikaci — dvousloupcový layout, vyhledávání ani tlačítka
v záznamu sezení nedávají smysl — a první nafukuje rozpočet strukturálních
pravidel bez úměrného zisku.

## Paleta

Výchozí profil GNOME Terminalu na Ubuntu plus paleta Tango, kterou Ubuntu
používá pro ANSI barvy.

| token | hodnota | zdroj |
|---|---|---|
| `--ground` | `#300A24` | výchozí pozadí terminálu |
| `--surface` | `#300A24` | **shodné s ground** — terminál nemá karty |
| `--surface-hover` | `#45153A` | |
| `--ink` | `#FFFFFF` | výchozí foreground |
| `--ink-dim` | `#B9A7B2` | |
| `--accent` | `#F07746` | zesvětlená Ubuntu oranžová, viz níže |
| `--sky` | `#729FCF` | Tango bright blue |
| `--amber` | `#FCE94F` | Tango bright yellow |
| `--danger` | `#EF2929` | Tango bright red |
| `--hairline` | `rgba(255,255,255,.15)` | |
| `--select` | `#FFFFFF` | invertované video |
| `--select-ink` | `#300A24` | |
| `--titlebar` | `#303030` | Yaru headerbar |
| `--titlebar-ink` | `#FFFFFF` | |
| `--link` | `#729FCF` | |
| `--desktop` | `#2C001E` | Ubuntu dark aubergine |
| `--radius` | `0` | textová plocha je hranatá |
| `--radius-shell` | `12px` | okno GNOME je zaoblené |
| bevely | `none` | |

`--surface` shodné s `--ground` je vědomé: v terminálu není nic vyvýšeného.
Seznam i detail se odliší jen vlasovými linkami a odsazením.

Invertovaný výběr je pro terminál nejcharakterističtější prvek a stojí přesně
dvě hodnoty. Žádné nové pravidlo.

## Přístupnost

Pravá Ubuntu oranžová `#E95420` má na `#300A24` kontrast 4,4:1 a těsně padá pod
AA pro drobný text, kterým akcent v aplikaci je (eyebrow, aktivní řazení, hover
tlačítek). `--accent` je proto `#F07746` (≈5,4:1).

Je to stejný typ ústupku jako `--ink-dim: #5A5750` u Notepadu. Každé téma se od
předlohy odchyluje právě na jednom místě a vždy ze stejného důvodu.

## Písmo

`--font` i `--font-note` jsou `"Ubuntu Mono", ui-monospace, "DejaVu Sans Mono",
"Liberation Mono", monospace`. V terminálu je monospace i UI, nejen obsah
poznámky.

Ubuntu Mono není nikde systémově a musí se přibalit. Latin subset ve woff2 vyjde
zhruba na 30 kB.

**Font se přibalí, ale nedá se do `globPatterns` service workeru** a nasadí se
s `font-display: swap`. Stáhne si ho tedy jen ten, kdo si téma zapne. Je to
přesně ten samý kompromis, jaký už projekt udělal u obrázku ve welcome note, a
ze stejného důvodu: nemá smysl posílat 30 kB každému za soubor, který většina
nikdy nepotřebuje.

Důsledek, se kterým je potřeba počítat: při prvním zapnutí tématu offline se
sáhne po fallbacku. To je v pořádku — `DejaVu Sans Mono` je druhé výchozí písmo
GNOME Terminalu, takže na Ubuntu vypadá téma správně i bez staženého fontu.

Licence je Ubuntu Font Licence 1.0, která redistribuci povoluje. Do repa patří
i text licence vedle souboru s fontem; UFL je samostatné dílo vedle AGPL kódu,
nic se nekříží.

Velikosti: `--ui-size` 15px, `--note-size` 16px, `--note-lh` 1.5. Ubuntu Mono je
úzké, při 14px už se špatně čte.

## Komponenty

**Tlačítka** nejsou tlačítka, ale `[ Edit ]`: průhledné pozadí, akcentový text,
hranatá závorka z `content:` tokenu. Hover invertuje na plný akcent s barvou
pozadí.

**Vyhledávání** ztratí lupu a dostane `$` v akcentové barvě.

**Kurzor** v editoru je blikající blok, ne vlasová čárka — `--caret-w: 0.55em`.

**Titulkový pruh** je Yaru headerbar: tmavě šedý, název `jan@bpad: ~/notes`
vycentrovaný, vlevo `+` (nová záložka), vpravo `☰` a `✕` jako kulatá tlačítka.
Dekorace, stejně jako u Notepadu.

**Seznam** je hustý výpis bez mezer mezi řádky, vybraný řádek invertovaný přes
celou šířku.

**Tagy** jsou hranaté, bez pilulkového tvaru.

**Scrollbary** jsou tenké překryvné, jak je má GNOME — užší než výchozí a
poloprůhledné světlé.

**Přihlašovací dialog** stojí na `--desktop` `#2C001E` a je to okno terminálu se
zaoblenými rohy.

## Strukturální pravidla

Šest pravidel scoped na `[data-theme="ubuntu"]`, proti zhruba tuctu u Notepadu:

1. objeví se okenní tlačítka,
2. zmizí chevrony v seznamu,
3. zmizí lupa u vyhledávání a upraví se odsazení pro `$`,
4. titulkový pruh centruje název,
5. zmizí wordmark,
6. zruší se `letter-spacing` u versálkových popisků (monospace s prostrkáním
   vypadá špatně).

Terminál je k „pouhým hodnotám" blíž než Win32 okno — nemá karty, bevely ani
chrome tlačítek k reprodukci.

## Doplnění contractu

Tohle téma si vyžádalo pět nových tokenů. Notepadový spec je nutné o ně doplnit,
protože `contract.css` je společný.

| token | dossier | notepad | ubuntu |
|---|---|---|---|
| `--radius-shell` | `8px` | `0` | `12px` |
| `--open` | `""` | `""` | `"[ "` |
| `--close` | `""` | `""` | `" ]"` |
| `--prompt` | `""` | `""` | `"$"` |
| `--caret-w` | `1px` | `1px` | `0.55em` |

`--radius-shell` je skutečná díra v contractu, kterou třetí téma odhalilo:
Ubuntu okno je zaoblené 12px, ale textová plocha uvnitř hranatá, což `--radius`
sám vyjádřit neumí.

Zbylé čtyři jsou hranice mezi tokenem a pravidlem, kterou stojí za to napsat
explicitně, protože se bude opakovat u každého dalšího tématu:

> **Řetězec je hodnota, viditelnost je struktura.** `content:` patří do tokenu,
> přepínání `display` do strukturálního pravidla.

Bez toho pravidla contract nafoukne na padesát položek a přestane být čitelný.

Celkem tedy zhruba 38 tokenů místo 33. Závazný seznam zůstává `contract.css`.

## Mobil

Beze změny proti Notepadu: pod `@media (pointer: coarse)` drží řádky a tlačítka
`min-height: 42px`. U terminálu to bolí míň — hustý výpis je stejně vertikálně
úspornější než windowsí listbox.

## Postup

1. Přibalit Ubuntu Mono woff2 + licenci, `@font-face` mimo `globPatterns`.
2. Doplnit `contract.css` o pět tokenů, nastavit je v `dossier.css`
   a `notepad.css` na neutrální hodnoty.
3. `themes/ubuntu.css` — hodnoty, pak šest strukturálních pravidel.
4. Řádek v `registry.ts`.

Odhad: půl dne včetně doladění. Krok 2 je drobná změna existujících témat, ale
musí projít před krokem 3, jinak `--open` a spol. nebudou nikde definované
a `content: var(--open)` propadne na prázdno v dossier tématu — což je sice
shodou okolností správný výsledek, ale z nedefinovaného chování.

## Rizika

**Fallback na první zapnutí.** Než se font stáhne, běží téma na systémovém mono.
Na Ubuntu je výsledek správný, na macOS a Windows to bude SF Mono nebo Consolas
— rozpoznatelné jako terminál, ale ne jako Ubuntu.

**Monospace všude.** UI v neproporcionálním písmu je čitelné hůř než v Tahomě
nebo systémovém sans. Je to cena za autenticitu a týká se to jen tohoto tématu,
ale u dlouhých názvů poznámek v úzkém sloupci to bude znát.

## Reference

Interaktivní náhled všech tří témat:
https://claude.ai/code/artifact/39ed850b-4325-4863-aa3f-077b0d7cab1f
