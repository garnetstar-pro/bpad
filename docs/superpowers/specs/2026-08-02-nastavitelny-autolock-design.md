# Nastavitelný auto-lock timeout — design spec

## Cíl

Uživatel si může sám zvolit, po jaké době nečinnosti se vault zamkne, nebo zamykání zcela vypnout. Stejné nastavení platí pro desktop i mobil — na mobilu je ale výchozí hodnota „nikdy" (zachování dnešního chování), na desktopu „5 minut" (zachování dnešního chování).

---

## Kontext

### Dnešní stav
- Idle lock je implementován v `frontend/src/AuthContext.tsx`.
- Timeout je hardcoded: `const IDLE_TIMEOUT_MS = 5 * 60 * 1000` (`AuthContext.tsx:21`).
- Na touch zařízeních se idle lock záměrně přeskakuje (`isTouchPrimary()` check na řádku 42).
- Preference `sortBy` ukazuje vzor: `localStorage` per-user jako cache, server jako source of truth (`/auth/preferences` PUT, `/auth/me` GET).

### Co se mění
- Timeout přestane být hardcoded; čte se z nové preference `autoLockMinutes`.
- `isTouchPrimary()` check se odstraní — idle lock funguje na všech zařízeních, pokud si uživatel nastaví nenulový timeout.
- Přibude dropdown na Account stránce.
- API (`/auth/preferences` a `/auth/me`) se rozšíří o `autoLockMinutes`.

---

## Datový model

### Hodnoty timeoutu

```
[1, 5, 15, 30, 60, null]   // minuty; null = nikdy
```

### Server — `User` model (`api/models.py`)
Přibude pole:
```python
auto_lock_minutes: int | None = None  # None = never; default = None (each device picks its own default)
```

Serverová hodnota `None` neznamená „nikdy" — znamená „preferenci ještě uživatel nenastavil; použij device default". Klient si přeloží `None` ze serveru jako device default (desktop → 5, mobil → null). Jakmile uživatel nastaví hodnotu (i „nikdy"), server uloží konkrétní číslo nebo sentinel `0` pro „nikdy" (viz níže).

**Sentinel pro „nikdy":** Server ukládá `null` jako „nenastaveno" a `0` jako „nikdy". Klient posílá `0` pro „nikdy", `null` nikdy neposílá (vždy posílá explicitní hodnotu po první změně). Tím se dá rozlišit „uživatel nezvolil" od „uživatel zvolil nikdy".

### API

**`GET /auth/me`** — přibude v odpovědi:
```json
{ "autoLockMinutes": 15 }   // nebo 0 (nikdy) nebo null (nenastaveno = device default)
```

**`PUT /auth/preferences`** — přibude v těle:
```json
{ "sortBy": "created", "autoLockMinutes": 15 }   // autoLockMinutes je optional field
```

`autoLockMinutes` v PUT je optional — pokud chybí, server nemění stávající hodnotu. Validace: celé číslo ≥ 0, nebo null (null = reset na „nenastaveno", prakticky nepotřebné, ale konzistentní).

### Frontend — `preferences.ts`
Přibydou funkce:
```ts
getAutoLockPref(): number | null   // null = nikdy; přečte z localStorage, fallback = device default
setAutoLockPref(minutes: number | null): void  // uloží do localStorage
```

localStorage klíč: `` `bpad.pref.autolock.${username}` ``

Device default (použije se jen pokud server vrátí `null` a localStorage je prázdný):
- desktop (`!isTouchPrimary()`): `5`
- mobil (`isTouchPrimary()`): `null`

### Frontend — `authApi.ts`
- `Account` interface rozšíří o `autoLockMinutes: number | null`.
- `getAccount()` po úspěchu zavolá `setAutoLockPref(account.autoLockMinutes ?? deviceDefault())`.
- `savePreferences()` přijme volitelný druhý parametr `autoLockMinutes?: number | null` a zahrne ho do PUT těla.

---

## AuthContext — idle lock logika

```ts
// Místo hardcoded konstanty:
const timeoutMs = autoLockMinutes === null ? null : autoLockMinutes * 60_000

// useEffect podmínka — lock je aktivní pokud timeoutMs !== null:
if (username === null || locked || timeoutMs === null) return
```

`isTouchPrimary()` check se odstraní. Logika timeru a event listenerů zůstává beze změny — jen `IDLE_TIMEOUT_MS` se nahradí dynamickým `timeoutMs`.

**Jak AuthContext získá aktuální preferenci:**
`AuthContext` importuje `getAutoLockPref()` z `preferences.ts`. Hodnota se čte při každém (re)mountu efektu — tj. `useEffect` závisí na `[username, locked]` (stejně jako dnes), ale uvnitř volá `getAutoLockPref()` za běhu. Pokud uživatel změní timeout na Account stránce, efekt se remountuje při příštím zamčení/odemčení. Pro okamžitou aplikaci bez remount: Account stránka po uložení preference spustí custom event `bpad:lockpref-changed` a AuthContext ho naslouchá a přepočítá `timeoutMs`.

---

## UI — Account stránka

Nová sekce v `account-card` (za jazykovou volbou, před zbytkem):

```
Auto-lock     [dropdown: 1 min / 5 min / 15 min / 30 min / 1 hour / Never]
```

Dropdown je `<select>` se stejným `account-row` / `account-key` / `account-val` vzorem jako `sortBy` (jazyk). Změna se okamžitě uloží lokálně a odešle na server (stejný vzor jako sortBy — best-effort, chyba se tiše loguje).

---

## i18n

Nové klíče v `en.ts`:
```ts
account: {
  // ...stávající...
  autoLock: 'Auto-lock',
  autoLockNever: 'Never',
  autoLock1: '1 minute',
  autoLock5: '5 minutes',
  autoLock15: '15 minutes',
  autoLock30: '30 minutes',
  autoLock60: '1 hour',
}
```

---

## Pydantic / API modely (`api/models.py`)

`PreferencesRequest` rozšíří o:
```python
autoLockMinutes: int | None = None   # optional; None = don't change; 0 = never
```

Validace: `Field(ge=0)` — záporné hodnoty odmítnout; `None` je povolené.

Handler `update_preferences` (`function_app.py`) uloží `autoLockMinutes` na user objekt, pokud je v requestu přítomen (není `None`). Pokud v requestu chybí (Pydantic default `None`), nic se nemění.

Abychom odlišili „neposláno" od „posláno jako null/reset", použijeme `Optional` s explicitním sentinelem: klient nikdy neposílá `null`, posílá `0` pro „nikdy". Server tedy: `if data.autoLockMinutes is not None: user.auto_lock_minutes = data.autoLockMinutes`.

---

## Zachování zpětné kompatibility

- Stávající uživatelé nemají `auto_lock_minutes` v Cosmosu → Pydantic default `None` → klient dostane `null` → device default (desktop 5 min, mobil nikdy). Chování identické dnešku.
- `sortBy` PUT bez `autoLockMinutes` → server ignoruje (optional field), preference zůstane.

---

## Co se NEMĚNÍ

- Mechanismus zamčení (clearSession, LockScreen) — beze změny.
- Biometric unlock flow — beze změny.
- Offline lock (cold reload) — beze změny; to není idle timeout, ale restart stránky.
- `isTouchPrimary()` v `device.ts` zůstává (používá se jinde), jen se odstraní z podmínky v `AuthContext`.

---

## Testování

### API testy (`api/`)
- `PUT /auth/preferences` s `autoLockMinutes=15` → uloží; `GET /auth/me` → vrátí `15`.
- `PUT /auth/preferences` bez `autoLockMinutes` → `autoLockMinutes` na serveru se nezmění.
- Validace: `autoLockMinutes=-1` → 422.
- Stávající uživatel bez pole → `GET /auth/me` vrátí `null`.

### Frontend unit testy (`frontend/src/`)
- `getAutoLockPref()` bez localStorage → device default (mockovat `isTouchPrimary`).
- `setAutoLockPref(null)` → uloží sentinel pro „nikdy"; `getAutoLockPref()` vrátí `null`.
- `getAutoLockPref()` po `setAutoLockPref(30)` → `30`.

### Manuální smoke test
1. Desktop: nastavit „Never" → vault se nezamkne po 5 minutách.
2. Desktop: nastavit „1 minute" → vault se zamkne po 1 minutě nečinnosti.
3. Mobil: nastavit „5 minutes" → vault se zamkne po 5 minutách.
4. Reload stránky → preference přežije (localStorage).
5. Login z jiného zařízení → preference se načte ze serveru.
