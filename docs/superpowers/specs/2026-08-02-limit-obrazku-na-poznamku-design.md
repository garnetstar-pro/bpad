# Limit počtu obrázků na poznámku — návrh

**Datum:** 2026-08-02
**Stav:** návrh odsouhlasen, čeká na implementační plán
**Navazuje na:** `2026-07-25-obrazky-vystrizky-design.md`,
`2026-07-25-pridat-obrazek-tlacitko-design.md`, `2026-08-01-sifrovani-obrazku-design.md`

## Cíl

Omezit počet obrázků v jedné poznámce. Výchozí hodnota je **10**. Limit je
uložený **u uživatele v Cosmos DB** a mění se **výhradně ručně v Azure Data
Exploreru** — žádné API ho nezapisuje a v aplikaci se nedá změnit. Dodržení
kontroluje **klient i server**.

## Kontext a motivace

Obrázky jsou dnes jediná část poznámky, která roste bez horní hranice: velikost
jednoho obrázku je omezená (10 MiB na vstupu, downscale na 1600 px WebP) a rychlost
nahrávání také (`_image_limiter`, 60 uploadů / 10 minut), ale počet obrázků
v jedné poznámce ne. Zároveň chybí páka, jak jednomu účtu limit individuálně
zvednout, aniž by se sahalo do kódu a nasazovalo.

Server obsah poznámky nevidí, takže počet obrázků zná jen z pole `image_ids`,
které klient posílá při ukládání (`NoteCreate.image_ids`, viz
`api/images_ops.py:reconcile_note`). To je tedy jediné místo, kde jde limit na
serveru vynutit — a zároveň to plně stačí, protože právě `image_ids` rozhoduje,
které bloby přežijí úklid.

## Rozsah

- Kvóta **na uživatele**, čtená ze záznamu v kontejneru `users`, default 10.
- **Ne** nastavitelná uživatelem: žádný nový endpoint, `PreferencesRequest`
  zůstává beze změny.
- Tvrdý limit: server odmítne **každé** uložení nad limit — vytvoření i editaci,
  včetně obnovy ze zálohy.
- Klient limit vynucuje preventivně v editoru (nahrávání se vůbec nespustí).

## Návrh

### Server

**`api/models.py`** — `User` dostane pole:

```python
# Non-secret per-user quota: how many images one note may reference.
# Deliberately not writable through any endpoint — change it directly in the
# Cosmos `users` container (Azure Data Explorer).
max_images_per_note: int = 10
```

Default hodnoty se doplní při čtení starých dokumentů, takže migrace není
potřeba. `save_user()` upsertuje celý model, takže ručně nastavená hodnota
přežije změnu preferencí, hesla i recovery.

**`api/function_app.py`** — konstanta `_DEFAULT_MAX_IMAGES_PER_NOTE = 10`
(fallback, když se uživatelský záznam nepodaří načíst) a helper vedle
stávajícího `_note_limit_hit()`:

```python
def _image_limit(user: Optional[User]) -> int:
    return user.max_images_per_note if user else _DEFAULT_MAX_IMAGES_PER_NOTE


def _image_limit_exceeded(image_ids, limit: int) -> bool:
    return len(set(image_ids)) > limit
```

Počítají se **různá** id: stejný obrázek vložený do poznámky třikrát je jeden
obrázek (`parseImageIds()` na klientovi duplicity už odstraňuje, server se na to
nespoléhá).

Kontrola se volá v `create_note` i `update_note` **před uložením poznámky**
a před `reconcile_note`, takže odmítnutý požadavek nic nezmění. Odpověď je
`403` s hláškou `A note can hold at most N images.` — stejný status i tón jako
u stávajících kvót na počet poznámek. V `create_note` se uživatel načítá už
teď (kvůli `email_verified`), takže žádné čtení navíc; v `update_note` přibude
jedno `users_repo.get_user()`.

**`auth/me`** přidá do odpovědi `"maxImagesPerNote": user.max_images_per_note`.

### Klient

**`frontend/src/entitlements.ts`** — dnes jen `isPremium()`; přibude sem cache
limitu, protože jde o serverem daný nárok, ne o volbu uživatele (ta patří do
`preferences.ts`):

```ts
export const DEFAULT_MAX_IMAGES_PER_NOTE = 10
export function getMaxImagesPerNote(): number
export function setMaxImagesPerNote(limit: number): void
```

Uloženo v `localStorage` pod klíčem odvozeným od uživatelského jména — stejný
vzor jako `preferences.ts` (`bpad.pref.sort.<user>`), včetně `try/catch` kolem
zápisu (quota / private mode). Nesmyslná nebo chybějící hodnota se čte jako
default 10.

**`frontend/src/authApi.ts`** — `Account` dostane `maxImagesPerNote: number`
a `getAccount()` cache naplní, stejně jako už volá `setSortPref()`.

`getAccount()` volá `Home` při mountu a `Account` při zobrazení profilu, takže
hodnota je čerstvá po každém otevření aplikace. Offline nebo při prvním běhu
na novém zařízení se jede na defaultu 10; serverová kontrola je pojistka pro
případ, že by admin limit mezitím snížil.

**`frontend/src/Editor.tsx`**:

- `const imageCount = useMemo(() => parseImageIds(draft).length, [draft])`
- `const atImageLimit = imageCount >= getMaxImagesPerNote()`
- Tlačítko „Add image": `disabled={submitting || uploading || atImageLimit}`.
- `insertImageFromFile()` se při `atImageLimit` hned vrátí a nastaví
  `setError(t('editor.imageLimit', { limit }))`. Tím je pokrytý i **paste**,
  kde disabled tlačítko nepomůže, a případný souběh dvou vložení.
- Nahrávání se v obou případech vůbec nespustí — nevznikne osiřelý blob, který
  by čekal na 24hodinový sweep.

**`frontend/src/i18n/en.ts`** — nový klíč
`editor.imageLimit: 'a note can hold at most {limit} images'`, ve stejném stylu
jako sousední `imageTooLarge` / `imageFailed` (interpolace jako u
`tags.overLimit`).

**`frontend/src/api.ts`** — `updateNote()` dnes serverovou hlášku zahazuje za
generické `errors.saveFailed`. Propíše se verbatim, jak to už dělá
`createNote()`, aby byl 403 z backstopu čitelný — typicky u staré poznámky,
která limit překračuje.

### Poznámky nad limitem a obnova ze zálohy

Limit je **tvrdý**: poznámku, která už má víc obrázků, než limit dovoluje
(vznikla dřív, nebo pochází ze zálohy pořízené při vyšším limitu), nejde uložit,
dokud z ní uživatel obrázek neodebere. Chybová hláška ze serveru mu řekne kolik.

`backupImport.ts` se nemění: 403 u jedné poznámky spadne do větve „failed"
a import pokračuje dál (`noteLimitKind()` rozeznává jen kvóty na **počet
poznámek**, které mají import zastavit, protože by jinak selhaly všechny další).
Poznámka nad limitem se tedy přeskočí a objeví se v souhrnu jako neúspěšná;
její už nahrané obrázky zůstanou nenavázané a smaže je 24hodinový sweep.

## Testy

**API** (`api/test_notes.py`, `api/test_preferences.py`):

- `POST /notes` s 10 `image_ids` projde, s 11 vrátí 403 a poznámka nevznikne.
- `PUT /notes/{id}` se stejnými dvěma případy; při 403 zůstane původní obsah
  i navázané obrázky beze změny.
- Uživatel s ručně nastaveným `max_images_per_note = 25`: 25 projde, 26 ne.
- Duplicitní id v `image_ids` se počítá jednou.
- `auth/me` vrací `maxImagesPerNote` — default 10 i vlastní hodnotu.
- `PUT /auth/preferences` ručně nastavenou hodnotu nepřepíše.

**Frontend**:

- Nový `entitlements.test.ts`: default bez uloženého záznamu, round-trip
  `set`/`get`, izolace mezi uživateli, nesmyslná hodnota v `localStorage` →
  default. Bez jsdom — `localStorage` i `session` se stubují jako v `api.test.ts`.
- `Editor` se dá testovat jen přes `renderToStaticMarkup` (efekty neběží, viz
  `ImageLightbox.test.tsx`): draft nad limitem → tlačítko „Add image" má
  v markupu `disabled`.

## Co záměrně není součástí

- **Trvalé počitadlo „3/10" v editoru** — do jinak minimalistického editoru
  přidává šum; hláška při dosažení limitu stačí.
- **UI pro změnu limitu** (ani v Účtu, ani jinde) — mění se jen v Data Exploreru.
- **Limit na celkový počet obrázků na účet** nebo na objem blobů. Jiná kvóta,
  jiný návrh; dnes ji zastupuje rychlostní limit uploadu.
- **Zpětný úklid** poznámek, které limit už překračují.
