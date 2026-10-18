# Application draft: the first paid feature

Date: 2026-08-20. Repos: `extension` (client) and `oljextension` (API).

## What

From a job's details - the modal on the results page, or the strip on the job's
own page - press **Draft application**. The extension sends the job's text and
your profile to the site's API; the API spends one credit, asks a model for a
short first message to the employer, and returns it. The draft appears in a box
you can edit and copy. It is the first thing the account is for, and it builds
the one path every later paid feature reuses: extension -> API -> ledger ->
model -> extension.

Decisions already made:

- **Provider: OpenAI**, a small model (`gpt-4o-mini`), behind one module so the
  provider is a one-file change.
- **Price: 1 credit per draft.** Regenerating is another draft, another credit.
- **Trial: 5 credits on sign-up**, written as a `signup_bonus` ledger row.

## Principles this has to keep

- **Nothing leaves the browser until you press the button.** The profile store's
  promise ("nothing here is ever sent anywhere") becomes "only when you ask for a
  draft, and only the parts a draft needs". The button says so the first time.
- **Charge on success, never before.** Spend, call the model; on any failure,
  refund with the same idempotency key suffixed `:refund`. The ledger already
  has `spendCredits` and `refund` for exactly this.
- **The server keeps no copy of the job text or the profile.** The ledger row's
  metadata holds the job URL, the model name and token counts - enough to answer
  "what was this charge" - and nothing a person wrote.
- **Entitlement is the server's.** The extension shows the balance from
  `/api/me` as a courtesy; the route decides.

---

## API (`oljextension`)

### `POST /api/drafts`

Bearer token (extension session). Body, validated with zod:

```
{
  job: { url: string (site job URL, <= 300), title: string (<= 200),
         employer?: string (<= 120), rateText?: string (<= 80),
         description: string (<= 12000) },
  profile: { name?: string, headline?: string (<= 200), resume?: string (<= 6000),
             experience?: Array<{role, company, period, summary}> (<= 8 entries),
             targetRoles?: string[] (<= 10) },
  options?: { tone?: 'plain' | 'warm' | 'formal' (default 'plain'),
              subject?: string (<= 120) },
  idempotencyKey: string (<= 80)   // the extension's: `${jobKey}:${attempt}`
}
```

Responses:

| status | body | when |
|---|---|---|
| 200 | `{ draft: string, subject: string|null, credits: number, model, usage: {input, output} }` | done |
| 401 | `{ error: 'unauthorized' }` | no/expired session |
| 402 | `{ error: 'insufficient_credits', credits }` | balance < 1 |
| 409 | `{ error: 'duplicate', credits }` | same idempotency key already charged |
| 413 / 400 | `{ error }` | body too large / invalid |
| 429 | `{ error: 'rate_limited', retryAfter }` | > 30 drafts per user per day |
| 502 | `{ error: 'model_failed' }` | provider error; **credit refunded** |

Flow in the route:

1. `currentUser` → 401.
2. Parse body → 400; the total body is capped at 64 KB by checking
   `content-length` and the parsed string lengths.
3. Daily count: rows in `credit_ledger` for this user with `reason = 'usage'`
   and `metadata->>'kind' = 'draft'` in the last 24h; ≥ 30 → 429.
4. `spendCredits({ amount: 1, reason: 'usage', idempotencyKey, metadata: { kind: 'draft', jobUrl } })`.
   `ok: false` with balance < 1 → 402; `ok: false` otherwise → 409.
5. `draftApplication(job, profile, options)` (see below). On throw → `refund({ amount: 1, idempotencyKey: key + ':refund', metadata: { kind: 'draft_refund', jobUrl, error } })` → 502.
6. 200 with the draft and the new balance (`creditBalance`).

### `src/lib/drafting.ts` (pure-ish: builds the prompt, calls the provider)

- `buildPrompt(job, profile, options) -> { system, user }` — pure, unit-tested.
  The system prompt: you are writing a short first message from a Filipino
  remote worker to an employer on OnlineJobs.ph; 120–200 words; plain English;
  no invented experience - only what the profile states; mirror the job's
  concrete asks; if the job names a subject line, return it as `subject`;
  never mention rates unless the job asks the applicant to state one; end
  with one clear next step. Output JSON `{ "draft": "...", "subject": "..."|null }`.
- `draftApplication(job, profile, options, deps = { fetch })` — calls OpenAI
  chat completions with `response_format: { type: 'json_object' }`, 20s
  timeout, parses/validates the JSON, returns `{ draft, subject, model, usage }`.
  Throws on non-200, timeout, or malformed JSON.
- Provider isolated in `src/lib/providers/openai.ts`: `complete({ system, user }) -> { text, usage }`.
  Reads `OPENAI_API_KEY` and optional `OPENAI_MODEL` (default `gpt-4o-mini`).
  `OPENAI_FAKE=1` returns a canned reply, for local runs and the verify script.

### Sign-up bonus

`sign-up/route.ts`: after inserting the user, `recordEntry({ delta: 5, reason:
'signup_bonus', idempotencyKey: 'signup', metadata: {} })`. Idempotent per user.
Not back-filled for existing accounts (there is one: yours; grant by hand).

### Tests (`vitest`, added to `oljextension` as a dev dependency)

- `buildPrompt`: includes title/description/profile lines, omits empty profile
  fields, caps lengths, passes the subject hint through.
- `draftApplication` with a fake `fetch`: parses a good reply; throws on 500,
  on timeout, on JSON without `draft`.
- Route: a script `scripts/verify-drafts.ts`, in the style of
  `scripts/verify-credits.ts`, hits the running route with `OPENAI_FAKE=1` and
  checks: 402 at zero balance, 200 spends one, 409 on the same key, 502 refunds.

---

## Extension

### `src/core/drafts.js` (pure + a small store)

- `draftRequest({ job, profile, options, attempt }) -> body` — picks the
  profile fields a draft needs, trims to the API's limits, sets
  `idempotencyKey = `${jobKey}:${attempt}``.
- Local memory of drafts so re-opening a job shows the last one without
  another charge: `chrome.storage.local` key `ojRateFilterDrafts`:
  `{ [jobKey]: { text, subject, createdAt, attempt, model } }`, capped at 200
  by `createdAt`. `loadDrafts / saveDraft / removeDraft / onDraftsChanged`.
- `describeDraftError(status, body) -> string` — the one place the wording of
  401/402/409/429/502 lives ("You have no credits left - buy some on the
  website", "Sign in from the toolbar icon first", …).

### `src/core/account.js`

- `requestDraft(body) -> { draft, subject, credits }` using the existing
  authenticated fetch helper; throws `{ status, body }` on non-200.
- `API_BASE` stays `http://localhost:3100` for now (existing).

### UI

- **Modal footer** and **job-page strip**: a **Draft application** button
  (icon: a pen). Disabled with tooltip "Sign in from the toolbar icon" when
  signed out; shows "(1 credit)" in the tooltip; when a draft already exists
  for this job the button reads **Show draft**.
- Pressing it opens a panel under the actions (modal) / under the strip (job
  page): a textarea with the draft, the subject line above it if any, and
  buttons **Copy**, **Regenerate (1 credit)**, **Close**. While waiting: the
  button shows a spinner and "Writing…"; errors appear in the panel in plain
  words from `describeDraftError`.
- **First use** shows one confirmation line in the panel before sending:
  "This sends this job's text and your profile (headline, experience, resume,
  target roles) to our server to write the draft. 1 credit." with **Send** /
  **Cancel**; a checkbox "Don't ask again" sets `draftConsent: true` in settings.
- Profile empty (`isProfileEmpty`): the panel says "Fill in your profile first"
  with a link to the options page instead of sending.
- Popup: the credits line already exists; after a draft the balance refreshes
  via `fetchAccount`.

### Settings

- `draftConsent: false` (sync), `draftTone: 'plain'` (sync; a select in the
  panel, remembered).

### README

- Profile section: the promise changes to "never sent anywhere unless you press
  Draft application, and then only the fields a draft needs, to our own server".
- New section "Drafting an application" with the credit price, what is sent,
  what the server keeps (nothing of the text), and the refund rule.

## Out of scope

Streaming, multiple variants per call, saving drafts server-side, PayMongo
top-ups, email verification, any second paid feature.
