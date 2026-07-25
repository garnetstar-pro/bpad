# Obrázky / výstřižky v poznámkách — návrh (fáze 1)

**Datum:** 2026-07-25
**Stav:** návrh odsouhlasen, čeká na implementační plán

## Cíl

Umožnit vkládání malých obrázků a výstřižků (screenshotů) přímo do poznámek.
Primární způsob je **vložení ze schránky (Ctrl+V)** — uživatel udělá výstřižek
(Snipping Tool apod.) a vloží ho do editoru. Obrázek se objeví **inline** na
místě kurzoru. Binární data se ukládají do **Azure Blob Storage**.

## Rozhodnutí a jejich hranice

| Rozhodnutí | Volba fáze 1 |
|---|---|
| Vkládání | Vložení ze schránky (Ctrl+V) jako hlavní cesta |
| Umístění v poznámce | Inline v markdownu, na pozici kurzoru |
| Šifrování obrázků | **Ne** — plaintext blob (vědomé zjednodušení fáze 1) |
| Přístup k blobu | Privátní kontejner + krátkodobá SAS URL, klient ↔ blob přímo |
| Zpracování | Klientské přeškálování (max 1600 px, WebP ~0.85), vstupní strop 10 MB |
| Backup/export | Obrázky nezahrnuty; dokumentované omezení |

### Zero-knowledge: vědomé porušení pro fázi 1

bpad je jinak zero-knowledge — server u poznámek vidí jen šifrotext. Uložením
**nešifrovaných** obrázků do blobu server (a kdokoli s přístupem k Azure účtu)
uvidí jejich obsah. To je **vědomé zjednodušení fáze 1**. Návrh je proto veden
tak, aby přechod na klientské šifrování (fáze 2) nebyl přestavba — viz níže.

„Bez šifrování" **≠ „veřejné"**: blob je vždy v privátním kontejneru za
autorizací (SAS vydaná jen přihlášenému vlastníkovi).

## Jádro: jak se obrázek referencuje a zobrazí

**Do markdownu nikdy nepatří SAS URL** — je časově omezená, po vypršení by
obrázek zmizel a v exportu by byl mrtvý odkaz. Místo toho stabilní ID:

1. Paste → klient obrázek zpracuje → `POST /api/images` → dostane `image_id`.
2. Na pozici kurzoru se vloží `![](bpad-img:IMAGE_ID)` — čitelný, přenositelný
   odkaz nezávislý na SAS.
3. Při renderu (náhled + detail) **custom `img` komponenta** v `markdown.tsx`
   rozpozná schéma `bpad-img:`, sáhne pro čerstvou read-SAS URL
   (`GET /api/images/{id}/url`, v paměti cachovanou do vypršení) a nastaví
   `src`. Běžné `http(s)` obrázky se renderují jako dnes.

**Proč to drží:**

- Poznámka zůstává **jeden markdown dokument** — datový model poznámky
  (jediný `iv`/`ct` blob v Cosmos) se **nemění**.
- Fáze 2 (šifrování) změní jen *obsah* blobu (ciphertext místo plaintextu) a
  přidá dešifrování v `img` komponentě po stažení. **Schéma `bpad-img:ID` i API
  zůstávají** → bezbolestný přechod.
- Server nikdy nesahá na markdown poznámky (který stejně nevidí).

## Datový model

### Nová Cosmos container `images` (partition `/user_id`)

Serverless účet → další kontejner nestojí nic fixního (nemíchat do stávajících).

```json
{
  "id": "image_id",
  "user_id": "...",
  "note_id": "... | null",
  "blob_path": "user_id/image_id",
  "content_type": "image/webp",
  "size_bytes": 12345,
  "created_at": "..."
}
```

- `note_id == null` → „pending" (nahráno, ale poznámka ještě neuložena).
- `note_id` je jediná metadata-stopa o vazbě obrázek↔poznámka; slouží k úklidu.
  Server neví, kde v textu obrázek je ani jaký má obsah (mimo blob samotný).

### Blob Storage

- Kontejner `note-images` (default; přepis přes `IMAGES_CONTAINER`), **privátní**.
- Cesta blobu: `user_id/image_id`.

## Zpracování obrázku v prohlížeči

Čistá funkce `processImage(file) → Blob` (mimo React, testovatelná):

1. Vstupní strop: nad ~10 MB odmítnout s chybou.
2. Přeškálování přes `<canvas>`: delší hrana max **1600 px** (menší se
   nezvětšuje), re-encode na **WebP** kvalita ~0.85 (fallback JPEG).
3. EXIF/metadata se canvasem zahodí (bonus pro soukromí).

## API

Drží se stávajícího vzoru repozitářů: `Protocol` + `InMemory*` + `Cosmos*` +
`get_*_repository()` factory, navíc blob klient. Bez `BLOB_CONNECTION_STRING`
padá do in-memory/no-op (testy a lokál běží bez blobu), stejně jako Cosmos bez
connection stringu.

### Nové routy

- `POST /api/images` — tělo `{ content_type, size_bytes }`. Ověří token, založí
  `images` dokument (`note_id = null`), vygeneruje **write-only** SAS na
  `blob_path`, vrátí `{ image_id, upload_url }`. Zde proběhne líný GC (viz níže).
- `GET /api/images/{id}/url` — ověří vlastnictví (`user_id` == token), vrátí
  krátkou **read** SAS URL (platnost např. 15 min).

### Upload flow (Functions nepřenáší bajty)

```
1. Klient: processImage() → Blob
2. Klient → POST /api/images { content_type, size_bytes }
3. API: založí pending images dokument + write SAS → { image_id, upload_url }
4. Klient: PUT Blob přímo na upload_url (přímo do Azure Blob)
5. Klient: vloží ![](bpad-img:image_id) na pozici kurzoru
```

Read cesta je zrcadlo: `GET /api/images/{id}/url` → read SAS → `img` komponenta
ji dá do `src`, cache do vypršení.

### Rozšíření notes API — vázání (claim)

Server z šifrované poznámky nepozná, které obrázky referencuje. Proto to klient
oznámí explicitně:

- `POST /notes` a `PUT /notes/{id}` dostanou volitelné pole `image_ids: [...]` —
  ID, která markdown poznámky reálně referencuje (klient je vyparsuje z textu
  při ukládání).
- Server u těchto ID nastaví `note_id` a přepne je z „pending" na „claimed".
- Na `PUT` navíc: obrázky, které dřív patřily téhle poznámce, ale už v
  `image_ids` nejsou (uživatel je z textu smazal), se smažou — blob i záznam.
- `image_ids` je jediná další metadata-stopa (počet obrázků poznámky); obsah ani
  pozici v textu server nezná. Pro fázi 1 (obrázky stejně nešifrované) přijatelné.
- **Známé omezení „jeden obrázek = jedna poznámka":** `note_id` je jednohodnotové.
  Když uživatel *ručně zkopíruje* markdown `![](bpad-img:ID)` do druhé poznámky,
  obě sdílejí týž blob; smazání/úprava jedné pak přes kaskádu/unbind smaže blob
  i té druhé (tichá ztráta obrázku). Málo pravděpodobné — paste vždy nahrává nový
  obrázek s novým ID. Fáze 1 to vědomě neřeší; skutečné řešení (reference-counting
  nebo duplikace blobu při kopírování) je mimo scope.

## Životní cyklus a úklid

- **Mazání poznámky** (`DELETE /notes/{id}`): server dohledá `images` s daným
  `note_id` a smaže bloby i záznamy (kaskáda).
- **Osiřelé pending obrázky** (uživatel vloží obrázek, pak koncept zahodí):
  **líný GC** — při `POST /api/images` téhož uživatele smaž jeho `pending`
  (note_id null) záznamy starší než 24 h. Žádný cron. Timer-trigger lze přidat
  později, pokud se ukáže potřeba.

## Frontend

- **`Editor.tsx`**: `onPaste` na textarey zachytí obrázek ze schránky, zavolá
  `processImage` + upload, vloží `![](bpad-img:id)` na pozici kurzoru. Indikace
  probíhajícího uploadu; chybové stavy přes `t()`.
- **`markdown.tsx`**: custom `img` komponenta rozpozná `bpad-img:` a resolvne
  read SAS URL (s paměťovou cache). Použije se v náhledu editoru i v `NoteDetail`.
- **Nový modul `images.ts`** (příp. `imageApi.ts`): `processImage`, upload,
  `resolveImageUrl(id)` s cache. Držet čistý/testovatelný ve stylu `api.ts`.
- **i18n**: všechny nové texty do `i18n/en.ts` přes `t()`, nic natvrdo.

## Env proměnné

| Proměnná | Účel |
|---|---|
| `BLOB_CONNECTION_STRING` | Azure Blob Storage. Nenastaveno → in-memory/no-op (testy, lokál). |
| `IMAGES_CONTAINER` | Název kontejneru (default `note-images`). |

## Vědomé hranice fáze 1 (out of scope)

| Oblast | Fáze 1 | Poznámka |
|---|---|---|
| Šifrování obrázků | ❌ plaintext blob | fáze 2 — schéma připravené |
| Backup/restore | obrázky nezahrnuty; `bpad-img:` odkaz v exportu po restore na jiném účtu neukáže obrázek | dokumentované omezení |
| Offline čtení | best-effort přes SW cache, nezaručeno | text poznámek funguje dál |
| Free/premium limit | bez gatingu, jen technický strop na obrázek | entitlement lze přidat později |
| Editace obrázku (crop) | ❌ | |
| Strop velikosti obrázku | **klientský** (10 MB / přeškálování) — write SAS ho nevynucuje | skutečné vynucení velikosti až fáze 2 / infra; upload je ale rate-limitovaný (viz níže) |
| Sdílený blob mezi poznámkami | ❌ jeden obrázek = jedna poznámka (viz omezení výše) | reference-counting mimo scope |

**Rate-limit uploadu:** `POST /api/images` má per-user sliding-window limit
(`_image_limiter`, 60 uploadů / 600 s), stejný vzor jako auth/feedback. Je to
brzda proti tomu, aby přihlášený účet nafoukl blob storage — ne tvrdý limit
(ten patří na infra vrstvu, viz CLAUDE.md). Strop velikosti jednoho obrázku
zůstává klientský.

## Testy

- `processImage` — čistá funkce, unit testy (přeškálování, strop, formát).
  Pozor: suita běží v čistém Node bez jsdom → `document`/`canvas`/`Image`
  bude potřeba stubovat (viz vzor v `api.test.ts`, `backupFile.test.ts`).
- API: `images` repozitář (InMemory) — claim, kaskádové mazání, líný GC.
- Parsování `image_ids` z markdownu — čistá funkce, unit testy.
