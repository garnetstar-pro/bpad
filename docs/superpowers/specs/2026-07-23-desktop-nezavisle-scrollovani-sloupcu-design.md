# Desktop: nezávislé scrollování sloupců (app-shell)

## Kontext

Po přesunu kompozéru do pravého sloupce má desktop dvoupanelové rozvržení, ale
celá stránka `.app` scrolluje jako jeden dlouhý dokument a grid má
`align-items: start`. Při 250 poznámkách je levý seznam velmi vysoký; když
uživatel odscrolluje dolů a klikne na poznámku, detail se aktualizuje nahoře nad
viewportem — uživatel vůbec nepozná, že se detail změnil.

## Rozsah

- **Pouze desktop** (`min-width: 860px`) **a pouze na trasách poznámek**
  (`/`, `/notes/:id`), scopováno přes stávající vzor `.app:has(.notes-layout)`.
  Account / Features / Capture si nechávají normální scroll stránky.
- **Mobil beze změny**: jednopanelový layout, scroll celé stránky jako dnes.

## Návrh

### 1. Připnutý levý sloupec (`App.css`, desktop)

- Stránka scrolluje normálně (žádný app-shell zámek výšky).
- `.list-pane` je `position: sticky; top: 0; max-height: 100dvh` a zároveň
  flex-sloupec (`display: flex; flex-direction: column; overflow: hidden`).
  Zůstává tak **připnutý ve viewportu** a nezmizí, i když je pravý sloupec
  dlouhý. Hlavička seznamu (sekce recent + řazení, lišta tagů, vyhledávání) má
  přirozenou výšku a **zůstává připnutá**, zatímco `.entries` dostane
  `flex: 1; min-height: 0; overflow-y: auto` a scrolluje samostatně.

### 2. Pravý sloupec plyne se stránkou (nescrolluje sám)

- `.detail-pane` je běžný blok bez vlastního scrollu — kompozér i detail plynou
  v toku stránky. Dlouhá poznámka tedy scrolluje **stránkou**, ne vlastní
  lištou pravého sloupce, a levý seznam přitom zůstává připnutý.

### 3. Reset scrollu při přepnutí poznámky

Protože detail plyne se stránkou, při přepnutí poznámky se na začátek resetuje
**okno** (`window.scrollTo`) — jinak by dlouhá odscrollovaná poznámka nechala
další otevřenou uprostřed. Malý efekt v `NoteDetail` navázaný na `id`.

### 4. Testování

Změna je převážně CSS; reset scrollu je vázaný na DOM (suita nemá jsdom), takže
chování ověříme živě v prohlížeči (stejně jako předchozí iterace). Žádná nová
čistá logika k jednotkovému testu.
