# Application draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first paid feature from `docs/superpowers/specs/2026-08-20-application-draft-design.md`: `POST /api/drafts` on the site (credit spend, OpenAI draft, refund on failure, 5-credit sign-up bonus) and a **Draft application** button + panel in the extension's modal and job-page strip.

**Architecture:** API side: one route, one pure prompt builder, one provider module (OpenAI, fakeable via `OPENAI_FAKE=1`), reusing `spendCredits`/`refund`. Extension side: a pure `drafts.js` (request shaping, local draft memory, error wording), `requestDraft` in `account.js`, and a shared `draft-panel.js` DOM component mounted by the modal and the job page. **The extension never fills or submits an application** - it only shows text to copy.

**Tech Stack:** Next.js 16 route handlers + Drizzle + zod; vitest for the pure modules; `scripts/verify-drafts.ts` against the running DB/route. Extension: ES modules, vitest (+ jsdom for the panel).

## Global Constraints

- Charge on success, never before; any model failure refunds with key `${key}:refund`.
- The server stores no job text and no profile text; ledger metadata = `{kind, jobUrl, model?, usage?}` only.
- Body caps: description <= 12000, resume <= 6000, experience <= 8 entries, total <= 64 KB. Daily cap 30 drafts/user.
- Never drive the site's apply page or form. No autofill. Copy only.
- Tests green before each commit; one commit per task, per repo.

## Tasks

### Task A (site): provider + prompt + drafting
- Create `src/lib/providers/openai.ts` — `complete({system, user, timeoutMs=20000}) -> {text, model, usage}`; env `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`), `OPENAI_FAKE=1` → canned JSON reply. Uses `fetch` to `https://api.openai.com/v1/chat/completions` with `response_format: {type:'json_object'}`; throws `ProviderError(status, message)`.
- Create `src/lib/drafting.ts` — `DraftJob/DraftProfile/DraftOptions` types, `buildPrompt()` (pure), `parseDraftReply(text)` (pure: JSON → `{draft, subject|null}`, throws if `draft` missing/empty), `draftApplication(job, profile, options, deps)`.
- Add `vitest` dev dep + `vitest.config.ts` (node env, `test/**/*.test.ts`), `npm test`.
- Tests `test/drafting.test.ts`: prompt contains title/description/profile, omits empties, caps; parse good/bad replies; `draftApplication` with a fake `complete`.
- Commit: `feat: prompt builder and OpenAI provider for application drafts`.

### Task B (site): the route + sign-up bonus + verify script
- `src/lib/validation.ts`: `draftRequestSchema` (zod, caps above).
- `src/app/api/drafts/route.ts`: the flow in the spec (401/400/413/429/402/409/502/200).
- `src/lib/credits.ts`: `countRecentUsage(userId, kind, sinceMs)`.
- `sign-up/route.ts`: `recordEntry({delta:5, reason:'signup_bonus', idempotencyKey:'signup'})` after insert.
- `scripts/verify-drafts.ts`: creates a user, mints an extension session, runs with `OPENAI_FAKE=1` against `http://localhost:3100`: 402 at zero → grant 2 → 200 spends one → same key 409 → force provider failure (`OPENAI_FAKE=fail`) → 502 and balance restored; cleans up.
- README (site): route docs, env vars, the no-retention rule.
- Commit: `feat: POST /api/drafts - one credit, one draft, refund on failure`.

### Task C (extension): core + client
- `src/core/drafts.js`: `DRAFT_LIMITS`, `draftRequest({job, profile, options, attempt})`, `describeDraftError(status, body)`, store (`ojRateFilterDrafts`, cap 200): `sanitizeDrafts/loadDrafts/saveDraft/removeDraft/onDraftsChanged`.
- `src/core/account.js`: `requestDraft(body)` → `{draft, subject, credits, model}`; throws `DraftRequestError{status, body}`; 401 clears auth like `fetchAccount`.
- `src/core/settings.js`: `draftConsent:false`, `draftTone:'plain'`.
- Tests `test/drafts.test.js`: request shaping/caps/idempotency key, error wording per status, store.
- Commit: `feat: draft request shaping, local draft memory, and the API client`.

### Task D (extension): the panel, wired into modal and job page
- `src/content/draft-panel.js`: `createDraftPanel({ doc, getAuth, getProfile, getSettings, setSettings, request, drafts, onBalance })` → `{ mountButton(host, job), open(job), close() }`. States: signed-out, profile-empty, consent, idle(existing draft), writing, done, error. Textarea + Copy / Regenerate / Close, tone select, subject line. No autofill. CSS in `content.css`.
- Modal: button in `.ojrf-modal-actions`, panel under the actions. Job page: button on the strip (icon pen), panel under the strip. Both pass `{jobKey, url, title, employer, rateText, description}`.
- Popup: refresh credits after a draft via storage change (`ojRateFilterAccountCredits` or just re-`fetchAccount` on open - already does).
- Tests `test/draft-panel.test.js` (jsdom): state transitions with fake request; consent gate; error wording; no network when profile empty.
- README: profile promise change; "Drafting an application" section; version 1.2.0.
- Commit: `feat: draft an application from the modal or the job page`.
