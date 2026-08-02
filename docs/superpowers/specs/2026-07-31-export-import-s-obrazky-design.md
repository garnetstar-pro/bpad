# Export a import dat včetně obrázků — návrh

**Datum:** 2026-07-31
**Stav:** implementováno

## Cíl

Rozšířit zálohu (`backup.ts` a spol.) tak, aby zahrnovala i obrázky vložené do
poznámek. Dnes záloha nese jen text; odkaz `![](bpad-img:ID)` po obnovení do
jiného účtu ukazuje na obrázek, ke kterému nový účet nemá přístup — dokumentované
omezení fáze 1 obrázků (`2026-07-25-obrazky-vystrizky-design.md`).

Záloha má sloužit třem účelům zároveň:

1. **Archiv / disaster recovery** — kompletní kopie na disku pro případ ztráty
   hesla i recovery kódu.
2. **Přenos mezi účty bpadu** — export z jednoho účtu, import do druhého;
   obrázky se musí nahrát znovu a odkazy přepsat.
3. **Odchod z bpadu** — data v podobě, kterou otevře běžný nástroj bez bpadu.

## Rozhodnutí a jejich hranice

| Rozhodnutí | Volba |
|---|---|
| Kontejner | **ZIP** — `backup.json` + `images/` + `notes/` |
| Formát manifestu | Stávající JSON, `version: 2` |
| Šifrovaná záloha | Obrázky se šifrují týmž klíčem; složka `notes/` se vynechá |
| Čitelný export | `notes/*.md` s relativními odkazy — jen pro člověka, import ignoruje |
| Zpětná kompatibilita čtení | v1 `.json`/`.bpad` se otevírají dál |
| Zápis | Vždy v2 ZIP (i když poznámky žádné obrázky nemají) |
| Šifrování obrázků na serveru | **Mimo scope** — vlastní návrh (viz „Vztah k šifrování blobů") |

## Formát v2

```
bpad-backup-2026-07-31.zip
├─ backup.json           ← zdroj pravdy pro import
├─ images/
│  ├─ abc-123.webp       ← plain režim
│  └─ def-456.webp
└─ notes/                ← jen pro člověka, import ho ignoruje
   ├─ 2026-07-12-nakup.md
   └─ 2026-07-30-recept.md
```

Šifrovaná varianta má místo `images/<id>.webp` soubory `images/<id>.bin`
a složku `notes/` neobsahuje vůbec.

Název souboru: `bpad-backup-YYYY-MM-DD.zip`, u šifrované zálohy
`bpad-backup-YYYY-MM-DD-enc.zip`. Přípona je v obou případech `.zip`, aby ho
operační systém uměl otevřít; o šifrování rozhoduje obsah, ne jméno.

### `backup.json` — plain

```json
{
  "format": "bpad-backup",
  "version": 2,
  "exported_at": "2026-07-31T09:12:00.000Z",
  "username": "jan",
  "encrypted": false,
  "notes": [
    { "title": "Recept", "content": "# Recept\n![](bpad-img:abc-123)",
      "url": null, "created_at": "…", "updated_at": "…", "tags": ["jidlo"] }
  ],
  "images": [
    { "id": "abc-123", "content_type": "image/webp",
      "size_bytes": 48210, "path": "images/abc-123.webp" }
  ]
}
```

Obsah poznámky se v manifestu **nikdy nemění** — odkaz zůstává `bpad-img:ID`.
Přepis na relativní cestu se děje jen v `notes/*.md`, které jsou odvozené.

### `backup.json` — šifrovaná

Hlavička zůstává jako dnes. Pole `images` se stěhuje **dovnitř šifrotextu**,
stejně jako dnes `notes`:

```json
{
  "format": "bpad-backup",
  "version": 2,
  "exported_at": "…",
  "username": "jan",
  "encrypted": true,
  "kdf": { "algorithm": "argon2id", "salt": "…", "iterations": 3,
           "memory_size": 65536, "parallelism": 1, "hash_length": 32 },
  "cipher": "AES-256-GCM",
  "iv": "…",
  "ct": "…"
}
```

Šifrotext je JSON `{ "notes": [...], "images": [...] }`. Bez hesla tak z manifestu
nejde vyčíst, kolik obrázků a jakých velikostí soubor nese (počet stejně
prozradí výpis ZIPu — cílem je konzistence s `notes`, ne utajení počtu).

Každý soubor `images/<id>.bin` je `iv(12 B) ‖ ct` pod **týmž** klíčem, který
`deriveBackupKey()` odvodí z hesla k záloze; každý obrázek má vlastní náhodné IV.
Argon2id se počítá **jednou** pro celý soubor, ne pro každý obrázek.

Složka `notes/` se v šifrovaném režimu negeneruje — jinak by čitelný markdown
vysypal ven přesně ten obsah, kvůli kterému uživatel heslo zadával.

### Zpětná kompatibilita

- **Čtení:** `openBackupFile(File)` očichá první čtyři bajty. `PK\x03\x04` → ZIP →
  rozbalit → `backup.json`. Cokoli jiného → přečíst jako text → dnešní
  `parseBackup()`. Staré `.json` i `.bpad` zálohy se tedy otevírají beze změny
  a chovají se jako v2 bez obrázků.
- **Zápis:** vždy v2 ZIP. Dva zápisové formáty vedle sebe nedávají smysl a `notes/`
  dělá i bezobrázkovou zálohu čitelnější, než je dnešní JSON.
- **Starý klient, nový soubor:** nasazená stará verze appky v2 ZIP nepřečte —
  spadne na `errors.backupUnreadable` (binární data nejsou JSON). Přijatelné:
  klient je PWA, která se sama aktualizuje, a záloha se čte hlavně na tomtéž
  zařízení. Kontrola `version > BACKUP_VERSION` (hláška „záloha je z novější
  verze") zůstává pro budoucí v3.

## Export

Nový modul `backupExport.ts` drží orchestraci, která dnes visí v `Account.tsx`:

1. `listNotes()` → poznámky (`api.ts` je vrací už dešifrované).
2. `parseImageIds()` (z `images.ts`) přes všechny obsahy → množina ID.
3. Sekvenčně `downloadImage(id)` → `Blob`, s progressem `(done, total)`.
   Sekvenčně ze stejného důvodu jako import: plochá zátěž a poctivý ukazatel.
4. Sestavit manifest; je-li zadané heslo, zašifrovat `{ notes, images }` a každý
   obrázek zvlášť.
5. Plain režim: vygenerovat `notes/*.md`.
6. Zabalit a stáhnout.

**Selhání stažení obrázku** je best-effort, stejně jako zbytek zálohovací cesty:
obrázek se do ZIPu ani do manifestu nedostane, export doběhne a nahlásí
„X obrázků se nepodařilo stáhnout". Odkaz v poznámce zůstává — ať je z obnovené
poznámky vidět, že tam obrázek byl.

### `notes/*.md`

- Jméno: `YYYY-MM-DD-<slug>.md` z `created_at` a titulku. Slug: NFD, zahodit
  diakritiku, malá písmena, ne-alfanumerické znaky na `-`, oříznout, max 50 znaků;
  prázdný titulek → `bez-nazvu`. Kolize → přípona `-2`, `-3`, …
- Hlavička YAML front-matter (`title`, `created`, `updated`, `tags`). `title`
  vždy v uvozovkách s escapovanými uvozovkami uvnitř — titulek může obsahovat
  cokoli.
- V těle `![](bpad-img:ID)` → `![](../images/ID.webp)`, přesněji `../` + `path`
  z manifestu (přípona se řídí `content_type`, ne pevným `.webp`). Odkaz na
  obrázek, který se nepodařilo stáhnout, zůstává v původní podobě.

## Import

Nový je pořádek: **nejdřív obrázky, potom poznámky.**

1. **Diff** proti vaultu (`diffAgainst`) → které poznámky se opravdu importují.
2. Z **těchto** poznámek posbírat ID obrázků. Obrázky, které patří jen
   duplicitním poznámkám, se nenahrávají.
3. Pro každé ID: vytáhnout ze ZIPu, v šifrovaném režimu dešifrovat,
   `uploadImage(blob)` → mapa `staréID → novéID`. Sekvenčně, s progressem.
4. V obsahu poznámky přepsat `bpad-img:` odkazy podle mapy. ID, které v ZIPu
   chybí nebo se nenahrálo, se **nechá být** — poznámka se naimportuje s mrtvým
   odkazem. Částečný restore je lepší než žádný.
5. `createNote(content, tags, { title, createdAt })`. `image_ids` si `api.ts`
   parsuje z obsahu sama, takže po přepisu server nové obrázky claimne a líný GC
   je po 24 h nesmete. **API se nemění.**

### Deduplikace se musí opravit

Dnešní identita poznámky je `created_at + content` (`identity()` v `backup.ts`).
Po přepisu ID obrázků se obsah liší → druhý import téhož souboru by vyrobil
duplikáty a nahrál obrázky znovu.

Oprava: identitu počítat z **normalizovaného** obsahu — každý výskyt
`bpad-img:<cokoliv>` nahradit pořadovým `bpad-img:#1`, `bpad-img:#2`, … podle
pořadí v textu. Poznámka „Recept" s jedním obrázkem má pak stejnou identitu před
i po importu, dvojí import je no-op a poznámek bez obrázků se změna nedotkne.

Normalizace se aplikuje na **obě** strany porovnání (existující i příchozí).

### Rate limit uploadu — reálná překážka

`POST /api/images` má per-user sliding window **60 uploadů / 600 s**
(`_image_limiter`). Vault s dvěma stovkami obrázků se do jednoho běhu nevejde.

Chování: narazí-li nahrávání na limit, **zastaví se celý import** — nový stav
`stoppedByLimit: 'images'` v `ImportSummary` — a souhrn řekne, co se stihlo a že
zbytek půjde za pár minut. Zastavit celý import, ne jen obrázkovou fázi: kdyby
se poznámky uložily s mrtvými odkazy, dedup by je při opakování přeskočil a
obrázky by se do nich už nikdy nedoplnily.

Import zůstává **idempotentní** — opakované spuštění dojede zbytek.

## Frontend

- **`Account.tsx`** (export): dvoufázový průběh — „stahuji obrázky 3/12", pak
  „balím". Hlášení o nestažených obrázcích.
- **`Restore.tsx`** (import): `accept` rozšířit o `.zip`; průběh „nahrávám
  obrázky 5/30" před dnešním „importuji poznámky 12/40". Souhrn rozšířit
  o obrázky a o `stoppedByLimit: 'images'`.
- **Prohlížeč zálohy zůstává textový** (`<pre>{content}</pre>`, jako dnes) —
  jen v souhrnu přibude počet obrázků v souboru. Renderování obrázků ze ZIPu
  bez přihlášení je mimo scope.
- Všechny nové texty přes `t()` do `i18n/en.ts`, nic natvrdo.

## Členění modulů

| Soubor | Role | Závislosti |
|---|---|---|
| `imageRefs.ts` *(nový)* | schéma `bpad-img:` — `parseImageIds`, `rewriteImageRefs`, `normalizeImageRefs` | čisté |
| `backupZip.ts` *(nový)* | balení/rozbalení nad `Uint8Array`, sniff ZIPu | fflate |
| `backup.ts` | typy v2, manifest, šifrování manifestu, normalizovaná identita | čisté |
| `backupArchive.ts` *(nový)* | sestavení a čtení celého archivu (manifest + obrázky + `notes/`) | čisté |
| `backupMarkdown.ts` *(nový)* | `notes/*.md` — slug, front-matter, relativní odkazy | čisté |
| `backupExport.ts` *(nový)* | orchestrace exportu (síť + progress) | `api.ts`, `images.ts` |
| `backupFile.ts` | download Blobu, `openBackupFile()` se sniffem ZIP/JSON | DOM |
| `backupImport.ts` | dvoufázový import | `api.ts`, `images.ts` |
| `images.ts` | + `downloadImage(id): Promise<Uint8Array>` | — |
| `crypto.ts` | + `sealBytes` / `openBytes` (raw bajty, IV v prvních 12 B) | — |

`imageRefs.ts` vzniká proto, že `images.ts` tahá `session.ts` a síť; formátové
moduly musí zůstat čisté. `images.ts` `parseImageIds` re-exportuje, takže se
stávajících importérů (`api.ts`) změna nedotkne.

Dělení drží dnešní pravidlo: formátová logika je čistá a testovatelná bez
prohlížeče, síť a DOM žijí v samostatných modulech.

### Nová závislost

**fflate** (~8 kB min+gzip, bez tranzitivních závislostí). Použít **synchronní**
`zipSync` / `unzipSync`. Asynchronní varianta si v prohlížeči zakládá Worker
z `blob:` URL, což naše CSP (`worker-src 'self'` ve `staticwebapp.config.json`)
zablokuje — v produkci by tedy nefungovala. Zablokování hlavního vlákna je při
osobním měřítku (jednotky MB, `level: 0` na obrázcích) v řádu desetin sekundy;
export i tak běží za progress indikátorem kvůli stahování obrázků.

Komprese: JSON a markdown normálně, `images/*` s `level: 0` — WebP i šifrotext
jsou nestlačitelné, komprese by jen pálila čas.

## Testy

Suita běží v čistém Node bez jsdom, takže se testuje nad `Uint8Array`
a případné `document`/`Blob` se stubuje (vzor `api.test.ts`, `backupFile.test.ts`).

- ZIP round-trip: zabalit → rozbalit → identická data.
- v2 plain: serializace → parsování, včetně `images` manifestu.
- v2 šifrovaná: round-trip s obrázky; špatné heslo selže na manifestu.
- v1 `.json` soubor se pořád načte a chová jako v2 bez obrázků.
- `rewriteImageRefs()`: přepis podle mapy, chybějící ID zůstane nedotčené,
  odkaz mimo `bpad-img:` se nemění.
- Normalizovaná identita: tentýž ZIP dvakrát → druhý běh nemá co importovat.
- `notes/*.md`: slug z diakritiky, kolize jmen, escapovaný titulek,
  relativní odkazy.
- Import: obrázky se nahrají před poznámkami; selhání jednoho obrázku
  poznámku nezastaví; dosažení rate-limitu vrátí `stoppedByLimit: 'images'`.

## Vztah k šifrování blobů (mimo scope)

Obrázky jsou dnes v blobu **nešifrované** (vědomé zjednodušení fáze 1). Přechod
na klientské šifrování je samostatný návrh a s tímhle se **nekříží**: klient klíč
má, takže do ZIPu se vždy zapisuje dešifrovaný WebP a při importu se zašifruje
klíčem cílového účtu. Ať se bloby zašifrují dřív nebo později, tenhle formát
se nemění.

## Vědomé hranice (out of scope)

| Oblast | Rozhodnutí |
|---|---|
| Šifrování obrázků na serveru | vlastní návrh |
| Zobrazení obrázků v prohlížeči zálohy bez účtu | ne — `<pre>` jako dnes |
| Zvýšení rate-limitu uploadu kvůli restoru | ne — import se zastaví a pokračuje později |
| Import `notes/*.md` zpátky | ne — složka je jednosměrná, zdroj pravdy je `backup.json` |
| Inkrementální / rozdílová záloha | ne — export je vždy kompletní |
| Sdílení jednoho blobu mezi poznámkami | dědí se omezení fáze 1 obrázků |
