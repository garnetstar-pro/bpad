# Feedback Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in users send a free-text opinion about the app, stored durably in Cosmos DB with a best-effort e-mail notification to the owner.

**Architecture:** A new `POST /api/feedback` endpoint authenticated by the existing session token. Feedback is written to a new Cosmos container through a repository following the established `Protocol` + `InMemory*` + `Cosmos*` + factory pattern, **before** a best-effort notification e-mail is attempted — `mailer.py` swallows send failures, so e-mail must never be the only record. Anti-spam is inherited from auth (registration already costs a proof-of-work) plus a dedicated per-username rate limiter.

**Tech Stack:** Python 3.12 / Azure Functions + Pydantic (`api/`); React + Vite + TypeScript (`frontend/`); pytest (api tests), vitest (frontend tests).

**Spec:** `docs/superpowers/specs/2026-07-17-feedback-form-design.md`

## Global Constraints

- User-facing copy is **English** and MUST go through the `t()` i18n layer (`frontend/src/i18n/en.ts`) — never hardcode user-facing strings in components.
- Code comments and logs are **English**.
- Feedback is **deliberately NOT end-to-end encrypted** (unlike notes it has no `iv`/`ct`) — it is written for the app owner to read. The UI must say so plainly.
- The user's e-mail is **never copied** into the feedback document; it is looked up from `users_repo` when needed.
- Message length limit is exactly **4000** characters; minimum **1**.
- Rate limit is exactly **5 messages per 600 seconds**, keyed by **username** (not IP).
- Cosmos container name is `feedback`, partition key `/user_id`.
- Run api tests with: `cd api && python -m pytest`
- Run frontend tests with: `cd frontend && npm test`
- Use the `.venv` in `api/` (NOT the stray empty `api/venv/`).
- **vitest runs in the node environment — there is no DOM.** There is no config to change this, and every existing frontend test is a unit test of a plain module (see the localStorage stub at the top of `preferences.test.ts`). Do **not** plan or write React component tests; `Account.tsx` is verified by driving the real app in Task 5.
- `api/` tests never exercise HTTP handlers (see `test_preferences.py`) — they test models, repositories and helpers directly. Keep to that.

## File Structure

| File | Responsibility |
|---|---|
| `api/models.py` (modify) | `Feedback` stored shape + `FeedbackRequest` accepted body |
| `api/repository.py` (modify) | `FeedbackRepository` Protocol, in-memory + Cosmos impls, factory |
| `api/mailer.py` (modify) | `send_feedback_notification` — best-effort, mirrors existing sender |
| `api/function_app.py` (modify) | `POST /api/feedback` route + dedicated rate limiter |
| `api/test_feedback.py` (create) | Model validation, repository, rate-limit behaviour |
| `frontend/src/feedbackApi.ts` (create) | `sendFeedback()` API client |
| `frontend/src/feedbackApi.test.ts` (create) | Status-code → error mapping |
| `frontend/src/Account.tsx` (modify) | Feedback section UI |
| `frontend/src/i18n/en.ts` (modify) | Copy for the section and its errors |

**Note on `feedbackApi.ts`:** the spec said `sendFeedback` would live in `api.ts`, but `api.ts`'s `API_URL` const is hardcoded to `/api/notes` and the codebase splits API clients by domain (`api.ts` = notes, `authApi.ts` = auth). A separate small module matches that pattern; `api.ts` stays a notes module.

---

### Task 1: Feedback model and repository

**Files:**
- Modify: `api/models.py` (append after `PreferencesRequest`)
- Modify: `api/repository.py` (new section before the `# ---- factory` section, plus two factory functions)
- Test: `api/test_feedback.py` (create)

**Interfaces:**
- Produces: `Feedback(user_id: str, message: str)` with auto `id: str` and `created_at: datetime`; `FeedbackRequest(message: str)` validating length 1–4000; `FeedbackRepository` Protocol with `add_feedback(feedback: Feedback) -> None`; `InMemoryFeedbackRepository` with a public `items: list[Feedback]`; `CosmosFeedbackRepository`; `get_feedback_repository() -> FeedbackRepository`.

- [ ] **Step 1: Add the models**

In `api/models.py`, append at the end of the file:

```python
class Feedback(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    # Deliberately NOT encrypted (no iv/ct like Note): this message is written
    # for the app's owner to read. The UI tells the user so.
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FeedbackRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
```

- [ ] **Step 2: Write the failing tests**

Create `api/test_feedback.py`:

```python
import pytest
from pydantic import ValidationError

from models import Feedback, FeedbackRequest
from ratelimit import RateLimiter
from repository import InMemoryFeedbackRepository


# --- request validation ---

def test_request_accepts_a_normal_message():
    assert FeedbackRequest(message="the editor is great").message == "the editor is great"


def test_request_rejects_an_empty_message():
    with pytest.raises(ValidationError):
        FeedbackRequest(message="")


def test_request_accepts_exactly_the_limit():
    assert len(FeedbackRequest(message="x" * 4000).message) == 4000


def test_request_rejects_over_the_limit():
    with pytest.raises(ValidationError):
        FeedbackRequest(message="x" * 4001)


# --- repository ---

def test_add_feedback_stores_the_message():
    repo = InMemoryFeedbackRepository()
    repo.add_feedback(Feedback(user_id="alice", message="hello"))
    assert [(f.user_id, f.message) for f in repo.items] == [("alice", "hello")]


def test_add_feedback_keeps_every_message():
    repo = InMemoryFeedbackRepository()
    repo.add_feedback(Feedback(user_id="alice", message="one"))
    repo.add_feedback(Feedback(user_id="alice", message="two"))
    assert [f.message for f in repo.items] == ["one", "two"]


def test_feedback_gets_an_id_and_timestamp():
    fb = Feedback(user_id="alice", message="hello")
    assert fb.id
    assert fb.created_at is not None


# --- rate limiting (the endpoint wires this in Task 3) ---

def test_rate_limiter_allows_five_then_denies():
    rl = RateLimiter(max_calls=5, window_seconds=600)
    assert [rl.allow("alice", now=0) for _ in range(5)] == [True] * 5
    assert rl.allow("alice", now=0) is False


def test_rate_limiter_is_per_user():
    rl = RateLimiter(max_calls=5, window_seconds=600)
    for _ in range(5):
        rl.allow("alice", now=0)
    assert rl.allow("bob", now=0) is True
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd api && .venv/bin/python -m pytest test_feedback.py -v`
Expected: FAIL — `ImportError: cannot import name 'InMemoryFeedbackRepository' from 'repository'`.

- [ ] **Step 4: Add the repository**

In `api/repository.py`, change the import on line 4 to include `Feedback`:

```python
from models import Note, User, Feedback
```

Then insert this section immediately **before** the `# ---- factory` comment:

```python
# ---------------------------------------------------------------- feedback

class FeedbackRepository(Protocol):
    def add_feedback(self, feedback: Feedback) -> None: ...


class InMemoryFeedbackRepository:
    """Temporary in-process feedback store (does not survive a restart)."""

    def __init__(self) -> None:
        # Public: there is no read method on the Protocol (feedback is read from
        # the portal, not the API), so tests assert against this directly.
        self.items: list[Feedback] = []

    def add_feedback(self, feedback: Feedback) -> None:
        self.items.append(feedback)


class CosmosFeedbackRepository:
    """Persistent feedback store in Azure Cosmos DB (partition /user_id)."""

    def __init__(self, connection_string: str, database: str = "bpad", container: str = "feedback") -> None:
        self._cs = connection_string
        self._database_name = database
        self._container_name = container
        self._container = None

    def _c(self):
        if self._container is None:
            from azure.cosmos import CosmosClient, PartitionKey

            client = CosmosClient.from_connection_string(self._cs)
            db = client.create_database_if_not_exists(self._database_name)
            self._container = db.create_container_if_not_exists(
                id=self._container_name, partition_key=PartitionKey(path="/user_id")
            )
        return self._container

    def add_feedback(self, feedback: Feedback) -> None:
        self._c().create_item(feedback.model_dump(mode="json"))
```

- [ ] **Step 5: Add the factory**

At the end of `api/repository.py`, after `get_users_repository()`:

```python
def get_feedback_repository() -> FeedbackRepository:
    cs = _connection_string()
    if cs:
        return CosmosFeedbackRepository(cs)
    logging.warning(
        "COSMOS_CONNECTION_STRING is not set - feedback is stored in a temporary "
        "in-memory store (it will not survive a restart)."
    )
    return InMemoryFeedbackRepository()
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && .venv/bin/python -m pytest test_feedback.py -v`
Expected: PASS — 9 passed.

- [ ] **Step 7: Run the whole api suite for regressions**

Run: `cd api && .venv/bin/python -m pytest -q`
Expected: PASS — 48 passed (39 existing + 9 new).

- [ ] **Step 8: Commit**

```bash
git add api/models.py api/repository.py api/test_feedback.py
git commit -m "feat(api): add feedback model and repository"
```

---

### Task 2: Best-effort notification e-mail

**Files:**
- Modify: `api/mailer.py`
- Test: `api/test_feedback.py` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `send_feedback_notification(username: str, email: Optional[str], message: str) -> None` — never raises.

- [ ] **Step 1: Write the failing tests**

Append to `api/test_feedback.py`:

```python
# --- notification e-mail (best-effort, must never raise) ---

def test_notification_without_recipient_logs_instead_of_raising(monkeypatch, caplog):
    monkeypatch.delenv("FEEDBACK_EMAIL", raising=False)
    with caplog.at_level("WARNING"):
        mailer.send_feedback_notification("alice", "alice@example.com", "hello")
    assert "hello" in caplog.text


def test_notification_without_provider_logs_instead_of_raising(monkeypatch, caplog):
    monkeypatch.setenv("FEEDBACK_EMAIL", "owner@example.com")
    monkeypatch.delenv("ACS_CONNECTION_STRING", raising=False)
    monkeypatch.delenv("EMAIL_SENDER", raising=False)
    with caplog.at_level("WARNING"):
        mailer.send_feedback_notification("alice", "alice@example.com", "hello")
    assert "hello" in caplog.text


def test_notification_survives_a_broken_provider(monkeypatch):
    monkeypatch.setenv("FEEDBACK_EMAIL", "owner@example.com")
    monkeypatch.setenv("ACS_CONNECTION_STRING", "endpoint=https://x/;accesskey=bogus")
    monkeypatch.setenv("EMAIL_SENDER", "bpad@example.com")
    # Must swallow the failure: the feedback is already stored by this point.
    mailer.send_feedback_notification("alice", "alice@example.com", "hello")
```

Add `import mailer` to the imports at the top of `api/test_feedback.py`:

```python
import pytest
from pydantic import ValidationError

import mailer
from models import Feedback, FeedbackRequest
from ratelimit import RateLimiter
from repository import InMemoryFeedbackRepository
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && .venv/bin/python -m pytest test_feedback.py -k notification -v`
Expected: FAIL — `AttributeError: module 'mailer' has no attribute 'send_feedback_notification'`.

- [ ] **Step 3: Implement the sender**

In `api/mailer.py`, change the import line to add `Optional`:

```python
import logging
import os
from typing import Optional
```

Then append this function **before** `def base_url()`:

```python
def send_feedback_notification(username: str, email: Optional[str], message: str) -> None:
    """Notify the app owner about new feedback. Best-effort, like verification mail:
    the feedback is already stored by the time we get here, so a failed send must
    only cost the notification, never the message."""
    to = os.environ.get("FEEDBACK_EMAIL")
    conn = os.environ.get("ACS_CONNECTION_STRING")
    sender = os.environ.get("EMAIL_SENDER")
    if not to or not conn or not sender:
        logging.warning(
            "Feedback notification not sent (recipient or provider unset) - "
            "from %s <%s>: %s", username, email or "no e-mail", message
        )
        return

    try:
        from azure.communication.email import EmailClient

        client = EmailClient.from_connection_string(conn)
        body = f"From: {username} <{email or 'no e-mail'}>\n\n{message}"
        msg = {
            "senderAddress": sender,
            "recipients": {"to": [{"address": to}]},
            "content": {
                "subject": f"bpad – feedback from {username}",
                "plainText": body,
            },
        }
        poller = client.begin_send(msg)
        result = poller.result()
        status = getattr(result, "status", None) or (
            result.get("status") if isinstance(result, dict) else result
        )
        logging.info("Feedback notification for %s: status=%s", username, status)
    except Exception as e:  # noqa: BLE001 - best-effort, the feedback is already stored
        logging.error("Failed to send feedback notification: %s", e)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && .venv/bin/python -m pytest test_feedback.py -k notification -v`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add api/mailer.py api/test_feedback.py
git commit -m "feat(api): add best-effort feedback notification email"
```

---

### Task 3: The `POST /api/feedback` endpoint

**Files:**
- Modify: `api/function_app.py` (imports at lines 9–18; module setup near line 37; new route appended at the end)

**Interfaces:**
- Consumes: `Feedback`, `FeedbackRequest` (Task 1); `get_feedback_repository()` (Task 1); `mailer.send_feedback_notification` (Task 2); existing `_require_user`, `_json`, `_error`, `RateLimiter`, `users_repo`.
- Produces: `POST /api/feedback` → `201 {"ok": true}` | `400` | `401` | `429` | `500`.

- [ ] **Step 1: Extend the imports**

In `api/function_app.py`, update the model import block (lines 9–13) to add the two new models:

```python
from models import (
    Note, NoteCreate, User,
    RegisterRequest, LoginRequest, RecoverRequest, ChangePasswordRequest,
    VerifyEmailRequest, PreferencesRequest,
    Feedback, FeedbackRequest,
)
```

And update the repository import (line 14):

```python
from repository import get_notes_repository, get_users_repository, get_feedback_repository
```

- [ ] **Step 2: Add the repository and the rate limiter**

After `users_repo = get_users_repository()` (line 26):

```python
feedback_repo = get_feedback_repository()
```

After the `_auth_limiter` definition (line 37):

```python
# Separate from _auth_limiter on purpose: feedback must not eat the sign-in quota.
# Keyed by username (we know who it is) rather than IP, so a shared network is
# not punished for one chatty user.
_feedback_limiter = RateLimiter(max_calls=5, window_seconds=600)
```

- [ ] **Step 3: Add the route**

Append to the end of `api/function_app.py`:

```python
# ------------------------------------------------------------- feedback

def _notify_feedback(username: str, message: str) -> None:
    """Look up the sender's e-mail and notify the owner. Best-effort throughout:
    the feedback is stored before this runs, so nothing here may fail the request."""
    email = None
    try:
        user = users_repo.get_user(username)
        email = user.email if user else None
    except Exception:  # noqa: BLE001 - a notification without an address beats a 500
        logging.exception("Could not load user %s for the feedback notification", username)
    mailer.send_feedback_notification(username, email, message)


@app.route(route="feedback", methods=["POST"])
def create_feedback(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    if not _feedback_limiter.allow(user):
        return _error("Too many messages, try again later", 429)
    try:
        data = FeedbackRequest(**req.get_json())
    except Exception as e:
        return _error(f"Invalid data: {str(e)}", 400)
    # Store first, notify second: mailer is best-effort, so e-mail must never be
    # the only record of the message.
    feedback_repo.add_feedback(Feedback(user_id=user, message=data.message))
    _notify_feedback(user, data.message)
    return _json({"ok": True}, 201)
```

- [ ] **Step 4: Verify the module imports cleanly**

Run: `cd api && .venv/bin/python -c "import function_app; print('routes ok')"`
Expected: `routes ok` (no ImportError, no NameError).

- [ ] **Step 5: Run the whole api suite for regressions**

Run: `cd api && .venv/bin/python -m pytest -q`
Expected: PASS — 51 passed.

- [ ] **Step 6: Commit**

```bash
git add api/function_app.py
git commit -m "feat(api): add POST /api/feedback endpoint"
```

---

### Task 4: Frontend — API client, UI section and copy

**Files:**
- Create: `frontend/src/feedbackApi.ts`
- Create: `frontend/src/feedbackApi.test.ts`
- Modify: `frontend/src/i18n/en.ts` (the `account` and `errors` sections)
- Modify: `frontend/src/Account.tsx`

**Interfaces:**
- Consumes: `POST /api/feedback` (Task 3); existing `getToken()` from `./session`, `translate` from `./i18n`.
- Produces: `sendFeedback(message: string): Promise<void>`, `FEEDBACK_MAX_LENGTH = 4000`.

- [ ] **Step 1: Add the copy**

In `frontend/src/i18n/en.ts`, add to the `account` section (after `language`):

```ts
    feedbackTitle: 'feedback',
    feedbackIntro: 'Found a bug, or missing something? Tell me.',
    feedbackNotEncrypted: 'Unlike your notes, this message isn’t encrypted — I need to be able to read it.',
    feedbackPlaceholder: 'What works, what doesn’t, what’s missing?',
    feedbackSend: 'Send feedback',
    feedbackSending: 'Sending…',
    feedbackThanks: 'Thanks — got it ✓',
```

And to the `errors` section:

```ts
    feedbackFailed: 'Could not send feedback',
    feedbackTooMany: 'Too many messages — please wait a few minutes',
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/feedbackApi.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendFeedback, FEEDBACK_MAX_LENGTH } from './feedbackApi'

function mockFetch(status: number) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendFeedback', () => {
  it('posts the message as JSON', async () => {
    const fetchMock = mockFetch(201)
    await sendFeedback('the editor is great')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ message: 'the editor is great' })
  })

  it('resolves on 201', async () => {
    mockFetch(201)
    await expect(sendFeedback('hello')).resolves.toBeUndefined()
  })

  it('reports rate limiting distinctly from a generic failure', async () => {
    mockFetch(429)
    await expect(sendFeedback('hello')).rejects.toThrow(/wait a few minutes/)
  })

  it('throws on a server error', async () => {
    mockFetch(500)
    await expect(sendFeedback('hello')).rejects.toThrow(/Could not send feedback/)
  })

  it('exposes the server’s length limit', () => {
    expect(FEEDBACK_MAX_LENGTH).toBe(4000)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/feedbackApi.test.ts`
Expected: FAIL — cannot resolve `./feedbackApi`.

- [ ] **Step 4: Write the API client**

Create `frontend/src/feedbackApi.ts`:

```ts
// Sends user feedback to the API. Unlike notes, this message is NOT
// end-to-end encrypted - it is written for the app's owner to read.
import { getToken } from './session'
import { translate } from './i18n'

const FEEDBACK_URL = import.meta.env.DEV
  ? 'http://localhost:7071/api/feedback'
  : '/api/feedback'

// Mirrors the server's FeedbackRequest limit (api/models.py).
export const FEEDBACK_MAX_LENGTH = 4000

export async function sendFeedback(message: string): Promise<void> {
  const token = getToken()
  const res = await fetch(FEEDBACK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Auth-Token': token } : {}),
    },
    body: JSON.stringify({ message }),
  })
  if (res.status === 429) throw new Error(translate('errors.feedbackTooMany'))
  if (!res.ok) throw new Error(translate('errors.feedbackFailed'))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/feedbackApi.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 6: Add the UI section**

In `frontend/src/Account.tsx`, add the import after the `getKnownNoteCount` import:

```tsx
import { sendFeedback, FEEDBACK_MAX_LENGTH } from './feedbackApi'
```

Add this state next to the existing `resend` state (after line 22):

```tsx
  const [feedback, setFeedback] = useState('')
  const [fbState, setFbState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [fbError, setFbError] = useState('')
```

Add this handler after the `useEffect` block (after line 29):

```tsx
  async function submitFeedback() {
    setFbState('sending')
    try {
      await sendFeedback(feedback.trim())
      setFeedback('')
      setFbState('sent')
    } catch (e) {
      setFbError(e instanceof Error ? e.message : t('errors.feedbackFailed'))
      setFbState('error')
    }
  }
```

Insert this block between the closing `</div>` of the `whatCanDo` link (line 120) and the logout button (line 122):

```tsx
        <div className="account-feedback">
          <span className="account-key">{t('account.feedbackTitle')}</span>
          <div className="account-note">{t('account.feedbackIntro')}</div>
          {fbState === 'sent' ? (
            <div className="verify-sent">{t('account.feedbackThanks')}</div>
          ) : (
            <>
              <textarea
                className="feedback-input"
                rows={4}
                value={feedback}
                maxLength={FEEDBACK_MAX_LENGTH}
                placeholder={t('account.feedbackPlaceholder')}
                onChange={(e) => setFeedback(e.target.value)}
              />
              <div className="account-note">{t('account.feedbackNotEncrypted')}</div>
              <button
                className="ghost-btn"
                type="button"
                disabled={fbState === 'sending' || feedback.trim() === ''}
                onClick={submitFeedback}
              >
                {fbState === 'sending' ? t('account.feedbackSending') : t('account.feedbackSend')}
              </button>
              {fbState === 'error' && <div className="account-note">{fbError}</div>}
            </>
          )}
        </div>
```

- [ ] **Step 7: Add the textarea style**

In `frontend/src/App.css`, append:

```css
.account-feedback {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feedback-input {
  width: 100%;
  resize: vertical;
  font: inherit;
  color: inherit;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 8px 10px;
}
```

- [ ] **Step 8: Verify the build, lint and tests**

Run: `cd frontend && npm run build && npm run lint && npm test`
Expected: build succeeds (`tsc -b` clean), lint reports no **new** warnings (pre-existing `only-export-components` warnings in `i18n/index.tsx` and `AuthContext.tsx` are expected), tests PASS — 87 passed (82 existing + 5 new).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/feedbackApi.ts frontend/src/feedbackApi.test.ts \
        frontend/src/Account.tsx frontend/src/i18n/en.ts frontend/src/App.css
git commit -m "feat(web): add feedback form to the account page"
```

---

### Task 5: End-to-end verification and configuration

**Files:** none modified — this task verifies the feature works when driven for real.

**Interfaces:**
- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Start the API without Cosmos (in-memory path)**

Run in one terminal: `cd api && func start`
Expected: the host lists `create_feedback` among its HTTP functions, and logs the warning `COSMOS_CONNECTION_STRING is not set - feedback is stored in a temporary in-memory store`.

- [ ] **Step 2: Start the frontend**

Run in a second terminal: `cd frontend && npm run dev`
Expected: Vite serves on `http://localhost:5173`.

- [ ] **Step 3: Drive the form**

Register or sign in, open **Account**, type a message, press **Send feedback**.
Expected: the button shows "Sending…", then the section is replaced by "Thanks — got it ✓". The `func start` terminal logs `Feedback notification not sent (recipient or provider unset) - from <username> <...>: <message>` — proving the message survived even with no mail provider configured.

- [ ] **Step 4: Verify the rate limit**

Send 5 more messages in a row.
Expected: the 6th shows "Too many messages — please wait a few minutes" (HTTP 429), and the message stays in the textarea so nothing typed is lost.

- [ ] **Step 5: Verify the length cap**

Paste more than 4000 characters into the textarea.
Expected: the browser truncates at 4000 (`maxLength`), so the request cannot exceed the server limit.

- [ ] **Step 6: Configure production**

In the Azure portal (personal account `jan.machacek@hotmail.com`, subscription `4ee57111-877a-4f20-b930-8a2f57debe9a`) add the SWA app setting:

```
FEEDBACK_EMAIL = <the address that should receive notifications>
```

Or via CLI:

```bash
az staticwebapp appsettings set -n bpad -g bpad-rg \
  --setting-names FEEDBACK_EMAIL=<address>
```

Expected: without it the feature still works and stores feedback; only the notification is logged instead of sent. The `feedback` container is created automatically on the first write (`create_container_if_not_exists`).

- [ ] **Step 7: Update the docs**

In `CLAUDE.md`, add `feedback` to the container list in the **Storage** paragraph, and add a row to the **Environment variables** table:

```markdown
| `FEEDBACK_EMAIL` | Recipient of feedback notifications. Unset → the message is only logged. |
```

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note the feedback container and FEEDBACK_EMAIL setting"
```
