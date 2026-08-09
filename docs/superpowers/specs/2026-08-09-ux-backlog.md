# UX backlog — co dělat po draftech a share targetu

Stav k 2026-08-09. Vzniklo z průchodu frontendem se zaměřením na to, „aby se to
příjemně používalo". Pět bodů celkem; **body 1 a 2 jsou hotové** (viz větev
`feature/draft-persistence-share-target`), zbylé tři čekají tady.

Pořadí je podle poměru dopad/práce a **je záměrné**: bod 3 je levný a odstraňuje
nevratnou ztrátu dat, bod 4 je největší kus práce, bod 5 je kosmetika, která ale
nejvíc mění pocit z aplikace na desktopu.

---

## 3. Mazání nemá záchrannou brzdu

**Problém.** `NoteDetail.tsx` potvrzuje smazání přes `window.confirm`, server pak
dělá tvrdé `delete_item` plus kaskádu na bloby obrázků
(`function_app.py` → `images_ops.cascade_delete_note`). Nativní dialog lidé
proklikávají bez čtení a **poznámka je nenávratně pryč** — ze zero-knowledge
principu ji neumí obnovit ani provozovatel. Je to jediné místo v aplikaci, kde
jedno chybné kliknutí způsobí trvalou ztrátu.

**Dvě varianty, od nejlevnější:**

1. **Undo toast.** Smazání se odloží o ~5 s, mezitím se v rohu nabídne „Vrátit".
   Žádná změna API ani datového modelu. Nechrání proti tomu, když uživatel
   zavře tab hned po smazání.
2. **Soft delete.** Pole `deleted_at` na poznámce, filtrování v `listNotes`,
   pohled „Koš" a čistka po 30 dnech. Chrání i po zavření tabu, ale znamená
   zásah do modelu, do reconciliation obrázků (smazaná poznámka **nesmí**
   uvolnit bloby dřív než při skutečné čistce) a do exportu záloh.

**Doporučení:** začít variantou 1, protože je hotová za hodinu a pokrývá
naprostou většinu reálných překliků. K variantě 2 sáhnout, až o ni někdo
skutečně požádá.

**Pozor:** ať se zvolí cokoli, `backupExport` musí dál exportovat jen živé
poznámky, jinak se smazané vzkřísí při prvním restore.

---

## 4. Offline jde jen číst

**Problém.** `session.ts:isOfflineReadOnly()` (dataKey bez tokenu) vypíná
zápis; `Home.tsx` v tom režimu vůbec nevykreslí composer. Cache
(`offlineCache.ts`) drží ciphertext poznámek pro čtení. Jenže moment, kdy si
člověk potřebuje něco zapsat, je typicky metro, výtah nebo letadlo — tedy
přesně offline. Pro aplikaci, která se profiluje jako „nejrychlejší cesta od
myšlenky k poznámce", je tohle nejcitelnější díra.

**Návrh.** Fronta odložených zápisů:

- Nová poznámka offline se zašifruje datovým klíčem a uloží do fronty
  v localStorage (stejná posture jako `draftStore.ts` — na disku jen ciphertext).
- Po obnovení připojení se fronta odešle jedna položka po druhé, stejným
  best-effort způsobem jako `backupImport.ts` (jedno selhání nesmí zastavit
  zbytek).
- `created_at` posílá klient — endpoint `notes` to už umí kvůli restore záloh,
  takže offline poznámka si udrží čas vzniku a nepřeskládá se v seznamu.
- Cache se aktualizuje hned (`upsertCachedNote`), aby byla poznámka vidět
  okamžitě, s vizuálním příznakem „čeká na odeslání".

**Otevřené otázky, které je potřeba rozhodnout před implementací:**

- **Editace existující poznámky offline** — konflikt s verzí na serveru řešit
  jak? Nejlevnější poctivá odpověď: offline povolit jen *vytváření*, editaci
  nechat zamčenou. Vyhne se to celé konfliktové logice.
- **Obrázky offline** — upload jde přes krátkodobou SAS URL, tu offline získat
  nelze. Buď zakázat vkládání obrázků do offline poznámky, nebo držet bajty ve
  frontě a uploadovat je až při flushi (a přepsat `bpad-img:` reference, stejná
  mechanika jako v `backupImport.ts`).
- **Kdy flush spustit** — `online` event je nespolehlivý; lepší je zkusit to při
  každém úspěšném volání API plus jednou při startu.

**Odhad:** největší položka ze tří, klidně 2–3 dny i s testy. Bez rozhodnutí
o obrázcích do toho nemá smysl jít.

---

## 5. Klávesové zkratky a stav uložení

**Problém.** Jediná zkratka v aplikaci je `Ctrl/Cmd+Enter` v editoru
(`Editor.tsx:handleKeyDown`). Na desktopu, kde je layout dvousloupcový a člověk
má ruce na klávesnici, to působí nedodělaně.

**Návrh — globální zkratky** (jeden listener, ideálně v `App.tsx`, ignorovat je
když je fokus v `input`/`textarea`):

| Klávesa | Akce |
|---|---|
| `n` | nová poznámka (rozbalit composer / fokus do editoru) |
| `/` | fokus do vyhledávání v `Home.tsx` |
| `Esc` | zavřít editor / zrušit hledání |
| `?` | přehled zkratek |

**Návrh — stav uložení.** Editor teď o uložení informuje jen textem v patičce
během ukládání. S přibytím autosave draftů (bod 1) dává smysl ukázat i „koncept
uložen", aby bylo vidět, že se rozepsaný text nikam neztratí — jinak o té
pojistce uživatel neví a nemůže jí věřit.

**Pozor:** `n` a `/` se nesmí chytat, když je otevřený lightbox obrázku
(`ImageLightbox.tsx`) — ten už `Esc` používá.

---

## Co se záměrně nedělá

- **Historie verzí** a **složky** (místo tagů) — zaznělo v r/NoteTaking jako
  požadavek, ale obojí je zásah do datového modelu a `docs/design-brief.md`
  drží aplikaci úmyslně plochou. Až bude poptávka.
- **Nativní desktopová appka** — PWA to pokrývá; Electron by popřel důvod, proč
  si lidi bpad vybírají.
