# Biometrické odemykání trezoru (WebAuthn PRF)

**Datum:** 2026-07-11
**Status:** Schváleno

## Cíl

Na daném zařízení odemknout trezor **otiskem/Face ID** místo psaní hesla, aniž
by se heslo kamkoli uložilo v čitelné podobě. Využívá **WebAuthn PRF extension**:
biometrika odemkne stabilní tajný klíč vázaný na platform authenticator, kterým
je lokálně zašifrovaná kopie klíčů trezoru.

## Bezpečnostní model (a vědomý ústupek)

- Dnes: nic se neukládá, heslo/klíče žijí jen v paměti. Biometrika tenhle model
  **zeslabuje**: na zařízení přibude **šifrovaný balík** s `authKey` + `dataKey`,
  odemknutelný jen tímto zařízením + biometrikou.
- Balík je šifrovaný AES-256-GCM klíčem odvozeným z **PRF výstupu** (32 B), který
  vydá authenticator jen po ověření uživatele (biometrika). Bez zařízení i bez
  biometriky je balík bezcenný.
- Opt-in per zařízení. Platí jen lokálně. Heslo zůstává vždy jako fallback.

## Toky

### Enrollment (jednou, po přihlášení; auto-nabídka)
1. Uživatel je přihlášený → v paměti jsou `dataKey` i `authKey`.
2. `navigator.credentials.create` (platform authenticator, `userVerification:
   required`, `residentKey: required`, `extensions: { prf: {} }`).
3. Získat PRF tajemství: `navigator.credentials.get` s `prf.eval.first = SALT`
   (fixní app salt) → `results.first` (32 B) = `prfKey`.
4. `wrapped = AES-GCM(JSON{authKey, dataKey}, prfKey)`.
5. Uložit do `localStorage`: `{ username, credentialId, wrapped:{iv,ct} }`.
   → Nikdy se neukládá heslo, PRF klíč ani plaintext klíčů.

### Unlock (po každém otevření, když existuje enrollment)
1. Zobrazit „Odemknout otiskem" (+ odkaz „Zadat heslo místo toho").
2. `navigator.credentials.get` s `allowCredentials=[credentialId]` a
   `prf.eval.first = SALT` → `prfKey`.
3. `{authKey, dataKey} = AES-GCM-dec(wrapped, prfKey)`.
4. Re-login: `POST /auth/login {username, authVerifier: b64(authKey)}` → `token`.
5. `setSession(token, dataKey, authKey)` → trezor odemčen.
6. Selhání (401 = změněné heslo jinde / neplatný balík) → zapomenout enrollment,
   spadnout na přihlášení heslem s hláškou.

### Logout
Zamkne (vyprázdní paměťovou session), ale **enrollment v localStorage zachová**
→ příště zase otisk.

## Změny

**Frontend:**
- `session.ts` — držet i `authKey` (kvůli enrollmentu a re-loginu).
- `authApi.ts` — `setSession(token, dataKey, authKey)` ve všech tocích;
  `loginWithAuthKey(username, authKey)` pro re-login bez hesla.
- `webauthn.ts` — detekce dostupnosti, `enroll()` (create+PRF), `getPrfKey()`.
- `biometric.ts` — orchestrace + `localStorage` úložiště: `hasEnrollment`,
  `enroll`, `unlock`, `forget`.
- `BiometricUnlock.tsx` — odemykací obrazovka.
- `BiometricEnrollPrompt.tsx` — nabídka po přihlášení (auto, opt-in, s „teď ne"
  zapamatovaným v localStorage).
- `App.tsx` — brána: `!auth && hasEnrollment → Unlock`, jinak `AuthGate`;
  po přihlášení případně `EnrollPrompt`.

**Bez změny backendu** — re-login používá stávající `/auth/login`.

## Detaily
- PRF SALT: fixní `bpad-prf-v1`. rp.id = `location.hostname`. Challenge náhodný
  (assertion neověřuje server, PRF se používá lokálně).
- Feature detection: `PublicKeyCredential` +
  `isUserVerifyingPlatformAuthenticatorAvailable()`; při nedostupnosti feature
  skrýt.
- Vyžaduje secure context (HTTPS / localhost) — splněno.

## Testy
- **Unit (vitest):** wrap/unwrap balíku klíčů s injektovaným PRF klíčem
  (round-trip, špatný klíč selže).
- **E2E (puppeteer + CDP virtual authenticator s PRF):** enroll → „logout" →
  unlock otiskem → v trezoru; fallback na heslo. Když virtual authenticator PRF
  nepodpoří, ověřit aspoň strukturu volání + core logiku.

## Mimo rozsah
- Sync enrollmentu mezi zařízeními (je záměrně per-device).
- Více biometrických přihlášek na jeden účet/zařízení.
