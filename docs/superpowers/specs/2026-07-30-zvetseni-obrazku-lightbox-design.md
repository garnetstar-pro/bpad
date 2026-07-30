# Zvětšení obrázku při prohlížení (lightbox) — návrh

**Datum:** 2026-07-30
**Stav:** návrh odsouhlasen, čeká na implementační plán
**Navazuje na:** `2026-07-25-obrazky-vystrizky-design.md` (inline obrázky, `bpad-img:` schéma),
`2026-07-25-pridat-obrazek-tlacitko-design.md` (vkládání přes file input)

## Cíl

Umožnit **zvětšení obrázku při prohlížení poznámky**. Dnes je obrázek v textu
omezený na `max-width: 100%`, takže v úzkém sloupci (dvousloupcový desktop
layout, mobil) je z výstřižku často nečitelná miniatura. Klik/tap ho otevře
přes celou obrazovku.

## Rozsah

| Rozhodnutí | Volba |
|---|---|
| Interakce | Lightbox přes celou obrazovku |
| Zoom uvnitř lightboxu | **Ne** — jen „co největší, ať se vejde" |
| Listování mezi obrázky | **Ne** — lightbox zná jen ten otevřený |
| Kde | Detail poznámky **i** náhled v editoru (sdílená komponenta) |
| Tlačítko Zpět na mobilu | Zavře lightbox, nechá uživatele v poznámce |

**Bez backendu, API, krypta a blob logiky.** Lightbox použije to samé `src`,
které už je načtené v textu — žádné nové `GET /api/images/{id}/url`, žádná další
SAS. Šifrování obrázků (fáze 2) se tímto nijak nedotýká.

**Mimo rozsah:** pinch/scroll zoom uvnitř lightboxu, listování mezi obrázky
v poznámce, stahování originálu, obrázky v backupu.

## Návrh

### Rozdělení do komponent

**`frontend/src/ImageLightbox.tsx`** (nový soubor) — samotný overlay. Zná jen
`src`, `alt` a `onClose`; nic neví o `bpad-img:` schématu ani o poznámkách.
Díky tomu se dá renderovat i otestovat samostatně.

**`ZoomableImage`** v `markdown.tsx` — malý wrapper, který drží `open` stav,
vykreslí obrázek zabalený v tlačítku a při `open` k němu přidá `<ImageLightbox>`.

Obě větve v `markdownComponents.img` půjdou přes wrapper:

- `bpad-img:ID` → `BpadImage` resolvuje SAS URL jako dnes a výsledný `<img>`
  vykreslí přes `ZoomableImage`. Stavy `loading` / `failed` zůstávají beze změny
  a **nejsou klikatelné** — zvětšovat není co.
- běžné `http(s)` obrázky → rovnou `ZoomableImage`. Konzistence zadarmo.

Protože `markdownComponents` sdílí detail poznámky (`NoteDetail.tsx`) i náhled
v editoru (`Editor.tsx`), dostanou obě místa stejné chování a nemůžou se rozejít.

### Spouštěč: tlačítko, ne `onClick` na `<img>`

Obrázek se obalí do `<button className="note-image-btn">` s `aria-label`
z `t('images.zoom')`. Tlačítko dá klávesnicovou obsluhu (Tab, Enter/Space)
a screen-reader sémantiku zdarma — proti ručnímu `onClick` + `tabIndex` +
`role="button"` + `onKeyDown` na `<img>`. Tlačítko je čistě průhledný obal:
bez rámečku, výplně a vlastního paddingu, aby obrázek v textu vypadal stejně
jako dnes.

### Vzhled a fit

Overlay jde cestou stávajícího `.modal-overlay` (`position: fixed; inset: 0`,
tmavé pozadí, flex centrování) — ten pattern už v `App.css` je z biometrického
promptu. **Žádný portál**: žádný předek renderu poznámky nemá `transform`,
`filter` ani `contain`, takže `position: fixed` se váže k viewportu.
(Kdyby se to někdy změnilo, lightbox se „zasekne" uvnitř sloupce — to je
tichý předpoklad, který stojí za komentář u CSS. Portál by ten problém obešel,
ale `react-dom/server` portály neumí a suita nemá jsdom, takže by nešel
otestovat markup.)

Kořenový element overlaye je `<span>` s `display: flex`, ne `<div>`. Obrázek
sedí uvnitř markdownového `<p>` a `<div>` v odstavci je neplatné vnoření;
`<span>` je phrasing content, stejně jako tlačítko `✕` a obrázek uvnitř.

- Obrázek: `max-width: 100%`, `max-height: 100%`, `object-fit: contain`.
  Obrázky jsou už při uploadu omezené na 1600 px delší hrany, takže na
  fullscreenu je typicky vidět celý a v plném rozlišení.
- Padding overlaye: `max(20px, env(safe-area-inset-*))`, aby `✕` neskončil pod
  výřezem. **Poznámka:** `frontend/index.html` má viewport meta *bez*
  `viewport-fit=cover`, takže dnes `env()` vrací nulu a uplatní se 20px základ —
  prohlížeč sám odsazuje viewport od výřezu. `viewport-fit=cover` **nepřidáváme**,
  ovlivnilo by layout celé appky. `max()` je tam proto, aby lightbox byl
  připravený, kdyby se to někdy změnilo.
- Zavírací `✕` vpravo nahoře, `aria-label` z `t('images.close')`.
- `role="dialog"`, `aria-modal="true"`.
- Na desktopu `cursor: zoom-in` na obrázku v poznámce a `cursor: zoom-out`
  na **celé ploše** lightboxu (viz Zavírání — zavírá klik kamkoliv, takže kurzor
  nikde neslibuje akci, která by se nestala).
  To je jediná nápověda, že to jde — badge ani ikonu nepřidáváme,
  poznámka má zůstat čistá a na dotyku je „tap na obrázek = zvětšit" zažité.

### Zavírání

Čtyři cesty, všechny vedou do jednoho `onClose`:

1. **Tap/klik kamkoliv** — jediný handler na overlayi, **bez** `stopPropagation`
   na obrázku. Uvnitř lightboxu není co ovládat (žádný zoom ani posun), takže
   inertní obrázek by jen zmenšoval cíl; na telefonu zabere skoro celý viewport
   a proužek pozadí kolem něj je úzký. Takhle se chovají běžné galerie.
2. **Tlačítko `✕`** — `stopPropagation` tady také netřeba, obě cesty vedou
   do stejného `onClose`.
3. **Esc** — `keydown` listener na `window` v `useEffect`, odregistrovaný
   v cleanupu.
4. **Systémové Zpět** (viz níže).

### Tlačítko Zpět a historie

Při otevření lightbox přidá záznam do historie:

```ts
window.history.pushState({ ...window.history.state, bpadLightbox: true }, '')
```

- **URL se nemění**, takže react-router nikam nenaviguje.
- Roztažení stávajícího `window.history.state` zachová routeru jeho vlastní
  klíče (`key`/`idx`); kdybychom je přepsali prázdným objektem, router by na
  `popstate` ztratil orientaci ve své historii.

Na `popstate` se lightbox zavře. Cleanup efektu pak uklidí náš záznam, ale
**jen když tam ještě je**:

```ts
return () => {
  window.removeEventListener('popstate', onPop)
  if (window.history.state?.bpadLightbox) window.history.back()
}
```

Když uživatel zavřel Zpětem, náš záznam už je pryč, podmínka neplatí a `back()`
se nezavolá. Když zavřel Escem, tapem nebo `✕`, uklidíme ho sami. Vynechání
téhle podmínky je přesně ta chyba, po které tlačítko Zpět „skáče o dva kroky".

### Zámek scrollu

Dokud je lightbox otevřený, `document.body` dostane `overflow: hidden`
(nastaveno a vráceno ve stejném `useEffect`).

Ani `html`, ani `body` si nenastavuje vlastní `overflow`, takže tenhle zámek
platí pro celý viewport na mobilu i na desktopu — pravý sloupec s detailem
poznámky nemá vlastní scroll kontejner, jede s celou stránkou (viz `App.css`).

**Vědomě přijaté omezení:** kolečko nad levým panelem se seznamem pořád
scrolluje ten seznam — `.list-pane .entries` je vlastní scroll kontejner
(viz media query v `App.css`) a zámek na `body` do něj nezasahuje. Neřešíme
to — spolehlivé blokování by znamenalo neprůhledné zásahy do scroll
kontejnerů.

### i18n

Do `frontend/src/i18n/en.ts` pod stávající sekci `images`:

| Klíč | Text | Použití |
|---|---|---|
| `images.zoom` | `view image larger` | `aria-label` spouštěcího tlačítka |
| `images.close` | `close image` | `aria-label` tlačítka `✕` |

Žádný uživatelský text natvrdo v komponentě.

## Testy

Suita běží **bez jsdom**, přes `renderToStaticMarkup` (viz `markdown.test.tsx`).
Pokryjeme statické markup:

- `ZoomableImage` vykreslí `<button>` s `aria-label` obalující `<img>`
  se správným `src`/`alt`.
- `ImageLightbox` vykreslí overlay s `role="dialog"`, obrázkem se správným
  `src`/`alt` a zavíracím tlačítkem.
- `bpad-img:` v `loading` / `failed` stavu **není** zabalený v tlačítku.

**Co testy nepokrývají:** efekty v SSR neběží, takže Esc, `popstate`/tlačítko
Zpět ani zámek scrollu nejsou automatizovaně ověřené. Ověřit ručně v běžící
appce — na desktopu (Esc, klik na pozadí) i na mobilu (tap, systémové Zpět,
safe-area). Tohle je vědomá mezera, ne přehlédnutí: přidat jsdom kvůli jedné
komponentě by zpomalilo celou suitu.

## Dotčené soubory

| Soubor | Změna |
|---|---|
| `frontend/src/ImageLightbox.tsx` | nový — overlay |
| `frontend/src/markdown.tsx` | `ZoomableImage` wrapper, napojení obou větví `img` |
| `frontend/src/App.css` | `.lightbox-*`, `.note-image-btn`, kurzory |
| `frontend/src/i18n/en.ts` | `images.zoom`, `images.close` |
| `frontend/src/markdown.test.tsx` | testy wrapperu |
| `frontend/src/ImageLightbox.test.tsx` | nový — testy overlaye |
