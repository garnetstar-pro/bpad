# Tlačítko „Přidat obrázek" v editoru (mobilní vkládání) — návrh

**Datum:** 2026-07-25
**Stav:** návrh odsouhlasen, čeká na implementační plán
**Navazuje na:** `2026-07-25-obrazky-vystrizky-design.md` (inline obrázky, paste-at-cursor)

## Cíl

Umožnit vložení obrázku do poznámky i tam, kde nefunguje vložení ze schránky
(Ctrl+V) — hlavně na **mobilu**. Přidat do editoru tlačítko **„Přidat obrázek"**,
které přes `<input type="file" accept="image/*">` otevře systémový výběr
(Fotky / Screenshoty / Fotoaparát / Soubory) a vloží vybraný obrázek stejnou
cestou jako paste.

## Kontext a motivace

Stávající vkládání obrázků (viz navazující spec) používá jako hlavní cestu paste
ze schránky. Na mobilních prohlížečích je `paste` obrázků nespolehlivé a není
pohodlné „Ctrl+V". File input je jediný mechanismus, který funguje spolehlivě na
**iOS i Androidu** a nabídne knihovnu fotek, kde screenshoty leží. Byla to
volba „Výběr souboru / tlačítko", kterou původní návrh evidoval, ale neimplementoval.

## Rozsah (fáze 1)

- **Jeden obrázek na výběr** (file input bez `multiple`), konzistentní s paste.
- Tlačítko **vedle záložek Write/Preview** v editoru (`capture-tabs`), ikona + text.
- **Žádný nový backend, API, krypto ani blob logika** — jen nový vstupní bod do
  existující pipeline `processImage` → `uploadImage` → vložení `![](bpad-img:ID)`.
- Desktop paste (Ctrl+V) zůstává beze změny.

## Návrh

### Sdílený helper (drobný refaktor)

Tělo stávajícího `handlePaste` v `Editor.tsx` se vytáhne do jedné funkce
`insertImageFromFile(file: File | Blob)` uvnitř komponenty:

1. Zachytí pozici kurzoru (`selectionStart`/`selectionEnd` z `textareaRef`, nebo
   konec draftu, když textarea není v write režimu).
2. `setUploading(true)` → `processImage(file)` → `uploadImage(processed)` →
   vloží `![](bpad-img:ID)` na pozici kurzoru přes funkční `setDraft` updater.
3. Chyby mapuje: `too-large` → `t('editor.imageTooLarge')`, jinak
   `t('editor.imageFailed')`. `finally` resetuje `uploading`.

Volají ji **oba** vstupní body — `onPaste` (desktop) i `onChange` file inputu —
takže se nemůžou rozejít a zároveň se odstraní duplicita ve stávajícím paste kódu.

### Tlačítko + skrytý input

- Skrytý `<input type="file" accept="image/*" ref={fileInputRef}>` — **bez
  `multiple`** a **bez `capture`** (aby OS nabídl knihovnu fotek/screenshoty,
  ne jen fotoaparát).
- Viditelné tlačítko v řádku `capture-tabs`: malá ikona obrázku + text
  **„Add image"** (`t('editor.addImage')`). `onClick` → `fileInputRef.current.click()`.
- `onChange` inputu: `insertImageFromFile(e.target.files[0])`, pak
  `e.target.value = ''` (aby výběr téhož souboru znovu spustil `change`).
- `disabled` při `submitting || uploading` (stejná pojistka jako paste/uložit).
- V Preview režimu není kurzor → fallback vloží na konec draftu (stejné chování
  jako už má paste handler pro `textareaRef == null`).

### i18n

- Nový klíč `editor.addImage: 'Add image'` do `i18n/en.ts` (v bloku `editor`).

## Co se NEmění

- Backend, API (`/api/images`), Cosmos, blob storage, CSP, rate-limit.
- `processImage` / `uploadImage` / `resolveImageUrl` (jen se volají z nového místa).
- Paste handler jako takový (jen se jeho tělo přesune do sdíleného helperu).

## Testy

Helper je vázaný na komponentu (refs/state) a suita nemá jsdom — proto se, stejně
jako paste handler a zbytek editoru, ověří přes `npm run build` + `npm run lint`
a **manuální kontrolu na mobilu**: udělat screenshot → Add image → knihovna fotek
→ obrázek se vloží a vykreslí. Žádná nová čistá logika k unit testu nevzniká.

## Vědomé hranice / out of scope

| Oblast | Fáze 1 |
|---|---|
| Více obrázků na jeden výběr | ❌ (bez `multiple`) |
| PWA Web Share Target (sdílet screenshot → bpad) | ❌ — samostatná Android-only vylepšení, jiný spec |
| Fotoaparát napřímo (`capture`) | ❌ záměrně (skryl by galerii) |
| Editace/crop | ❌ |
