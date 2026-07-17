# Formulář pro zpětnou vazbu

**Datum:** 2026-07-17
**Status:** Schváleno

## Cíl

Dát přihlášeným uživatelům možnost poslat volným textem názor na aplikaci tak, aby
se zpráva **spolehlivě neztratila** a aby endpoint nešel zaspamovat roboty.

## Rozhodnutí

- **Jen pro přihlášené.** Session token je zároveň anti-spam opatření: robot by se
  musel nejdřív zaregistrovat, a registrace je už chráněná proof-of-work (`pow.py`)
  a ověřením e-mailu. Odpadá tím captcha i honeypot.
- **Cosmos jako zdroj pravdy + e-mail jen jako notifikace.** `mailer.py` polyká
  výjimky odesílání (`except Exception` → log, viz `mailer.py:46`). U verifikačního
  mailu je to správně, u feedbacku by to znamenalo, že každý výpadek ACS tiše zahodí
  zprávu: uživatel vidí „děkujeme“, majitel nedostane nic. Proto se zapisuje do
  Cosmosu **před** odesláním mailu a odpověď 201 se vrací až po potvrzeném zápisu.
- **Samostatný container `feedback`.** Účet `bpad-cosmos` je serverless
  (ověřeno 2026-07-17: `capabilities: [EnableServerless]`, dotaz na throughput
  odmítnut s „Reading or replacing offers is not supported for serverless
  accounts“, meter `Azure Cosmos DB serverless - RUs - EU West`). Container navíc
  tedy nemá žádnou fixní cenu — není důvod cpát nový typ dokumentu do stávajícího
  containeru přes `type` diskriminátor.
- **Feedback není šifrovaný.** Vědomá výjimka ze zero-knowledge modelu: zpráva je
  určená majiteli aplikace, zašifrovaná uživatelovým klíčem by byla nečitelná.
  UI to musí uživateli říct otevřeně.
- **Bez admin UI.** Čte se z notifikačního mailu a z Data Explorer v portálu.
  Admin stránka je YAGNI, dokud provoz neospravedlní její existenci.
- **Jen volný text.** Bez kategorií a hvězdiček — každé pole navíc snižuje počet
  odpovědí a při malém objemu se kategorie přečte z textu.

## Datový model (`api/models.py`)

```python
class Feedback(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str                    # username ze session tokenu
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FeedbackRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
```

E-mail se **neukládá**. Dohledá se přes `users_repo.get_user(username)` až ve
chvíli potřeby — jeden zdroj pravdy, žádná zamrzlá stará adresa po změně e-mailu.

Na rozdíl od `Note` tu nejsou pole `iv`/`ct`; viz rozhodnutí o nešifrování výše.

## Rozhraní repozitáře (`api/repository.py`)

Stejný vzor jako `notes` a `users`: Protocol + in-memory + Cosmos + factory.

```python
class FeedbackRepository(Protocol):
    def add_feedback(self, feedback: Feedback) -> None: ...
```

Rozhraní je úmyslně minimální — žádné `list_feedback()`, dokud ho nemá co volat.
Feedback se čte z Data Exploreru, ne přes API; čtecí metoda by byla mrtvý kód.

- `InMemoryFeedbackRepository` — fallback bez `COSMOS_CONNECTION_STRING`, používají
  ho testy. Uložené zprávy drží ve veřejném atributu `items: list[Feedback]`, aby
  na ně testy viděly bez čtecí metody v Protocolu.
- `CosmosFeedbackRepository` — container `feedback`, partition key `/user_id`
  (konzistentní s `notes`), líná inicializace klienta jako u ostatních repozitářů.
- `get_feedback_repository()` — factory podle `COSMOS_CONNECTION_STRING`.

## Endpoint (`api/function_app.py`)

```
POST /api/feedback
```

Pořadí operací je součástí návrhu:

1. `_require_user(req)` → 401, když chybí platný token
2. rate limit → 429
3. `FeedbackRequest(**req.get_json())` → 400 při prázdné/dlouhé zprávě
4. `feedback_repo.add_feedback(...)` → 500 při selhání
5. `users_repo.get_user(username)` kvůli e-mailu do notifikace (point-read, levný;
   selhání ani chybějící e-mail nesmí shodit request — notifikace se pošle bez něj)
6. best-effort notifikační mail (selhání se jen loguje)
7. `_json({"ok": True}, 201)`

Uživatel dostane potvrzení pouze tehdy, když je zpráva opravdu uložená.

## Anti-spam

| Vrstva | Opatření |
|---|---|
| Autentizace | `_require_user` — dědí PoW a e-mail verifikaci z registrace |
| Rate limit | **vlastní** `RateLimiter(max_calls=5, window_seconds=600)` |
| Délka | `max_length=4000` v Pydantic modelu |

Limiter je klíčovaný na **username**, ne na IP: uživatele známe, je to přesnější
a nepotrestá to sdílenou síť. Musí to být **samostatná instance**, ne sdílený
`_auth_limiter` — jinak by feedback ujídal kvótu přihlašování.

Známé omezení: `ratelimit.py` je per-instance a na serverlessu jen přibližný
(říká to sám v docstringu). Pro feedback to stačí — chrání před ujetým klientem
ve smyčce, ne před cíleným útokem, který u zavřeného endpointu nehrozí.

## Notifikační mail (`api/mailer.py`)

Nová funkce `send_feedback_notification(username, email, message)` vedle stávající
`send_verification_email`, stejný best-effort styl a stejný ACS resource
(`bpad-comms`).

- Adresát: nová app setting **`FEEDBACK_EMAIL`**. Když chybí, zpráva se jen zaloguje
  — stejný fallback, jaký dnes má `send_verification_email` bez `ACS_CONNECTION_STRING`.
- Tělo obsahuje username, e-mail uživatele (pro odpověď) a text zprávy.

## Frontend

- **`frontend/src/api.ts`** — `sendFeedback(message: string): Promise<void>`, POST
  na `/api/feedback` přes stávající hlavičkový helper (`X-Auth-Token`).
- **`frontend/src/Account.tsx`** — nová sekce ve stylu stávajících sekcí
  (`account-title` / `account-key`). Textarea + tlačítko Odeslat.
- Stavy: idle → sending (tlačítko disabled) → sent (poděkování) / error (chyba +
  možnost zkusit znovu). Při 429 vlastní hláška o počkání.
- **Bez nové routy**, `Account.tsx` je už v navigaci.
- **`frontend/src/i18n/en.ts`** — všechna copy přes `t()`, klíče `account.feedback*`.
  Součástí copy je věta, že tahle zpráva **není** end-to-end šifrovaná, na rozdíl
  od poznámek.

## Error handling

| Selže | Chování |
|---|---|
| Zápis do Cosmosu | `500`, uživatel vidí chybu a může zkusit znovu |
| Odeslání mailu | Spolknuto a zalogováno — feedback je uložený, ztratí se jen notifikace |
| Rate limit | `429` s vlastní hláškou |
| Prázdná / >4000 znaků | `400` |
| Chybí token | `401` |

## Testy / ověření

`api/test_feedback.py` (pytest, proti `InMemoryFeedbackRepository`):

- `add_feedback` uloží zprávu (test ji čte z `repo.items`)
- `FeedbackRequest` odmítne prázdnou zprávu i zprávu nad 4000 znaků, 4000 projde
- `RateLimiter(5, 600)` pustí 5 zpráv a šestou odmítne
- klíčování na username: dva uživatelé se navzájem neblokují

Ověření end-to-end lokálně: `func start` + `npm run dev`, odeslat zprávu bez
`COSMOS_CONNECTION_STRING` (in-memory) a zkontrolovat log s notifikací.

## Konfigurace

- Nová SWA app setting **`FEEDBACK_EMAIL`** (adresát notifikací). Bez ní feedback
  dál funguje a ukládá se, jen se notifikace loguje místo odeslání.
- Container `feedback` vznikne sám přes `create_container_if_not_exists`.

## Mimo rozsah

- Admin UI pro čtení feedbacku (čte se z mailu / Data Exploreru).
- Odpovídání uživateli z aplikace.
- Feedback od nepřihlášených návštěvníků z Landing page — vyžadovalo by PoW na
  veřejném endpointu, řešitelné později znovupoužitím `pow.py`.
- Kategorie, hodnocení, přílohy, screenshoty.
- Tvrdý rate limit na infra vrstvě (APIM / Front Door).
