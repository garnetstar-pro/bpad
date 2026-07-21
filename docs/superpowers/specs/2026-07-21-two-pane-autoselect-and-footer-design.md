# Dvousloupcový layout: auto-výběr horní poznámky a patička detailu

> Navazuje na `2026-07-13-two-pane-notes-layout.md`. Mění chování detail panelu
> ve dvousloupcovém zobrazení. Frontend-only, žádné změny v `api/`.

## Cíl

1. **Auto-výběr:** Na desktopu, když v detail panelu není otevřená konkrétní
   poznámka, automaticky otevřít poznámku úplně nahoře v seznamu. Na mobilu se
   nic nemění — `/` dál zobrazuje seznam.
2. **Patička:** Pod kartou detailu přidat patičku (jen na desktopu) s metadaty
   poznámky a statickou aplikační patičkou.

## 1. Auto-výběr horní poznámky

**Chování.** Ve dvousloupcovém zobrazení (`min-width: 860px`) platí: jakmile
není vybraná platná poznámka — URL je `/`, nebo poznámka v URL už neexistuje
(byla smazaná) — přesměruj na `/notes/{id}`, kde `{id}` je první poznámka
v aktuálně zobrazeném a seřazeném seznamu (`filtered[0]`). Na mobilu se
nepřesměrovává: `/` zůstává na seznamu.

**Umístění.** Logika žije v `Home` (list panel), který je ve dvousloupcovém
layoutu namontovaný pořád, takže má aktuální seřazený/filtrovaný seznam i po
mutacích. Efekt:

```tsx
const wide = useWideLayout()
useEffect(() => {
  if (!wide || loading || filtered.length === 0) return
  // Platný výběr necháme být; jinak (nic vybráno, nebo vybraná poznámka
  // zmizela) otevřeme horní. Po smazání otevřené poznámky se tím sám doplní
  // další horní — i po asynchronním refetchi, protože se efekt přehodnotí.
  const selectionValid = activeId != null && notes.some((n) => n.id === activeId)
  if (selectionValid) return
  navigate(`/notes/${filtered[0].id}`, { replace: true })
}, [wide, loading, activeId, notes, filtered[0]?.id, navigate])
```

- Změna URL dává zadarmo: zvýraznění řádku (stávající `useMatch`), vykreslení
  přes stávající `NoteDetail`, a samo-zahojení race po smazání (guard
  `selectionValid` přesměruje znovu, když vybraná poznámka zmizí ze seznamu).
- `replace: true` — auto-výběr nezakládá krok v historii.
- Prázdný trezor (`filtered.length === 0`) → žádné přesměrování, v panelu zůstává
  `DetailPlaceholder`.

**Nový hook `useWideLayout()`** v `device.ts` — reaktivní na resize (na rozdíl
od stávajících jednorázových `canAutofocus`/`isTouchPrimary`):

```ts
export function useWideLayout(): boolean {
  const q = '(min-width: 860px)'
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(q).matches,
  )
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return !!wide
}
```

(Import `useState`/`useEffect` v `device.ts`; hook je React, zbytek souboru
zůstává React-free — to je v pořádku, ostatní moduly importují jen čisté funkce.)

## 2. Patička detailu

Nová komponenta `DetailFooter` (props: `note: Note`), vykreslená v `NoteDetail`
za `</article>` v režimu čtení (ne při editaci). **Jen na desktopu** — skrytá
CSS pod 860 px (`.detail-footer { display: none }`, zobrazení až v media query).

Dvě části oddělené horní linkou (`--hairline`), text `--ink-dim`:

- **Metadata poznámky:** „Created {date}" a „Updated {date}". „Updated" jen když
  `updated_at !== created_at` (jinde v UI se `updated_at` nezobrazuje). Datum
  formátováno `new Date(...).toLocaleString()`.
- **Aplikační patička:** odkaz na Features (`/features`), tagline
  „End-to-end encrypted." a „© 2026 bpad". Bez čísla verze.

**i18n (`en.ts`).** Nové klíče:
- `notes.metaCreated: 'Created {date}'`, `notes.metaUpdated: 'Updated {date}'`
  (interpolace `{date}` už `translate()` podporuje).
- `footer.features: 'Features'`, `footer.tagline: 'End-to-end encrypted.'`,
  `footer.copyright: '© 2026 bpad'`.

## Testy

- `useWideLayout` a auto-výběr jsou závislé na `matchMedia`/routeru → ověří se
  runtime driverem (Playwright), ne unit testem (žádné jsdom).
- `DetailFooter`: čistá logika „ukázat Updated jen když se liší" se dá otestovat
  jednotkově, pokud ji vytáhnu do čisté funkce; jinak runtime.
- Existující sada (`vitest run`) musí projít beze změn počtu.

## Mimo rozsah

- Patička na mobilu, patička u prázdného trezoru (placeholder).
- Sledování živého hledání/filtru auto-výběrem (vybírá se jen při chybějícím
  výběru, ne při každé změně hledání).
- Číslo verze v patičce.
