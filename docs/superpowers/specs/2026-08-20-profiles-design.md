# Profiles: About-you, multiple specializations, file import

Date: 2026-08-20. Repos: `extension` (client, most of it) and `oljextension`
(the draft prompt grows an About block). This is **Feature A** of a small
roadmap; drafts templates/subject (B) and cached job insights (C) are separate
specs, listed at the end, built on top of what A lands.

## Free build scope (this overrides the detail below)

Decided 2026-08-20 (see the `free-premium-split` memory). Build **only** the free
subset; the richer items become premium or are deferred.

**Build now (free):**
- Multiple **profiles** — `{ id, label, headline, targetRoles[], body, source,
  isDefault, updatedAt }`. No `exclude`, no per-profile item toggles.
- A simple shared **About you** — flat fields (name, email, phone, location,
  timezone, availability, equipment, languages, other) **plus one `links` list**
  `{ id, label, url }`. **Drop `certifications` and `testimonials`.**
- Client-side **file import** (PDF/DOCX/TXT -> markdown), the draft-time
  **profile picker**, **backup v3**, and the server prompt's **About block**
  (the flat fields + links only; no certs/testimonials).
- A single free **subject pattern**: `settings.draftSubjectPattern` (default
  `Application: {jobTitle} — {name}`) and a pure `resolveSubject(instruction,
  pattern, values)` — employer instruction wins, else the pattern. Keep the
  existing Plain/Warm/Formal tone select.

**Not now:**
- **Premium:** the editable prompt / custom templates; the "how to apply / is
  there a test" cached insight.
- **Deferred:** certifications & testimonials pool and the per-profile on/off
  toggles (`exclude`, `includedItems`, the three checkbox groups). Revisit if
  drafts need them.

The sections below describe the fuller design for reference; wherever they add
`certifications`, `testimonials`, `exclude`, `includedItems`, or template/prompt
editing, **skip those parts** for the free build.

---

## What

Replace the single applicant profile with an Upwork-shaped set:

- **About you** — one shared pool, filled once: contact and context fields, plus
  three item lists (links, certifications, testimonials) that any profile can
  cite.
- **Profiles** — named specializations (Virtual Assistant, Data Entry,
  Bookkeeping…), each with its own headline, target roles, and a markdown body
  (typed, pasted, or imported from a PDF/DOCX/TXT on your machine), and per-
  profile on/off toggles over the three shared lists.

When drafting, a picker chooses which profile writes the message; the draft
sends About-you (minus email and phone) plus that profile's fields and its
switched-on items.

Everything stays in `chrome.storage.local`. Nothing is uploaded to convert a
file, and the profile still leaves the browser only at draft time, only the
chosen parts, only because you pressed the button.

## Principles carried from the profile it replaces

- The most personal thing the extension holds. Local, never sync, never sent
  except one field-set at draft time.
- Email and phone never go to the model. Links, certifications and testimonials
  do — they are application content you chose to include.
- Nothing invented: the draft is written only from what the profile states.

---

## Data model (`chrome.storage.local`)

### `ojRateFilterAbout` — the shared pool

```
{
  name, email, phone, location, timezone, availability, equipment,
  languages, other,                       // flat strings, trimmed and capped
  links:          [{ id, label, url }],           // cap 20
  certifications: [{ id, name, issuer, year, url }],   // cap 20
  testimonials:   [{ id, quote, author, source }],     // cap 20
}
```

Item ids are short random strings (`newId()`), stable so a profile can exclude
one by id. Field caps mirror the current profile's `LIMITS` (line 200, short
120) with `other` at 2000 and each `quote` at 600.

### `ojRateFilterProfiles` — the specializations

```
[{
  id, label,                               // label <= 80
  headline,                                // <= 200
  targetRoles: string[],                   // <= 30
  body,                                    // markdown, <= 20000
  source: 'typed' | 'pdf' | 'docx' | 'text',   // where the body came from
  exclude: { links: string[], certifications: string[], testimonials: string[] },
  isDefault: boolean,
  updatedAt: number,
}]
```

`exclude` holds the ids a profile switches **off**. Default is on: a shared item
is cited by every profile unless that profile lists its id in the matching
`exclude` set, so adding a certification later shows up everywhere until you
turn it off where it does not fit. Cap **12 profiles**. Exactly one `isDefault`:
the sanitiser makes the first profile default when none is, and keeps the first
when several claim it.

### Migration from `ojRateFilterProfile`

Runs once, inside the first `loadAbout`/`loadProfiles` when the new keys are
absent and the old key is present:

- `about` <- `{ name, email, phone, location }` from the legacy profile; the new
  flat fields and all three lists start empty.
- `profiles` <- one profile: `{ label: 'My profile', headline, targetRoles,
  body: assembleBody(resume, experience), source: 'typed', exclude: {empty},
  isDefault: true }`.
- `assembleBody(resume, experience)`: the resume text, then—if there are
  experience rows—a `## Experience` heading and one `- role, company, period —
  summary` bullet each.

The old key is removed after a successful migrate so it cannot re-run. A backup
taken before the update still restores through the v2 path below.

---

## Core modules

### `src/core/about.js`

`EMPTY_ABOUT`, `sanitizeAbout(raw)`, `loadAbout()`, `saveAbout(patch)` (merge),
`replaceAbout(raw)`, `onAboutChanged(cb)`, `newId()`. The editor manages the
lists in React state and saves the whole object; `saveAbout` merges a patch, so
partial saves are safe. `sanitizeAbout` coerces the flat fields and each list,
generating a missing id, capping counts and lengths, dropping an all-empty item.

### `src/core/profiles.js`

Store: `sanitizeProfiles(raw)`, `loadProfiles()` (runs migration),
`saveProfile(profile)` (upsert by id, stamps `updatedAt`), `createProfile(partial)`
(returns a new profile with an id), `removeProfile(id)`, `setDefaultProfile(id)`,
`replaceProfiles(raw)`, `onProfilesChanged(cb)`.

Selectors (pure, tested): `defaultProfile(list)`, `profileById(list, id)`,
`isUsable(profile)` (a body or a headline), `hasUsableProfile(list)`.

Drafting (pure, tested):

- `includedItems(about, profile) -> { links, certifications, testimonials }` —
  each shared list minus the profile's excluded ids, ids stripped from the
  result.
- `buildDraftProfile(about, profile) -> object` — the shape the draft request
  needs: `name, headline, targetRoles, body`, the About context
  (`location, timezone, availability, equipment, languages, other`), and the
  included `links / certifications / testimonials`. **email and phone are not in
  it.**

Migration (pure, tested): `migrateLegacy(legacyProfile) -> { about, profiles }`,
and `assembleBody(resume, experience)`.

### The old `src/core/profile.js`

Shrinks to the legacy shape only: keep `EMPTY_PROFILE`, `sanitizeProfile`, and
`LIMITS` for the migration and the backup v2 path; drop the storage functions
(`loadProfile`/`saveProfile`/`replaceProfile`/`onProfilesChanged`) — nothing new
uses them once `draft-deps`, `Backup` and the editor move over.

---

## File import (client-side)

### `src/options/import-file.js`

- `importFile(file, deps = REAL) -> Promise<{ markdown, source }>` — dispatch by
  MIME/extension: `application/pdf` -> `deps.extractPdf`; `.docx` -> `deps.extractDocx`;
  `text/plain` / `text/markdown` / `.txt` / `.md` -> read as text; anything else
  throws `Unsupported file type`. Result runs through `normalizeImportedMarkdown`.
- `extractPdf(file)` — dynamic-import `pdfjs-dist`, set `GlobalWorkerOptions.workerSrc`
  to the Vite-bundled worker URL, read every page's text, join with blank lines.
- `extractDocx(file)` — dynamic-import `mammoth`, `extractRawText` (stable; its
  markdown mode is experimental), return the text.
- `normalizeImportedMarkdown(text)` (pure) — trim, collapse 3+ blank lines to 2,
  strip trailing spaces, cap at the body limit (20000).

Dynamic imports keep `pdfjs-dist` (~1–2 MB) and `mammoth` out of the options
page's main bundle; they load only when a file is imported.

### Tests

`test/markdown-import.test.js`: `normalizeImportedMarkdown` cases; `importFile`
dispatch with fake `extractPdf`/`extractDocx` and a real text `File`; unsupported
type throws. The real pdf/docx adapters are thin and verified live.

### Honest limit, shown in the editor

A scanned image-only PDF has no text layer to pull and no OCR here — the import
comes back empty and the editor says so; paste or type instead.

### Future import source (roadmap, not now)

A second "Import" source: **pull the user's existing OnlineJobs.ph resume**.
On `https://v2.onlinejobs.ph/jobseekers`, "Update resume" opens a modal whose
"View resume" is a direct link to the uploaded resume file. A content script on
that logged-in page could read that link and run the file through the same
`importFile` pipeline — no upload, same client-side conversion. Its own small
design (where the button lives, finding the link, the file's type).

---

## Options UI

A **Profiles** tab (replacing the current Profile section):

- `src/options/About.jsx` — the shared card: flat fields, then three small list
  editors (Links `{label,url}`, Certifications `{name,issuer,year,url}`,
  Testimonials `{quote,author,source}`) with add/remove. Saves via `saveAbout`.
- `src/options/Profiles.jsx` — the list: a card per profile (label, headline,
  default badge, roles, a body preview) with Edit / Delete / Set default, and a
  **New profile** button.
- `src/options/ProfileEditor.jsx` — one profile: label, headline, target roles
  (`KeywordsField`), body (`TextareaField`) with an **Import from file**
  button (runs `importFile`, fills the body with a replace/append confirm when
  it already has text), and three checkbox groups (Links / Certifications /
  Testimonials to include) listing the shared items, checked = not excluded.

`Profile.jsx` (the old editor) is removed; `App.jsx` mounts the new tab.

---

## Draft panel and request

### `src/content/draft-deps.js`

Swap `getProfile`/`isProfileEmpty` for: `getAbout`, `getProfiles`,
`getDraftProfileId` / `setDraftProfileId` (settings `draftProfileId`), and expose
`buildDraftProfile`. `hasUsableProfile` replaces the empty-profile gate.

### `src/content/draft-panel.js`

A profile `<select>` (labels) above the draft area. Selection order:
1. the `profileId` saved on an existing draft for this job,
2. else `settings.draftProfileId` (last used),
3. else the default profile.

Changing it remembers the choice (`setDraftProfileId`) and applies to the next
generate. `generate` builds the request from `buildDraftProfile(about, chosen)`;
the saved draft records `profileId` so re-opening shows which profile wrote it.
When no profile is usable, the panel shows "Create a profile first" with an
Open-profile button instead of sending.

### `src/core/drafts.js`

`draftRequest` takes the `buildDraftProfile` output and maps it to the body's
`profile`, keeping the server's caps. The stored-draft shape gains `profileId`.

### Server (`oljextension`)

- `validation.ts` `draftRequestSchema.profile` gains: `location, timezone,
  availability, equipment, languages, other` (short/capped strings) and
  `links` `[{label,url}]`, `certifications` `[{name,issuer,year,url}]`,
  `testimonials` `[{quote,author,source}]` (each list `.max(20)`). `experience`
  is dropped.
- `drafting.ts` `buildPrompt` renders an **ABOUT** block after the applicant's
  headline: location/timezone/availability/equipment/languages/other, then the
  included links, certifications and testimonials. The system prompt gains one
  line: testimonials are quotes from past clients and may be cited as such;
  never present a link or certification the profile did not provide.
- No route or ledger change. `test/drafting.test.ts` gains About-block cases.

---

## Backup (version 3)

- `buildBackup`: `about` + `profiles` replace `profile`.
- `readBackup`: v3 reads them; v2 (a single `profile`) restores by running
  `migrateLegacy` into one profile + About; v1 as before (neither). `BACKUP_VERSION`
  -> 3; v2 and v1 files still restore.
- `describeBackup`: "N profiles" instead of the profile line.
- `Backup.jsx`: gather `loadAbout` + `loadProfiles`; restore `replaceAbout` +
  `replaceProfiles`.

---

## Settings

- `draftProfileId: ''` (sync) — the last-used profile, for the picker default.
- `draftTone` stays untouched here; it becomes template-driven in Feature B.

---

## Tests

- `about.test.js` — sanitize (flat + lists, caps, id generation, all-empty item
  dropped), load/save/replace.
- `profiles.test.js` — sanitize (one default enforced, cap), CRUD, `includedItems`
  (exclusion applied, ids stripped), `buildDraftProfile` (email/phone omitted,
  only included items), `migrateLegacy` (About split, body assembly).
- `markdown-import.test.js` — normalize; dispatch with fakes; unsupported throws.
- `draft-panel.test.js` (additions) — picker present, default selection order,
  sends the chosen profile, records `profileId` on the draft, "create a profile
  first" gate.
- `backup.test.js` — v3 round-trip, v2 migrate, v1 empty, describe count.
- Site `test/drafting.test.ts` — buildPrompt renders the About block; schema
  accepts the new fields.

---

## Roadmap — the follow-on features (their own specs)

**Feature B — Draft templates & subject.** The current single `draftTone`
becomes a named list of templates (Plain/Warm/Formal ship built-in; users add
their own), each `{ label, instructions, subjectPattern, isDefault }`. The
template's *instructions* drive the voice inside a fixed server contract the
template cannot remove (JSON out, use only the facts given, no invented
experience, length). The subject line is resolved on the client, in order:
a subject the employer's instruction demands (already detected) → the chosen
template's pattern filled from `{jobTitle}/{employer}/{name}/{profileLabel}/…`
→ a default pattern. A template picker joins the profile picker in the draft
panel.

**Feature C — Cached "how to apply" insights (shared, free).** Many postings
bury application instructions in the description — "put this word in the
subject", "answer these questions", "there will be a paid test". Feature C
extracts, per job, a small structured insight: the how-to-apply steps, any
required word/subject/passphrase, and whether the process includes a test or
extra stages. It is **free to the reader** (no credit) but costs *us* tokens to
generate, so it is **cached server-side and shared across users**: the first
person to open a job triggers one generation, the result is stored keyed by the
job and a hash of its description, and everyone after reads the cache. An
employer editing the description changes the hash and triggers a fresh
generation; an unchanged description never regenerates. Unlike profiles, the job
description is public site data, so caching it server-side is fine. Its own
spec covers the `job_insights` table, the cache-or-generate route, how misses
are rate-limited so "free" cannot be abused, and where the insight is shown
(card, modal, job-page strip). Build order: A, then B, then C.
