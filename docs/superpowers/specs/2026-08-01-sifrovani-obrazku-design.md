# Klientské šifrování obrázků — návrh (fáze 2)

**Datum:** 2026-08-01
**Stav:** návrh odsouhlasen, čeká na implementační plán
**Navazuje na:** `2026-07-25-obrazky-vystrizky-design.md` (fáze 1)

## Cíl

Uzavřít vědomou výjimku fáze 1: obrázky se přestanou ukládat jako plaintext
blob a začnou se šifrovat na klientovi, stejně jako text poznámek. Server
(a kdokoli s přístupem k Azure účtu) tím ztratí možnost obsah obrázků číst.
Schéma `bpad-img:ID`, API routy ani datový model poznámky se nemění — fáze 1
byla navržená právě tak, aby tenhle krok byl změna *obsahu* blobu, ne přestavba.

## Rozhodnutí a jejich hranice

| Rozhodnutí | Volba fáze 2 |
|---|---|
| Klíč | Stávající per-user `dataKey` ze session — týž, kterým se šifrují poznámky |
| Formát blobu | `sealBytes` / `openBytes`: 12B IV + AES-256-GCM, jeden soběstačný soubor |
| Volitelnost | **Ne** — šifruje se vždy, žádný přepínač, žádný dotaz při vkládání |
| Zpětná kompatibilita | **Žádná** — stávající nešifrované bloby se jednorázově smažou |
| Cache | Jen v paměti (LRU dešifrovaných blob URL), čištěná při `clearSession()` |
| Maskování velikosti | **Ne** — padding se nezavádí |
| API / Python | Beze změny |

## Klíč

Použije se `getDataKey()` ze `session.ts`, tedy per-user data key, kterým se
dnes šifrují poznámky. Na serveru leží jen zabalený (`wrapDataKey`) pod klíčem
odvozeným z hesla, takže přes něj beze změny funguje recovery code i změna
hesla, a v paměti je jen po dobu odemčené session.

**Nic nového se neodvozuje.** Žádná další KDF, žádný per-image klíč: Argon2id se
tu nespouští vůbec, klíč je v paměti už od přihlášení.

Důsledek: **zamčená session obrázky nezobrazí.** To není regrese — bez data key
se stejně nezobrazí ani text poznámky, ve které obrázek je.

## Formát blobu

`sealBytes(bytes, dataKey)` z `crypto.ts` — 12bajtové IV, za ním AES-256-GCM
ciphertext včetně tagu. Obsah blobu je tak o 28 B větší než obrázek a je
soběstačný: k jeho otevření není potřeba nic než klíč.

Tyhle funkce už existují a jsou v provozu — vznikly pro šifrované obrázky uvnitř
zálohy (formát v2). Fáze 2 je nepřidává, jen je použije na druhém místě.

## Tok dat

### Upload

1. `processImage()` beze změny: přeškálování na max 1600 px a překódování do
   WebP q0.85.
2. `sealBytes(bytes, dataKey)`.
3. `POST /api/images` s `content_type: "application/octet-stream"` a
   `size_bytes` **ciphertextu**.
4. PUT ciphertextu na vrácenou SAS URL.
5. Do markdownu se na pozici kurzoru vloží `![](bpad-img:ID)` — beze změny.

Skutečný content-type se serveru neposílá, protože ho nepotřebuje: `processImage`
produkuje vždycky WebP, takže si ho klient po dešifrování doplní sám. Jeden
metadatový únik tím mizí zadarmo.

Poznámka k implementaci: `AzureBlobStore.upload_url()` content-type do SAS
nepodepisuje, takže tahle změna nemůže rozbít autorizaci uploadu — mění se jen
hlavička `Content-Type` u PUT (nově `application/octet-stream`) a s ní typ,
který blob vrátí při čtení. `downloadImage` proto přestane číst
`res.headers.get('Content-Type')` a bude vracet `image/webp` napevno.

### Čtení

1. `BpadImage` zavolá `loadImage(id)`.
2. Cache hit → hotovo. Jinak `resolveImageUrl(id)` (beze změny, krátkodobá read
   SAS) → `fetch` → `openBytes` → `Blob` (typ `image/webp`) →
   `URL.createObjectURL` → uloží do cache.
3. Blob URL jde do `<img src>`. Lightbox, `ZoomableImage` i `loading="lazy"`
   zůstávají, jak jsou.

## Moduly

| Soubor | Změna |
|---|---|
| `frontend/src/imageCache.ts` *(nový)* | Čistá LRU `image id → objectURL` s revokací; žádné importy |
| `frontend/src/images.ts` | `uploadImage` pečetí, `downloadImage` odpečeťuje, nové `loadImage(id)` |
| `frontend/src/session.ts` | `clearSession()` vyprázdní i novou cache |
| `frontend/src/markdown.tsx` | `BpadImage` volá `loadImage(id)` místo `resolveImageUrl(id)` |
| `frontend/src/crypto.ts` | Beze změny — `sealBytes`/`openBytes` už existují |
| `api/**` | Beze změny |

**`imageCache.ts`** drží mapu `id → { url, size }` se stropem **24 MiB**
(řádově desítky obrázků po přeškálování); `size` je jen účetnictví pro strop,
bajty samotné vlastní `Blob` za objectURL. Při vystrnadění z cache i při
vyprázdnění volá `URL.revokeObjectURL` — jinak blob v paměti záložky přežije
navždy.

Modul je **čistě paměťový a nemá jediný import**: umí jen `getCachedImage`,
`putCachedImage` a `clearImageCache`. O síť i o pořadí kroků se stará
`loadImage(id)` v `images.ts` — cache hit → stáhnout → dešifrovat →
`createObjectURL` → uložit — a tam se taky sdílí rozdělaný slib, aby tři
výskyty téhož obrázku v jedné poznámce nespustily tři stahování.

Tahle hranice je zvolená kvůli závislostem: `session.ts` musí cache umět
vyprázdnit a `images.ts` už `session.ts` importuje (`getToken`). Kdyby cache
sahala na `downloadImage`, vznikl by kruh `session → imageCache → images →
session`. Čistý modul bez importů ho vylučuje.

**Napojení na odhlášení:** `session.ts:clearSession()` už dnes volá
`clearImageUrlCache()` a běží při odhlášení, při idle locku i při vypršení
tokenu. Přibude vedle ní volání `clearImageCache()`.

## Backup

`backupExport.ts` se **nemění**. `downloadImage` vrací dál plaintextové bajty,
jen je cestou dešifruje, takže do archivu se pořád balí skutečný WebP a formát
v2 zůstává platný. Zálohy vytvořené před fází 2 se dál otevřou beze změny —
šifrování v archivu je nezávislé (vlastní klíč z passphrase zálohy).

Restore taky beze změny: importér nahrává obrázky přes `uploadImage`, který je
nově zapečetí data key cílového účtu. Import už dnes běží jen přihlášenému
uživateli, takže klíč je k dispozici.

## Co server po změně ví

| Vidí | Nevidí |
|---|---|
| kolik obrázků uživatel má | jejich obsah |
| kdy vznikly | jejich typ (vždy `application/octet-stream`) |
| velikost každého (±28 B) | |
| ke které poznámce patří (`note_id`) | |

Velikost se **nemaskuje**. Padding na násobky by stál přenesené bajty i
složitost a proti hrubému odhadu „screenshot vs. fotka" stejně nepomůže
spolehlivě. Vazba obrázek → poznámka existuje kvůli úklidu (`reconcile_note`,
`cascade_delete_note`) a fáze 2 na ní nic nemění.

## Bez zpětné kompatibility

`ImageRecord` **nedostane příznak `encrypted`** a ve čtení není legacy větev:
po nasazení je obsah kontejneru `note-images` výhradně ciphertext.

Cenou je jednorázový operační krok, který **není součástí kódu**: smazat
existující bloby v `note-images` (dev i prod) a odpovídající dokumenty
v kontejneru `images`. Poznámky, které je referencují, ukážou po nasazení
placeholder „obrázek se nepodařilo načíst"; obrázek se vloží znovu.

Je to obhajitelné jen proto, že fáze 1 je na produkci pár dní a jde prakticky
výhradně o data vlastníka aplikace. **Kdyby se tenhle návrh implementoval
později**, nebo by aplikace mezitím měla víc uživatelů, tohle rozhodnutí je
potřeba přehodnotit — pak by bylo namístě jednorázové přešifrování v Account,
protože přešifrovat umí jedině klient, který má klíč.

Kdyby přesto nějaký starý blob zůstal, `openBytes` na něm selže na kontrole
GCM tagu a uživatel uvidí tentýž placeholder. Žádné tiché zobrazení
nešifrovaného obsahu není možné.

## Výkon

**Kryptografie je zanedbatelná.** WebCrypto AES-GCM běží na hardwarových AES
instrukcích; obrázek po `processImage` má typicky 100–400 KB, takže zapečetění
i otevření jsou jednotky milisekund — o dva řády méně než síťový roundtrip pro
SAS URL, na který se čeká už dnes.

Skutečná cena je ztráta toho, co dnes dělá prohlížeč sám: HTTP disk cache,
progresivní dekódování a odložené stahování mimo viewport. **Většina z toho je
ale iluzorní už dnes:** read SAS platí 15 minut a klient si URL drží 10 minut,
takže po vypršení dostane jinou URL (jiný query string) a HTTP cache se stejně
netrefí. Reálný rozdíl je tedy jen uvnitř toho desetiminutového okna.

Paměťová LRU cache tenhle rozdíl přebíjí: opakované otevření poznámky během
session je okamžité a bez sítě, tedy **rychlejší než dnešní stav**. Po reloadu
záložky se stahuje znovu — to se ale ve většině případů děje i teď.

## Chybové stavy

| Situace | Chování |
|---|---|
| Dešifrování selže (poškozený nebo starý blob) | placeholder `images.failed` |
| Chybí data key (zamčeno) | placeholder `images.failed` |
| `resolveImageUrl` selže (síť, 404) | placeholder `images.failed` — beze změny |
| Upload / rate limit | beze změny, včetně `UploadRateLimited` |

Nová hláška ani nová větev v UI nevzniká; `images.failed` v `i18n/en.ts` pokrývá
všechny cesty. Rozlišovat „server ti to nedal" od „nešlo to odšifrovat" nemá pro
uživatele cenu — udělá stejnou věc: vloží obrázek znovu.

## Testování

Vitest běží bez jsdom, takže `document` i `URL.createObjectURL` se stubují ručně
podle vzoru v `backupFile.test.ts`. `Blob`, `TextEncoder`, `crypto.subtle`
i `fetch` jsou v Node nativně.

**`imageCache.test.ts`** (nový)
- uložená položka se vrátí, neznámé id vrátí `undefined`
- překročení stropu vystrnadí nejdéle nepoužitou položku a revokuje její URL
- čtení položku osvěží, takže se vystrnadí ta druhá
- vyprázdnění revokuje všechny URL

**`images.test.ts`** (rozšíření)
- `loadImage` stáhne jednou a druhé volání obslouží z cache
- dva souběžné požadavky na tentýž id stáhnou jednou
- nahrané bajty **nejsou** plaintext (ciphertext ≠ vstup) a mají délku +28 B
- `downloadImage` vrátí původní bajty (round-trip)
- poškozený ciphertext skončí chybou, ne tichým prázdným obrázkem
- stávající testy `processImage`, rate limitu a `parseImageIds` beze změny

**`markdown.test.tsx`** se nemění — jeho `renderToStaticMarkup` efekty nespouští,
takže `BpadImage` zůstává na placeholderu tak jako dnes.

**Ručně na dev** (`crypto.subtle` vyžaduje https, lokálně přes LAN IP nefunguje):
vložit obrázek, ověřit zobrazení, reload záložky, zamknout a odemknout session,
vyexportovat zálohu a zkontrolovat, že v archivu je otevíratelný WebP.

## Mimo rozsah

| Oblast | Poznámka |
|---|---|
| Padding velikostí | vědomě ne, viz výše |
| Trvalá cache ciphertextu (Cache API / IndexedDB) | až kdyby opakované stahování po reloadu vadilo; přinesla by i offline obrázky |
| Přepínač v předvolbách | zamítnuto — volitelnost dělá ze zero-knowledge vlastnost jednotlivého souboru |
| Migrace starých blobů | nahrazena smazáním, viz výše |
| Náhledy, sdílení, serverové zpracování | s šifrováním principiálně neslučitelné bez dalšího návrhu |
