# Desktop: dvousloupcové rozvržení s kompozérem vpravo

## Kontext

Na desktopu (breakpoint `min-width: 860px`) má aplikace dvoupanelové rozvržení
(`NotesLayout.tsx`): vlevo `list-pane` s komponentou `Home`, vpravo `detail-pane`
s routovaným `Outlet` (`NoteDetail`). `Home` dnes renderuje nahoře editor pro nový
příspěvek (`Editor`), pod ním sekci Recent Entries (přepínač Created/Modified),
lištu tagů (`TagBar`), vyhledávání a seznam příspěvků. Desktop navíc automaticky
otevírá horní příspěvek, takže pravý panel prakticky vždy zobrazuje nějaký
příspěvek.

Cílem je na desktopu přesunout formulář pro nový příspěvek do pravého sloupce a
levý sloupec začít rovnou seznamem, aniž by kompozér zabíral zbytečné místo při
čtení nebo editaci příspěvku.

## Rozsah

- **Pouze desktop** (`min-width: 860px`, stávající dvoupanelový breakpoint).
- **Mobil / úzké rozvržení zůstává beze změny**: jednopanelový seznam s editorem
  připnutým nahoře přesně jako dnes.

## Návrh

### 1. Obsah sloupců

**Levý sloupec (`list-pane` → `Home`):** editor se z vršku odstraní. Sloupec
začíná přímo sekcí **Recent Entries** (nadpis + přepínač řazení Created/Modified),
následuje **lišta tagů**, **vyhledávání** a **seznam příspěvků**. Jiná změna v
`Home` není — tento blok už v tomto pořadí je, jakmile zmizí editor.

**Pravý sloupec (`detail-pane`):** dostane trvalý **kompozér nového příspěvku**
připnutý nad detailem příspěvku (routovaný `Outlet`). Struktura shora dolů:

1. Sbalená lišta kompozéru — útlý prvek `+ New entry…`.
2. Detail otevřeného příspěvku (nebo placeholder „vyber příspěvek“, když žádný
   není).

### 2. Chování kompozéru

- **Sbalený** ve výchozím stavu: jednořádková lišta. Kliknutí ji **rozbalí** na
  plný `Editor` (textarea, tagy, write/preview, File it).
- **Pouze explicitní přepínání:** jakmile je rozbalený, zůstává otevřený i při
  klikání okolo a přepínání příspěvků. Sbalí ho jen **Cancel** nebo **File it**.
  Kliknutí mimo ho nesbalí.
- **Po File it:** příspěvek se vytvoří, lišta se **sbalí** a detail pod ní se
  **přepne na právě vytvořený příspěvek** (je to nový horní záznam). Levý seznam
  se obnoví přes stávající událost `bpad:notes-mutated`.
- **Hraniční případ:** když účet nemá **žádné příspěvky**, kompozér startuje
  **rozbalený** — není co číst, ušetříme kliknutí.

Editace příspěvku (inline `Edit` v detailu) je na kompozéru nezávislá a beze změny.

### 3. Architektura

- Nová komponenta **`NewEntryComposer.tsx`** — drží stav sbaleno/rozbaleno a
  renderuje `Editor`, když je rozbaleno. Po odeslání volá `createNote(...)`, pak
  `navigate('/notes/{newId}')` a sbalí se. Protože se `Editor` při sbalení
  odmountuje, resetuje se přirozeně (zde není potřeba `resetOnSuccess`).
- **`NotesLayout.tsx`** renderuje `<NewEntryComposer/>` nad `<Outlet/>` v pravém
  panelu, **jen když je `useWideLayout()` true** a účet není v režimu
  offline-read-only.
- **`Home.tsx`** renderuje svůj horní `Editor` **jen když `!wide`** (mobil). Jeho
  stávající `handleCreate` zůstává pro mobilní cestu. Vytváření na desktopu žije
  kompletně v kompozéru.
- Kompozér sedí nad `Outlet`, takže **přežívá navigaci mezi příspěvky** — stav
  rozbalení zůstane při proklikávání příspěvků.
- **CSS:** nové styly pro sbalenou lištu; blok `min-width: 860px` dostane umístění
  kompozéru. Mobilní pravidla se nemění.

### 4. Testování

`NewEntryComposer` je testovatelný v čistém Node (suita nemá jsdom): přepnutí
sbaleno→rozbaleno, Cancel sbalí, odeslání zavolá `createNote` + naviguje + sbalí,
a při nula příspěvcích startuje rozbaleno — se stubováním `createNote`/navigate
jako v `api.test.ts`.
