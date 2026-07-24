# Cost hardening před propagací

**Datum:** 2026-07-23
**Stav:** schváleno

## Kontext a motivace

Aplikace se chystá k propagaci. Tím se mění rizikový profil z „nikdo o ní neví" na
„kdokoli na ni může poslat traffic". Azure neumí tvrdý strop útraty (Budget jen
upozorní), takže skutečná obrana musí být v aplikaci.

Jediné škálující nákladové místo je **Cosmos DB serverless** — účtuje za RU (read/
write/query, úměrně velikosti dokumentu) a za storage. Functions mají velký free
grant, SWA Free tier má tvrdý bandwidth strop (throttluje, neúčtuje overage).
Hlídáme tedy objem dat v Cosmosu a neautentizované volání, která pálí RU.

Tento spec pokrývá tři nezávislé úpravy v `api/`. Každá má vlastní test. Žádná
změna frontendu ani datového modelu uložených dat — jen validace vstupu a limity.

## Úprava 1 — Limit velikosti poznámky

**Problém:** `NoteCreate.iv/ct` nemá žádný `max_length` (na rozdíl od
`FeedbackRequest`, které má `max_length=4000`). Přihlášený uživatel může uložit
blob až do 2 MB (hard limit Cosmosu) na poznámku. RU se účtuje úměrně velikosti
dokumentu, takže velké poznámky zdražují každý zápis i každé `list_notes`.

**Řešení:** `api/models.py`, model `NoteCreate` (parsuje ho **create i update**):

- `ct`: `Field(max_length=65536)` — Base64 string ≈ 48 KB šifrovaného obsahu
  ≈ ~45 KB plaintextu. Pohodlně dlouhá poznámka.
- `iv`: `Field(max_length=64)` — nonce je 12 B (≈ 16 znaků Base64), 64 je rezerva.

Nad limit vyhodí Pydantic `ValidationError`, který stávající `except` v
`create_note` i `update_note` převede na `400 Invalid data`. Žádná nová větev v
handlerech.

## Úprava 2 — Strop počtu poznámek na účet

**Problém:** `_UNVERIFIED_NOTE_LIMIT = 10` platí jen pro neověřené účty. Ověřený
účet (stačí jedna reálná e-mailová schránka) má neomezený počet poznámek → neomezený
storage/RU na jeden účet.

**Řešení:** `api/function_app.py`:

- Nová konstanta `_VERIFIED_NOTE_LIMIT = 1000`.
- V `create_note` spočítat `notes_repo.count_notes(user)` **jednou** a rozhodnout:
  - neověřený & `count >= _UNVERIFIED_NOTE_LIMIT (10)` → dosavadní chování
    (pošli verifikaci, `403` „Verify your e-mail…"). Beze změny.
  - `count >= _VERIFIED_NOTE_LIMIT (1000)` → `403` „Note limit reached".

Pro ověřené účty to přidá jeden `count` dotaz na každý create (dnes běží jen pro
neověřené). Zanedbatelné RU — create není hot path.

## Úprava 3 — Rate-limit neautentizovaných endpointů

**Problém:** `get_salt` (`auth/salt`) a `recovery_material` (`auth/recovery-material`)
dělají Cosmos read na každé volání a **nejsou rate-limited** (na rozdíl od
`pow-challenge`). Kdokoli může nekonečně tlouct `GET /api/auth/salt?username=x` →
neomezené Cosmos RU + Function exekuce, bez účtu, bez PoW.

**Řešení:** `api/function_app.py` — na začátek obou handlerů přidat stejný pattern
jako u ostatních auth rout:

```python
limited = _rate_limited(req)
if limited:
    return limited
```

Sdílený `_auth_limiter` (20 volání / 60 s per IP). Legitimní login = salt + login
= 2 volání, takže limit běžnému uživateli nevadí.

## Mimo scope (vědomě vyřazeno)

- **`maxScaleOutCount` / scale-out limit Functions** — aplikace používá **SWA managed
  API** (`api_location: api`), kde škálování řídí Static Web Apps a
  `functionAppScaleLimit` není konfigurovatelný. Byla by to no-op změna. Přirozeným
  stropem zůstávají limity SWA plánu.
- **Budget alert** — ruční akce v Azure portálu (Cost Management → Budgets), mimo kód.
- **Cosmos provisioned místo serverless** — dalo by predikovatelný fixní strop RU/s,
  ale za fixní minimální náklad. Pro start zůstáváme na serverless + hlídáme kód.

## Testy

- `api/test_*.py` — pro každou úpravu:
  1. poznámka nad limit velikosti → `400`; poznámka na hranici → projde.
  2. create při `count >= 1000` → `403`; pod limitem → `201`. (InMemory repo.)
  3. `auth/salt` a `auth/recovery-material` nad rate-limit → `429`.

Limiter je in-memory per-instance (best-effort brzda, ne obrana proti cílenému
útoku) — to je zdokumentovaný stávající kompromis, tento spec ho nemění.
