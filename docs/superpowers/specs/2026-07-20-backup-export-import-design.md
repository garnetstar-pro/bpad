# Záloha a obnova poznámek (export / import)

Datum: 2026-07-20

## Motivace

Uživatel se bojí ztráty přístupu ke svým datům. Pro ztrátu hesla samotného už
existuje recovery kód (viz `authApi.ts`, `recover()`), ale ten nepokrývá:

- ztrátu hesla *i* recovery kódu,
- ztrátu účtu nebo zánik služby,
- omylem smazané poznámky.

Řešením je záloha, kterou si uživatel stáhne a uloží mimo aplikaci (např. na USB),
a která jde zase obnovit. Dešifrování i šifrování probíhá výhradně v prohlížeči;
server o záloze neví a nic se v něm kvůli ní nemění.

## Rozhodnutí

1. **Dvě varianty exportu.** Chráněná passphrase (výchozí) a nešifrovaná
   (za varováním). Chráněná kryje běžné riziko „flashka se válí v šuplíku“,
   nešifrovaná kryje „chci se ke svým datům dostat i za deset let bez bpadu“.
2. **Obnova je zároveň offline čtečka.** Stránka `/restore` soubor otevře
   a zobrazí bez účtu a bez serveru. Import do účtu je nad ní tenká vrstva,
   nabídnutá jen přihlášenému uživateli s odemčeným trezorem.
3. **Deduplikace na klientovi**, ne zachování ID. `id` je serverové a při
   obnově do nového účtu bezcenné.
4. **Jeden formát: JSON.** Markdown/ZIP export je jiná potřeba (přenos do jiného
   nástroje) a případný pozdější přírůstek.
5. **Bez standalone dešifrovacího nástroje.** Scénář „bpad neexistuje“ pokrývá
   nešifrovaná varianta; formát je níže zdokumentovaný tak, aby šel dešifrovat
   nezávislou implementací.

## Formát souboru

### Nešifrovaná varianta — `bpad-backup-YYYY-MM-DD.json`

```json
{
  "format": "bpad-backup",
  "version": 1,
  "exported_at": "2026-07-20T10:15:00Z",
  "username": "jan",
  "encrypted": false,
  "notes": [
    {
      "title": "…",
      "content": "…",
      "url": null,
      "created_at": "2026-07-12T08:00:00Z",
      "updated_at": "2026-07-12T09:30:00Z",
      "tags": ["…"]
    }
  ]
}
```

Pole `id` se záměrně **nezapisuje**.

### Chráněná varianta — `bpad-backup-YYYY-MM-DD.bpad`

```json
{
  "format": "bpad-backup",
  "version": 1,
  "exported_at": "2026-07-20T10:15:00Z",
  "username": "jan",
  "encrypted": true,
  "kdf": {
    "algorithm": "argon2id",
    "salt": "<base64, 16 B>",
    "iterations": 3,
    "memory_size": 65536,
    "parallelism": 1,
    "hash_length": 32
  },
  "cipher": "AES-256-GCM",
  "iv": "<base64, 12 B>",
  "ct": "<base64>"
}
```

`ct` je AES-256-GCM šifrovaný UTF-8 JSON `{ "notes": [ … ] }` — tedy tělo
nešifrované varianty bez hlavičky. Klíč vzniká jako
`Argon2id(passphrase, salt, parametry z pole kdf)`, přímo, **bez HKDF** —
záloha nepotřebuje odvozovat dvojici enc/auth klíčů jako přihlášení.
Parametry Argon2 jsou v souboru, ne v kódu, aby zvýšení náročnosti v aplikaci
nezneplatnilo staré zálohy.

Hlavička zůstává v plaintextu i u chráněné varianty, aby šel soubor
identifikovat bez hádání.

## Moduly

| Modul | Odpovědnost |
|---|---|
| `frontend/src/backup.ts` | Čistá logika: serializace, šifrování, parsování, dedup. Bez UI a bez sítě. |
| `frontend/src/backupFile.ts` | Stažení souboru a načtení `File` (Blob, `URL.createObjectURL`, `FileReader`). |
| `frontend/src/Account.tsx` | Sekce „Záloha“ — export. |
| `frontend/src/Restore.tsx` | Stránka `/restore` — čtečka + volitelný import. |
| `frontend/src/i18n/en.ts` | Nové překladové klíče. |

Rozhraní `backup.ts`:

```ts
serializeBackup(notes: Note[], meta: { username: string }): BackupFile
encryptBackup(backup: BackupFile, passphrase: string): Promise<BackupFile>
parseBackup(text: string): BackupFile          // validuje, rozliší plain/chráněné
decryptBackup(file: BackupFile, passphrase: string): Promise<BackupNote[]>
diffAgainst(existing: Note[], incoming: BackupNote[]): { toImport: BackupNote[]; duplicates: BackupNote[] }
```

Duplicita = shodné `created_at` **a** shodné `content`.

V `api/` se nemění nic. Import používá stávající `POST /api/notes`, které už
volitelné klientské `created_at` přijímá (`function_app.py:379`), takže datumy
vzniku zůstanou zachované. `updated_at` server přepíše — to je přijatelné.

## Tok — export

1. Vyžaduje odemčený trezor. Zamčený trezor → výzva k odemčení místo tlačítka.
2. `listNotes()` vrátí dešifrované poznámky. Bez sítě spadne na offline cache;
   UI to označí („zálohuji offline kopii, N poznámek“).
3. Volba varianty:
   - **Chráněné heslem** (předvybráno): dvě pole na passphrase s potvrzením,
     minimum 12 znaků, indikátor síly, explicitní upozornění, že to není
     přihlašovací heslo a že ho nelze obnovit.
   - **Nešifrované**: checkbox s varováním, tlačítko je do jeho odkliknutí zakázané.
4. `serializeBackup` → volitelně `encryptBackup` → stažení.

## Tok — obnova (`/restore`)

Stránka je dostupná i nepřihlášenému uživateli.

1. Drop zóna nebo výběr souboru → `parseBackup`. Varianta se pozná z pole
   `encrypted`, ne z přípony.
2. Chráněný soubor → dotaz na passphrase → `decryptBackup`.
3. **Náhled**: počet poznámek, rozsah datumů, seznam titulků, rozklikávací obsah.
   Tohle je čtečka — funguje bez účtu i bez serveru.
4. Přihlášený uživatel s odemčeným trezorem vidí navíc panel „Importovat do účtu“:
   - `listNotes()` → `diffAgainst` → souhrn „12 nových, 240 už máš“ + potvrzení,
   - sekvenční `createNote()` s ukazatelem `n/celkem`,
   - selhání jedné poznámky import nezastaví; na konci souhrn
     („238 importováno, 2 selhaly“). Opakované spuštění je díky dedupu bezpečné.
   - **403 z limitu neověřeného účtu** (`_UNVERIFIED_NOTE_LIMIT = 10`,
     `function_app.py:22`) se odchytí zvlášť: import se zastaví s hláškou
     „ověř e-mail a spusť import znovu“ místo série selhání.
5. Nepřihlášený uživatel vidí místo panelu odkaz na přihlášení s vysvětlením.

Sekvenční import není vynucený rate limitem — `POST /api/notes` limitovaný není
(limiter běží jen na `auth/*` a feedbacku) — ale drží spotřebu Cosmos RU nízko
a umožňuje smysluplný ukazatel průběhu.

## Chybové stavy

Každý má vlastní hlášku přes `t()`:

- nečitelný / nevalidní JSON,
- chybějící nebo neznámé `format`,
- `version` z budoucnosti (větší než podporovaná),
- nesprávná passphrase (selhaný GCM tag) — odlišeno od poškozeného souboru,
- poškozený `ct` při správné passphrase,
- zamčený trezor při exportu nebo importu,
- prázdná záloha (nula poznámek),
- částečné selhání importu,
- 403 z limitu neověřeného účtu.

Rozlišení „špatná passphrase“ vs. „poškozený soubor“: obojí se z Web Crypto
projeví jako selhání dešifrování. Hlásí se primárně jako nesprávná passphrase
s dovětkem, že soubor může být i poškozený.

## Testy

Těžiště v `frontend/src/backup.test.ts` (čistý modul, bez prohlížeče):

- round-trip nešifrované varianty,
- round-trip chráněné varianty,
- chybná passphrase vyhodí chybu,
- poškozený `ct` vyhodí chybu,
- odmítnutí neznámého `format` a budoucí `version`,
- `diffAgainst`: prázdný cíl, úplný překryv, částečný překryv, stejný obsah
  s jiným `created_at` = ne-duplikát,
- prázdný seznam poznámek.

Dále test sekvenčního importu s injektovaným selháním uprostřed: import
pokračuje a souhrn sedí; a test, že 403 z limitu import zastaví.

## Co je mimo rozsah

- Export do Markdownu / ZIPu.
- Standalone offline dešifrovací HTML.
- Automatické nebo plánované zálohy.
- Skutečná synchronizace se zachováním `id` a řešením konfliktů.
