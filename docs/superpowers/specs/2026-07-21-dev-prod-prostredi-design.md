# Oddělená dev a prod prostředí (dev.bpad.pro / bpad.pro)

**Datum:** 2026-07-21
**Stav:** návrh

## Cíl

Provozovat `dev.bpad.pro` jako testovací prostředí (napřed, poslední změny) a
`bpad.pro` jako stabilní ostrou verzi (pozadu, promovaná ručně). Obě prostředí
sdílí jeden Cosmos účet, ale **každé má vlastní databázi**, takže testovací
provoz nikdy neušpiní ani nerozbije ostrá data.

## Výchozí stav (zjištěno 2026-07-21)

- **`master` (i `origin/master`) je jen 5-commitový skeleton** — `Add react
  frontend`, `Add backend API`, workflow. Neobsahuje `api/repository.py`,
  `auth.py` ani reálnou aplikaci.
- **Reálná aplikace žije na feature větvích.** Nejdál je
  `feature/two-pane-notes-layout` (153 commitů před masterem), descenduje z
  `feature/backup-export-import` i `feature/markdown-heading-title`. Je to de
  facto vývojový HEAD.
- **`master` je přímý předek `two-pane`** — žádné divergentní commity, takže
  `master` jde na `two-pane` **fast-forwardnout bez merge commitu**.
- Deploy workflow `azure-static-web-apps-green-bay-04c7f9003.yml` se spouští na
  push do `master` a nasazuje do jediného SWA `bpad`
  (`green-bay-04c7f9003`), na kterém je custom doména `dev.bpad.pro`.
- Cosmos účet `bpad-cosmos`, databáze `bpad` (serverless), obsahuje současná
  data.

**Důsledek:** dokud je `master` skeleton, model „master → prod" nedává smysl —
nebylo by co promovat. **Prvním krokem je proto srovnat trunk.**

## Cílová architektura

### Dvě SWA, dvě databáze v jednom Cosmos účtu

| | **dev.bpad.pro** | **bpad.pro** |
|---|---|---|
| SWA resource | stávající `bpad` (`green-bay-04c7f9003`) | **nový** `bpad-prod` |
| Deploy z větve | `dev` | `master` |
| Cosmos databáze | `bpad` (stávající data) | `bpad-prod` (nová, prázdná) |
| Cosmos účet | `bpad-cosmos` (sdílený) | `bpad-cosmos` (sdílený) |

Obě prostředí míří na stejný Cosmos účet (stejný `COSMOS_CONNECTION_STRING`),
liší se jen jménem databáze. Cosmos je serverless → druhá databáze nic fixního
nestojí. Databáze se v kódu zakládá `create_database_if_not_exists`, takže
`bpad-prod` vznikne sama při prvním zápisu — žádný manuální krok v portálu.

Stávající data zůstávají tam, kde jsou (databáze `bpad`), a stanou se **dev**
daty. Ostrá `bpad.pro` startuje na čisté databázi `bpad-prod`.

### Změna v kódu (jediná)

`api/repository.py` má dnes jméno databáze napevno (`database="bpad"` v
konstruktorech, factory ho nepředává). Přidá se čtení proměnné
`COSMOS_DATABASE` (default `"bpad"`, tedy zpětně kompatibilní), kterou factory
předá všem třem Cosmos repozitářům (`notes`, `users`, `feedback`).

- dev: `COSMOS_DATABASE` nenastaveno → default `bpad`.
- prod: `COSMOS_DATABASE=bpad-prod`.

Frontend nepotřebuje sáhnout — produkční build míří na relativní `/api` u obou
domén (přepínač `import.meta.env.DEV` řeší jen lokální `npm run dev`).

### App settings per prostředí

| Env var | dev (`bpad`) | prod (`bpad-prod`) |
|---|---|---|
| `COSMOS_CONNECTION_STRING` | (stejný) | (stejný) |
| `COSMOS_DATABASE` | *(unset → `bpad`)* | `bpad-prod` |
| `SESSION_SIGNING_KEY` | dev klíč | **jiný** prod klíč |
| `POW_DIFFICULTY` | `0` (snadná registrace testů) | `20` (default) |
| `ALLOWED_ORIGIN` | `https://dev.bpad.pro` | `https://bpad.pro` |
| `APP_BASE_URL` | `https://dev.bpad.pro` | `https://bpad.pro` |
| `ACS_CONNECTION_STRING` / `EMAIL_SENDER` | *(unset → maily se jen logují)* | nastaveno (`bpad-comms`) |
| `FEEDBACK_EMAIL` | *(volitelně unset)* | nastaveno |

Dev záměrně nemá ACS nastavené, aby testovací registrace neposílaly reálné
verifikační e-maily — odkaz se jen zaloguje.

### Deploy workflows a větve

- **Existující workflow** (`...green-bay-...yml`, token
  `AZURE_STATIC_WEB_APPS_API_TOKEN_GREEN_BAY_04C7F9003`) → přepnout trigger z
  `master` na `dev`. Tenhle SWA je nadále dev, DB zůstává `bpad`.
- **Nový prod workflow** (`azure-static-web-apps-prod.yml`) → trigger na
  `master`, nový secret `AZURE_STATIC_WEB_APPS_API_TOKEN_PROD` (deploy token
  nového SWA `bpad-prod`).
- PR previews: proti bázi `dev`.

### Vývojový flow (každodenní)

1. feature větev z `dev`
2. PR → `dev` → vznikne preview env, review
3. merge do `dev` → auto-deploy **dev.bpad.pro**, otestuješ naživo
4. když je to stabilní: PR/merge `dev` → `master` → auto-deploy **bpad.pro**

## Postup zavedení (cutover)

Rozděleno na **lokální/kódové kroky** (dělá Claude) a **Azure/DNS kroky** (dělá
Jan pod osobním Azure účtem `jan.machacek@hotmail.com`, `az login`).

### Fáze 1 — příprava v kódu (Claude, bezpečné, nic nenasazuje)

1. Srovnat trunk: `master` fast-forward na `feature/two-pane-notes-layout`
   (lokálně).
2. `COSMOS_DATABASE` do `api/repository.py` + test.
3. Workflowy: existující přepnout na `dev`, přidat prod workflow (master).
4. Vytvořit větev `dev` z `master`.
5. Spec + tento runbook, commit.

### Fáze 2 — Azure příprava (Jan, PŘED pushem masteru)

6. Vytvořit nový SWA `bpad-prod` (free tier, resource group `bpad-rg`).
7. Deploy token nového SWA uložit jako GitHub secret
   `AZURE_STATIC_WEB_APPS_API_TOKEN_PROD` v repu `garnetstar/bpad`.
8. Nastavit app settings nového SWA dle tabulky (prod sloupec), včetně
   `COSMOS_DATABASE=bpad-prod` a nového `SESSION_SIGNING_KEY`.
9. Na existujícím SWA `bpad` doplnit/upravit dev app settings (`POW_DIFFICULTY=0`,
   `ALLOWED_ORIGIN`/`APP_BASE_URL` na `dev.bpad.pro`, případně odebrat ACS).
10. DNS: `bpad.pro` (apex + `www`) nasměrovat na nový SWA a přidat custom doménu.
    `dev.bpad.pro` zůstává beze změny na existujícím SWA.

### Fáze 3 — push a ověření

11. Push větve `dev` → existující SWA nasadí `dev.bpad.pro` z `dev`.
12. Push `master` → prod workflow nasadí `bpad.pro`.
13. Ověřit: registrace/login na obou doménách, že prod běží nad prázdnou
    `bpad-prod` a dev nad `bpad` se stávajícími daty.

## Rizika a rozhodnutí

- **Ostrá databáze startuje prázdná** — žádná migrace dat z `bpad`. Vědomé
  rozhodnutí (stávající data jsou testovací → dev).
- **Push masteru je deploy** — proto se master pushuje až po Fázi 2, kdy existuje
  prod SWA i jeho secret. Jinak prod job spadne na chybějícím tokenu.
- **Dva různé `SESSION_SIGNING_KEY`** → session z dev neplatí na prod a naopak.
  Očekávané, prostředí mají oddělené uživatele i data.
- Obě SWA jsou na free tieru; dvě free SWA resource jsou v pořádku, custom domény
  free tier povoluje.

## YAGNI / mimo rozsah

- Žádný oddělený Cosmos účet pro dev (izolace přes databázi stačí).
- Žádná migrace existujících dat.
- Žádné automatické promo tlačítko — promo je merge `dev` → `master`.
