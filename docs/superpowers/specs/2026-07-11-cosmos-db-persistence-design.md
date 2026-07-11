# Perzistence poznámek v Azure Cosmos DB

**Datum:** 2026-07-11
**Status:** Schváleno

## Cíl

Nahradit dočasné in-memory úložiště (`notes_store`) trvalou perzistencí v
**Azure Cosmos DB (NoSQL API, serverless / free tier)**, aby poznámky přežily
restart, redeploy i běh na více instancích.

## Rozhodnutí

- **Cosmos DB, NoSQL (Core) API.** Poznámka = JSON dokument, mapuje se 1:1.
- **Repository vrstva** s jednotným rozhraním; endpointy v `function_app.py` se
  logicky nemění, jen volají repozitář místo globálního seznamu.
- **Dva backendy za stejným rozhraním:**
  - `CosmosNotesRepository` — když je nastaven `COSMOS_CONNECTION_STRING`.
  - `InMemoryNotesRepository` — fallback pro lokální vývoj bez Cosmosu
    (loguje varování, aby bylo jasné, že data nejsou trvalá).
- **Partition key `/id`** — hodnota == `id` poznámky. Point read/write/delete
  jsou tak přímé; výpis je cross-partition dotaz (na osobním objemu levné).
- **Řazení newest-first v Pythonu** (`created_at` desc) — robustní napříč verzemi
  SDK, dataset je malý.
- **DB `bpad`, kontejner `notes`**, obojí `*_if_not_exists` (idempotentní).
- **Konfigurace:** connection string v **SWA → Configuration** jako
  `COSMOS_CONNECTION_STRING`. Lokálně přes `local.settings.json` / env.

## Rozhraní repozitáře

```python
class NotesRepository(Protocol):
    def list_notes(self) -> list[Note]: ...        # newest-first
    def get_note(self, note_id: str) -> Note | None: ...
    def save_note(self, note: Note) -> None: ...    # upsert (create i update)
    def delete_note(self, note_id: str) -> bool: ...  # False když nenalezeno
```

`function_app.py` staví `Note` (včetně `extract_title`) a jen volá repozitář:
- POST → `save_note(new)`, 201
- GET/{id} → `get_note` nebo 404
- PUT/{id} → `get_note` (404) → mutace → `save_note`
- DELETE/{id} → `delete_note` → 204 / 404
- GET → `list_notes`

## Cosmos mapování

- Dokument = `note.model_dump(mode="json")` (má `id`, `created_at` jako ISO).
- Rekonstrukce = `Note.model_validate(item)` (Pydantic ignoruje `_rid`, `_etag`…).
- Klient a kontejner se inicializují **líně** (memoizovaně) při první operaci,
  ať import modulu nedělá síťové volání při cold startu.
- `create_database_if_not_exists`, `create_container_if_not_exists('/id')`.

## Závislosti

- Přidat `azure-cosmos` do `api/requirements.txt`.

## Testy / ověření

- **Unit (pytest, TDD):** `InMemoryNotesRepository` — list newest-first,
  get hit/miss, save = create i update (upsert), delete hit/miss.
- **Integrace:** `CosmosNotesRepository` proti **Cosmos DB Linux emulátoru**
  (Docker), pokud poběží; jinak proti reálnému účtu. Ověřit celý CRUD.

## Provisioning (dodá uživatel ve svém předplatném)

`az cosmosdb create` (serverless nebo free-tier), `az cosmosdb sql database/
container create`, získat connection string a vložit do SWA app settings.
Přesné příkazy dodá agent v odpovědi.

## Bezpečnost (navazující, mimo tento spec, ale nutné před veřejným během)

API je `AuthLevel.ANONYMOUS` + CORS `*`. S perzistencí a veřejným hostingem je
potřeba přístup zamknout (vestavěná autentizace SWA). Řeší se samostatně.

## Mimo rozsah

- Migrace stávajících (in-memory) dat — žádná trvalá data zatím neexistují.
- Managed identity místo connection stringu (možné zpřísnění později).
- Více uživatelů / per-user partitioning.
