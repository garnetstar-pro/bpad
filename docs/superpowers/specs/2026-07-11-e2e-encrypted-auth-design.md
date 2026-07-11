# Přihlašování a end-to-end šifrovaný trezor poznámek

**Datum:** 2026-07-11
**Status:** Návrh k revizi

## Cíl a bezpečnostní model

Multi-user aplikace, kde jsou poznámky **čitelné jen pro majitele**. Server,
Azure, Cosmos DB, provozovatel ani žádná třetí strana (Google, síť) **nesmí
vidět obsah**. Heslo ani šifrovací klíč se nikam neukládají — žijí jen v paměti
prohlížeče. Ztráta hesla je řešitelná jednorázovým **recovery kódem**.

**Threat model — co chráníme:** důvěrnost obsahu i názvů poznámek proti komukoli
kromě majitele (včetně provozovatele serveru = zero-knowledge).
**Co NEchráníme (přijaté úniky metadat):** server vidí, že uživatel *X* existuje,
kolik má poznámek, jejich velikost a časy. To je nevyhnutelné, pokud server není
úplně slepý; obsah zůstává skrytý.

**Zásada:** žádná vlastní kryptografie. Používáme jen prověřené primitivy a
osvědčený vzor (à la Bitwarden). Po dokončení projde kód security reviewem.

## Kryptografické primitivy

- **KDF:** Argon2id (přes `hash-wasm`), parametry: 64 MB paměť, 3 iterace,
  paralelismus 1, sůl 16 B. Běží ve Web Workeru (neblokuje UI).
- **Odvození podklíčů:** HKDF-SHA-256 (nativní Web Crypto).
- **Symetrická šifra:** AES-256-GCM (Web Crypto), náhodné 96b IV na každou
  operaci, 128b tag.
- **Náhoda:** `crypto.getRandomValues`.
- **Session token:** podepsaný JWT (HS256) serverovým tajemstvím
  (`SESSION_SIGNING_KEY`), krátká platnost (8 h).

## Klíčová architektura: obalený „data key"

Poznámky nešifruje přímo heslo, ale náhodný **`dataKey`** (32 B). Ten se ukládá
**obalený** (zašifrovaný) dvakrát — heslem a recovery kódem. To umožní recovery
i změnu hesla bez přešifrování poznámek.

### Odvození z hesla (v prohlížeči)
```
masterKey     = Argon2id(heslo, salt)
encKey        = HKDF(masterKey, info="enc")   # obaluje dataKey, neopouští klienta
authKey       = HKDF(masterKey, info="auth")  # důkaz identity serveru
```
Analogicky z recovery kódu: `recEncKey`, `recAuthKey` (z `recoverySalt`).

## Toky

### Registrace (klient generuje, server jen ukládá)
1. `salt`, `recoverySalt` = náhodné. Vygeneruje se **recovery kód**
   (≥128 b entropie, čitelný formát; ukáže se **jednou**).
2. Odvodí `encKey/authKey` (z hesla) a `recEncKey/recAuthKey` (z recovery kódu).
3. `dataKey` = 32 náhodných B.
4. `wrappedDataKey_pw`  = AES-GCM(dataKey, encKey)
   `wrappedDataKey_rec` = AES-GCM(dataKey, recEncKey)
5. `POST /auth/register` pošle: `username`, `salt`, `recoverySalt`,
   `authVerifier` (= authKey), `recAuthVerifier` (= recAuthKey),
   `wrappedDataKey_pw`, `wrappedDataKey_rec`.
   Server ukládá **salted hash** obou verifierů (ne raw), zbytek jak přišel.
   → Server nikdy nevidí heslo, recovery kód, `encKey`, `dataKey`.

### Přihlášení
1. `GET /auth/salt?username=` → `salt` (viz enumerace níže).
2. Klient odvodí `masterKey → authKey`.
3. `POST /auth/login {username, authKey}` → server ověří proti hashi →
   vrátí `token` (JWT), `salt`, `wrappedDataKey_pw`.
4. Klient dešifruje `dataKey` pomocí `encKey`. **`dataKey` drží jen v paměti.**

### Práce s poznámkami
- Payload `{title, content, url}` se zašifruje `dataKey` (AES-GCM) v prohlížeči.
- Uloží se `{ id, userId, iv, ciphertext, created_at }`. `title`/`content`
  v čitelné podobě na serveru **neexistují**.
- Odvození titulku (`extract_title`) a hledání se dělá **na klientovi** po
  dešifrování.

### Recovery (zapomenuté heslo)
1. `GET /auth/recovery-salt?username=` → `recoverySalt`.
2. Klient z recovery kódu odvodí `recAuthKey/recEncKey`.
3. `POST /auth/recover {username, recAuthKey, newSalt, newAuthVerifier,
   newWrappedDataKey_pw}` — server ověří `recAuthKey`, klient mezitím odemkl
   `dataKey` přes `recEncKey` a přebalil ho novým `encKey`. Server vymění
   heslový materiál. Poznámky se nepřešifrovávají.

### Změna hesla
Přihlášený klient odvodí nový `encKey/authKey`, přebalí `dataKey`, pošle
`POST /auth/change-password` s novým materiálem.

## Datový model (Cosmos)

- Nový kontejner **`users`** (partition `/username`):
  `username, salt, recoverySalt, authHash, recAuthHash,
   wrappedDataKey_pw, wrappedDataKey_rec`.
- Kontejner **`notes`** (partition `/userId`):
  `id, userId, iv, ciphertext, created_at`. (Ruší se plaintext `title/content/url`.)

## API

**Auth (veřejné, rate-limited):**
`POST /auth/register`, `GET /auth/salt`, `POST /auth/login`,
`GET /auth/recovery-salt`, `POST /auth/recover`, `POST /auth/change-password`.

**Poznámky (vyžadují platný `Authorization: Bearer <JWT>`):**
Stávající `GET/POST/GET{id}/PUT{id}/DELETE{id} /notes`, ale scoped na `userId`
z tokenu. Middleware ověří podpis + expiraci a vloží `userId`.

## Hardening (mimo krypto)

- Zrušit `Access-Control-Allow-Origin: *` → jen vlastní origin.
- **CSP** hlavička (self only; blokuje jakékoli externí volání — žádná Google
  Analytics, žádné CDN; bundle je inline). Skrz `staticwebapp.config.json`
  `globalHeaders`.
- `X-Robots-Tag: noindex` + `robots.txt` (Disallow: /).
- Rate-limit na `/auth/*` (ochrana proti brute-force a spamu účtů).
- Session JWT krátkodobý; logout = zahození tokenu i `dataKey` z paměti.

## Přesun na klienta
- `extract_title` / `resolve_title` a `contentWithoutTitleHeading` → TypeScript
  (server na obsah nevidí). Backend title logika pro poznámky se odstraní.
- Hledání (`filterNotes`) už je klientské — beze změny (běží nad dešifrovanými).

## Migrace
Stávající plaintext poznámky v Cosmosu: jednorázově **smazat** (osobní data,
zatím minimum) — čistý start s šifrovaným modelem. (Alternativa: skript, který
je po přihlášení zašifruje; nedoporučeno kvůli složitosti.)

## Testy / ověření

- **Krypto vrstva (unit):** round-trip encrypt/decrypt; wrap/unwrap `dataKey`
  heslem i recovery; determinismus KDF (stejné heslo+sůl → stejný klíč); špatné
  heslo/recovery → selhání dešifrování.
- **Auth backend (unit/integrace):** register (konflikt username), login
  (správný/špatný authKey), recover, change-password; ochrana `/notes` bez
  tokenu → 401; scoping (uživatel A nevidí poznámky B).
- **E2E:** register → vytvoř poznámku → odhlásit → přihlásit → dešifruj; recovery
  tok. Proti Cosmos emulátoru a přes prohlížeč (puppeteer).
- **Negativní:** server nikdy nevrací plaintext (kontrola, že v DB je jen šifra).

## Fázovaná implementace
- **F1** Klientská krypto vrstva (`crypto.ts`) + testy.
- **F2** Auth backend: `users` repo, endpointy, JWT middleware + testy.
- **F3** UI: registrace (+ zobrazení recovery kódu), login, recovery, session
  stav (`dataKey` v paměti), route guard.
- **F4** Šifrování poznámek end-to-end; přesun titulku na klienta; scoping na
  `userId` + testy.
- **F5** Hardening (CSP, CORS, noindex, rate-limit) + security review.
- **F6** Migrace (smazání starých plaintext dat).

## Otevřená rizika / mimo rozsah
- **Bezpečnostně kritické** — vyžaduje pečlivé review; držet se přesně tohoto
  vzoru.
- Enumerace uživatelů: `GET /auth/salt` prozradí existenci účtu. Zmírnění:
  vracet deterministickou „falešnou" sůl pro neexistující username. (Otevřená
  registrace stejně existenci účtu odhaluje.)
- Revokace tokenů: stateless JWT nejde předčasně zneplatnit (jen expirací).
  Přijato pro jednoduchost; lze doplnit „token version" v `users`.
- XSS = kompromitace klienta (útočník by viděl `dataKey` v paměti). Bráníme
  přísnou CSP a tím, že nerenderujeme syrové HTML (react-markdown bez `rehype-raw`).
- Argon2id parametry laditelné dle výkonu cílových zařízení.
