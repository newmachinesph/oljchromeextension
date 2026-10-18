# Free-tier batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the seven local features in `docs/superpowers/specs/2026-08-20-free-tier-batch-design.md` — concerns chip, beginner-friendly identification, employer book, follow-up reminders, application funnel, keyboard triage, saved-search alerts — one commit each, tests green before each.

**Architecture:** Pure logic in `src/core/*.js` (no DOM, no chrome), each with a vitest file; DOM wiring in `src/content/*.js`; React in `src/options/*.jsx`; the service worker `src/background.js` gains the badge and the alert alarm. New stores follow `applications.js`: a `sanitize*` pure function, `load*`, mutators that read-modify-write `chrome.storage.local`, and an `on*Changed` subscription.

**Tech Stack:** MV3 extension, ES modules, vitest (+ jsdom for content tests), React 18 + Vite for the options page.

## Global Constraints

- A listing is only hidden when the rule rests on something stated outright; beginner/experience and concerns never hide on a guess (`unclear` shows nothing).
- Never remove a site node; classes and inserted siblings only.
- No new install-time permission. `alarms` and `https://www.onlinejobs.ph/*` go in `optional_permissions` / `optional_host_permissions` and are requested from the options toggle.
- Every new `src/core` module has a test file; run `npm test` before each commit.
- Commit messages: conventional, one per feature: `feat: ...`.
- Version bumps to `1.1.0` in `manifest.json` and `package.json` in the final task.

## File map

| file | responsibility |
|---|---|
| `src/core/concerns.js` (new) | gather/describe/explain concerns |
| `src/core/experience-level.js` (new) | phrase tables + `judgeExperience` |
| `src/core/employer-book.js` (new) | block / note / remembered signals store |
| `src/core/follow-ups.js` (new) | which applications are due |
| `src/core/funnel.js` (new) | summarize / byWeek / byRateBand |
| `src/core/key-nav.js` (new) | `nextIndex`, `KEY_BINDINGS` |
| `src/core/alerts.js` (new) | watched searches, html -> job keys, diff, state |
| `src/core/badge.js` (new) | `badgeText(dueCount, newCount)` - the one number the icon shows |
| `src/content/keys.js` (new) | keyboard triage over `filter.records` |
| `src/content/typing.js` (new) | `isTyping(target)` shared by palette and keys |
| `src/content/filter.js` | builds concerns/level/note/follow-up meta |
| `src/content/meta-row.js` | renders the new chips |
| `src/content/control-bar.js` | experience pills + follow-up pill |
| `src/content/job-modal.js` | re-judge level, block/note, remember signals, usdPerMonth on apply |
| `src/content/main.js` | wiring, palette entries, keys |
| `src/core/criteria.js` | reasons `experience`, `blocked-employer`, `not-follow-up` |
| `src/core/settings.js` | new keys |
| `src/core/saved-searches.js` | `experienceFilter` in `SEARCH_FIELDS` |
| `src/core/presets.js` | beginner preset |
| `src/core/applications.js` | `usdPerMonth`, `followedUpAt`, `markFollowedUp` |
| `src/core/backup.js` | book + alert state, version 2 |
| `src/background.js` | badge + alarm |
| `src/popup/popup.{html,js,css}` | follow-ups + new matches sections |
| `src/options/App.jsx`, `Applications.jsx` (new), `Alerts.jsx` (new), `BlockedEmployers.jsx` (new) | options UI |
| `manifest.json` | optional permissions, version |
| `README.md` | one section per feature |

---

### Task 1: Concerns chip

**Files:**
- Create: `src/core/concerns.js`, `test/concerns.test.js`
- Modify: `src/content/filter.js` (meta block ~L250-275), `src/content/meta-row.js` (renderMeta params + first chip), `src/content/content.css` (reuse `.ojrf-chip-flag`; remove `.ojrf-chip-stale` usage)

**Interfaces:**
- Produces: `gatherConcerns({flags, staleness, standingTone, employerMemory}) -> Concern[]`, `describeConcerns(list) -> string`, `explainConcerns(list) -> string`, where `Concern = {id, label, why}`; `employerMemory = {newAccount: bool|null, censored: bool|null} | null`.

- [ ] **Step 1: Write the failing tests** (`test/concerns.test.js`)

```js
import { describe, it, expect } from 'vitest';
import { gatherConcerns, describeConcerns, explainConcerns } from '../src/core/concerns.js';
import { RED_FLAGS } from '../src/core/red-flags.js';

describe('gatherConcerns', () => {
  it('is empty with nothing to say', () => {
    expect(gatherConcerns({})).toEqual([]);
    expect(gatherConcerns({ flags: [], staleness: '', standingTone: null, employerMemory: null })).toEqual([]);
  });
  it('leads with red flags, then employer memory, then staleness, then standing', () => {
    const list = gatherConcerns({
      flags: [RED_FLAGS[0]],
      staleness: 'advertised 5 wks',
      standingTone: 'low',
      employerMemory: { newAccount: true, censored: true },
    });
    expect(list.map((c) => c.id)).toEqual(['upfront-payment', 'new-employer', 'censored', 'stale', 'below-rate']);
  });
  it('ignores high standing and null memory fields', () => {
    expect(gatherConcerns({ standingTone: 'high', employerMemory: { newAccount: null, censored: false } })).toEqual([]);
  });
});

describe('describeConcerns', () => {
  it('reads as the first label plus a count', () => {
    const list = gatherConcerns({ flags: [RED_FLAGS[1]], staleness: 'advertised 3 wks' });
    expect(describeConcerns(list)).toBe('unpaid trial +1');
    expect(describeConcerns(list.slice(0, 1))).toBe('unpaid trial');
    expect(describeConcerns([])).toBe('');
  });
  it('explains one per line', () => {
    const list = gatherConcerns({ staleness: 'advertised 3 wks', standingTone: 'low' });
    expect(explainConcerns(list).split('\n')).toHaveLength(2);
    expect(explainConcerns(list)).toMatch(/^advertised 3 wks: /);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `npx vitest run test/concerns.test.js` → "Failed to resolve import".
- [ ] **Step 3: Implement** `src/core/concerns.js`:

```js
export function gatherConcerns({ flags = [], staleness = '', standingTone = null, employerMemory = null } = {}) {
  const list = [];
  for (const flag of flags ?? []) list.push({ id: flag.id, label: flag.label, why: flag.why });
  if (employerMemory?.newAccount) list.push({ id: 'new-employer', label: 'new employer', why: 'The employer account was created recently, which a job page you opened showed.' });
  if (employerMemory?.censored) list.push({ id: 'censored', label: 'censored post', why: 'Links and contact details were removed from a post by this employer, which the site does for accounts without a paid plan.' });
  if (staleness) list.push({ id: 'stale', label: staleness, why: 'This role has been advertised for a while; everyone who applied turned it down or left.' });
  if (standingTone === 'low') list.push({ id: 'below-rate', label: 'below going rate', why: 'Pays less than most listings asking for the same skills.' });
  return list;
}
export function describeConcerns(list) { /* first label, +N */ }
export function explainConcerns(list) { /* label: why per line */ }
```

- [ ] **Step 4: Wire** — in `filter.js` replace `redFlags`/`redFlagsWhy`/`staleness` meta fields with `concerns`/`concernsWhy`, computed from `gatherConcerns({ flags: settings.showRedFlags ? flags : [], staleness: settings.showStaleness ? describeStaleness(...) : '', standingTone: standingTone(standing), employerMemory: book.get(employerKey(listing.employer)) ?? null })`. `apply()` gains a `book` parameter (a `Map`, default `new Map()`) after `history`. In `meta-row.js` rename the params, drop the stale chip block, keep the flag chip reading `concerns`. Run `npm test` (integration tests reference red-flag chips — update expectations to the new text shape).
- [ ] **Step 5: Commit** — `feat: one concerns chip per card`.

---

### Task 2: Beginner-friendly identification

**Files:**
- Create: `src/core/experience-level.js`, `test/experience-level.test.js`
- Modify: `src/core/settings.js` (DEFAULTS + sanitize), `src/core/criteria.js` (reason `experience` after `job-type`), `src/core/saved-searches.js` (`SEARCH_FIELDS`), `src/core/presets.js`, `src/content/filter.js`, `src/content/meta-row.js`, `src/content/control-bar.js` (pill group), `src/content/job-modal.js`, `src/content/main.js` (palette), `src/content/content.css`, `src/options/App.jsx` (Filter tab select), `test/criteria.test.js`, `test/settings.test.js` if present.

**Interfaces:**
- Produces: `LEVELS`, `judgeExperience(title, text) -> {level, matched: [{id,label}], why}`, `describeLevel(level) -> string`, `EXPERIENCE_FILTERS = [{value:'all',label:'Any level'},{value:'beginner',label:'Beginner-friendly only'},{value:'not-experienced',label:'Hide experienced-only'}]`.
- Settings: `showExperienceChip: true`, `experienceFilter: 'all'`.

- [ ] **Step 1: Tests** (`test/experience-level.test.js`) — table-driven:

```js
const beginner = [
  ['Virtual Assistant', 'No experience needed, we will train you'],
  ['Data Entry Specialist', 'Fresh graduates welcome'],
  ['Chat Support', 'newbies welcome, training provided'],
  ['Data Entry', 'Looking for someone reliable'],          // entry role in the title
  ['VA', 'Entry level position, willing to learn is enough'],
];
const experienced = [
  ['Virtual Assistant', 'At least 2 years experience with Shopify'],
  ['Senior Bookkeeper', 'QuickBooks'],
  ['Amazon PPC Manager', '3+ years of experience required'],
  ['Video Editor', 'Send your portfolio and case studies'],
  ['Lead Generation VA', 'experienced only, not for beginners'],
  ['Data Entry', 'minimum 1 yr exp, willing to learn'],    // years beats willing
];
const unclear = [
  ['Graphic Designer', 'Make banners for our store'],
  ['Project Coordinator', '2 years contract, renewable'],   // years not about experience
  ['Admin Assistant', 'Report to the senior manager daily'], // seniority only in title
];
```
Assert `judgeExperience(t, x).level` per table, that `matched` is non-empty for the two decided buckets and empty for unclear, and that `describeLevel` maps `beginner`→'Beginner-friendly', `experienced`→'Experienced', `unclear`→''.

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement** — phrase tables as `Object.freeze([...{id,label,pattern}])`; years guard regex: `/\b(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\s*(?:of\s+)?(?:\w+\s+){0,3}?(?:experience|exp)\b|\bexperience[^.]{0,20}\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b|\b(?:at\s+least|minimum(?:\s+of)?|min\.?)\s+(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i` with N ≥ 1; seniority regex applied to the title only: `/\b(senior|sr\.?|lead|head|manager|director|expert|specialist)\b/i`.
- [ ] **Step 4: Settings + criteria** — add keys; in `sanitize`, coerce `experienceFilter` to one of the three; criteria after `job-type`:

```js
if (settings.experienceFilter !== 'all') {
  const level = judgeExperience(facts.title, facts.searchText).level;
  if (settings.experienceFilter === 'beginner' && level !== LEVELS.BEGINNER)
    return { hide: true, reason: 'experience', ...base, extra: { level } };
  if (settings.experienceFilter === 'not-experienced' && level === LEVELS.EXPERIENCED)
    return { hide: true, reason: 'experience', ...base, extra: { level } };
}
```
`REASON_LABELS.experience = (f, extra) => extra.level === 'experienced' ? 'experienced' : 'not beginner-friendly'`. Criteria tests: three cases (beginner passes `beginner` filter; unclear hidden under `beginner`; experienced hidden under `not-experienced`, unclear kept).
- [ ] **Step 5: Content** — `filter.js` computes `level = settings.showExperienceChip ? judgeExperience(listing.title, listing.searchText) : null` and passes `level: describeLevel(level.level)`, `levelTone: level.level`, `levelWhy: level.why`; `meta-row.js` renders `ojrf-chip-level` after job type. `control-bar.js`: a third pill group "Level" with the three `EXPERIENCE_FILTERS`, emitting `{experienceFilter}`. Modal: after the description, `judgeExperience(job.title, description.textContent)`; if its level differs from the card's (passed via `context.level`) and is not unclear, add `<p class="ojrf-modal-note">Full description reads as: Experienced — 3+ years experience</p>`. Palette: three entries. Preset: `{ name: 'First job: beginner-friendly VA', group: <existing VA group>, hint: 'Listings that say they will train, at the default floor', searchKeywords: ['virtual assistant','data entry','admin'], experienceFilter: 'beginner' }` (match the existing preset shape in `presets.js`). Options Filter tab: a `SelectField` for `experienceFilter` and a checkbox for `showExperienceChip`.
- [ ] **Step 6: `npm test`, commit** — `feat: say when a listing is beginner-friendly`.

---

### Task 3: Employer book

**Files:**
- Create: `src/core/employer-book.js`, `test/employer-book.test.js`, `src/options/BlockedEmployers.jsx`
- Modify: `src/core/criteria.js` (reason `blocked-employer` after `dismissed`), `src/core/settings.js` (`hideBlockedEmployers: true`), `src/content/filter.js` (note chip, pass `book`), `src/content/meta-row.js` (`note` chip), `src/content/job-modal.js` (block/note buttons, `rememberSignals`), `src/content/main.js` (load book, subscribe, pass to `filter.apply` and modal), `src/core/backup.js` (+ `employerBook`, version 2), `src/options/Backup.jsx`, `src/options/App.jsx` (mount BlockedEmployers under the dismissed count), `test/criteria.test.js`, `test/backup.test.js`.

**Interfaces:**
- Produces: `sanitizeBook(raw, now) -> Map<employerKey, Entry>`, `loadBook()`, `setBlocked(name, blocked)`, `setNote(name, note)`, `rememberSignals(name, {newAccount, censored})`, `replaceBook(raw)`, `clearBook()`, `onBookChanged(cb)`, `isBlocked(book, name)`, `noteFor(book, name)`, `memoryFor(book, name) -> {newAccount, censored}|null`. `Entry = {name, blocked, note, newAccount, censored, seenAt, updatedAt}`. Storage key `ojRateFilterEmployers`. `MAX_ENTRIES = 2000`.
- Consumes: `employerKey` from `employers.js`.

- [ ] **Step 1: Tests** — sanitize drops non-objects, trims name, caps note at 500, prunes all-default entries, caps at MAX by oldest `updatedAt`, `isBlocked(book, 'Young Publisher ')` equals `isBlocked(book,'young publisher')`; mutators tested with a fake `chrome.storage.local` (follow `test/applications.test.js` for the fake).
- [ ] **Step 2: Run, expect failure.** **Step 3: Implement** mirroring `applications.js`.
- [ ] **Step 4: Criteria** — after `dismissed`: `if (settings.hideBlockedEmployers && isBlocked(book, facts.employer)) return { hide: true, reason: 'blocked-employer', ...base }` (`evaluateListing` gains `book = null`; `REASON_LABELS['blocked-employer'] = () => 'blocked employer'`). Tests: blocked hides, unblocked passes, no employer never hides.
- [ ] **Step 5: Content** — `filter.apply(..., history, book)`: note chip `note: noteFor(book, listing.employer)`; meta-row renders `ojrf-chip-note` (icon `note`: a small page glyph) with `text = note.length > 40 ? note.slice(0,39)+'…' : note`, `title = note`. Modal: actions gain `Block employer`/`Unblock` and `Note…` when `context.employer`; `createJobModal` takes `isBlocked(name)`, `onBlock(name, blocked)`, `getNote(name)`, `onNote(name, note)`; after `readEmployerSignals`, call `onRememberSignals(context.employer, { newAccount: Boolean(signals.newAccount), censored: signals.censored })` when the employer is named. `main.js`: `let book = new Map()`, `loadBook()` in `start`, `onBookChanged`, and render. Backup: `buildBackup` gains `employerBook`, `readBackup` accepts v1 without it, `describeBackup` counts it; restore replaces via `replaceBook`. Options: `BlockedEmployers.jsx` lists `[...book.values()].filter(e => e.blocked)` with an Unblock button, and a note count line.
- [ ] **Step 6: Commit** — `feat: block an employer and keep notes on them`.

---

### Task 4: Follow-up reminders

**Files:**
- Create: `src/core/follow-ups.js`, `test/follow-ups.test.js`, `src/core/badge.js`, `test/badge.test.js`
- Modify: `src/core/applications.js` (`usdPerMonth`, `followedUpAt`, `markFollowedUp(key)`), `src/core/settings.js` (`followUpDays: 7`, `showFollowUpChip: true`, `onlyFollowUps: false`), `src/core/criteria.js` (`not-follow-up` after `onlyNew`), `src/content/filter.js` + `meta-row.js` (`followUp` chip), `src/content/control-bar.js` (pill), `src/content/job-modal.js` (pass `usdPerMonth` to `onApply`, "Followed up" button), `src/content/main.js`, `src/background.js`, `src/popup/popup.{html,js,css}`, `test/applications.test.js`, `test/criteria.test.js`.

**Interfaces:**
- Produces: `dueFollowUps(applications, now, days) -> [{key,title,url,appliedAt,since,daysWaiting}]` where `since = followedUpAt ?? appliedAt`; `describeWaiting(days) -> 'applied 9d ago' | 'followed up 3d ago'` (takes `{daysWaiting, followedUp}`); `badgeText(due, fresh) -> ''|'12'|'99+'`; `markFollowedUp(key) -> Promise<Map>`.
- Background message: content scripts / popup send `{type:'refresh-badge'}`; the worker also listens to `storage.onChanged`.

- [ ] **Step 1: Tests** — `dueFollowUps`: only `applied` status; `appliedAt = now - 7d` is due at `days=7`, `now - 6d` is not; `followedUpAt` resets; sorted oldest first. `badgeText(0,0)==''`, `(3,4)=='7'`, `(100,0)=='99+'`. Applications: `setApplication(key,{usdPerMonth: 850})` stores it; `markFollowedUp` stamps `followedUpAt`, keeps status.
- [ ] **Step 2/3: Implement.**
- [ ] **Step 4: Wiring** — criteria: `if (settings.onlyFollowUps && !(application && isDue(application, now, settings.followUpDays))) return {hide:true, reason:'not-follow-up'}` with `REASON_LABELS['not-follow-up'] = () => 'not due'`; export `isDue(application, now, days)` from follow-ups. Meta: `followUp: 'follow up · 9d'` chip (`ojrf-chip-followup`, icon `clock`) when due and `showFollowUpChip`. Pill "Needs follow-up" toggles `onlyFollowUps`. Modal: `onApply(key, {title, url, usdPerMonth: chip.usdPerMonth})`; when the application is `applied` show a "Followed up" button calling `onFollowedUp(key)`. Background:

```js
async function paintBadge() {
  const [{ ojRateFilterApplications: apps }, settings] = ...; // read local + sync keys directly
  const due = dueFollowUps(sanitizeApplications(apps), Date.now(), settings.followUpDays ?? 7).length;
  const fresh = 0; // alerts come in Task 7
  await chrome.action.setBadgeBackgroundColor({ color: '#475569' });
  await chrome.action.setBadgeText({ text: badgeText(due, fresh) });
}
chrome.runtime.onStartup.addListener(paintBadge); chrome.runtime.onInstalled.addListener(paintBadge);
chrome.storage.onChanged.addListener(paintBadge);
chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'refresh-badge') paintBadge(); });
```
`background.js` becomes a module (`"type": "module"` in the manifest) so it can import core. Popup: a `#followups` section listing `dueFollowUps(...)`, each with a link (`chrome.tabs.create` needs no permission for a URL) and a "Followed up" button → `markFollowedUp`. Popup sends `refresh-badge` on open.
- [ ] **Step 5: Commit** — `feat: remind you to follow up on applications`.

---

### Task 5: Application funnel

**Files:**
- Create: `src/core/funnel.js`, `test/funnel.test.js`, `src/options/Applications.jsx`
- Modify: `src/options/App.jsx` (tab `applications`), `src/options/options.css`.

**Interfaces:**
- Produces: `summarize(apps) -> {total, byStatus: {applied, interviewing, offer, rejected}, responseRate: number|null}`; `byWeek(apps, now, weeks=12) -> [{weekStart: ISO date, applied, replies}]` oldest first, weeks start Monday 00:00 UTC; `byRateBand(apps) -> [{band: string, total, replies, responseRate}]` using `BAND_EDGES` exported from `benchmark.js` (export it if private; if the benchmark has no exported edges, define `RATE_BANDS = [0,300,500,800,1200,2000,Infinity]` in funnel.js and label them `'< $300'`, `'$300–499'`, …, `'$2,000+'`).
- Consumes: `loadApplications`, `setApplication`, `removeApplication`, `markFollowedUp`, `onApplicationsChanged`.

- [ ] **Step 1: Tests** — empty → `{total:0, responseRate:null}`; one of each status → rate 0.75; a record applied Sunday 23:59 UTC and one Monday 00:00 UTC land in different weeks; a record without `usdPerMonth` is in `summarize` but no band row; band labels.
- [ ] **Step 2/3: Implement.**
- [ ] **Step 4: UI** — `Applications.jsx`: funnel tiles, weekly table, band table, list with status `<select>`, Followed up, Remove, link. Hook onto `onApplicationsChanged`.
- [ ] **Step 5: Commit** — `feat: application funnel in the options page`.

---

### Task 6: Keyboard triage

**Files:**
- Create: `src/core/key-nav.js`, `test/key-nav.test.js`, `src/content/typing.js`, `src/content/keys.js`, `test/keys.test.js`
- Modify: `src/content/palette-ui.js` (import `isTyping`, export `openWith(query)`), `src/content/main.js`, `src/content/content.css` (`.ojrf-focused { outline: 2px solid …; outline-offset: 2px }`).

**Interfaces:**
- Produces: `nextIndex(count, current, delta) -> number` (−1 when count is 0; wraps); `KEY_BINDINGS = [{keys:['j','k'], does:'Next / previous listing'}, …]`; `createKeyboardTriage({ doc, visibleRecords: () => record[], isBlocked: () => bool, actions: {open, dismiss, apply, note, block, help} }) -> { refresh(), destroy() }`.
- `main.js` passes `isBlocked: () => palette is open || modal is open` (modal exposes `isOpen()`; palette exposes `isOpen()`).

- [ ] **Step 1: Tests** — `nextIndex(0,-1,1) === -1`, `nextIndex(3,2,1) === 0`, `nextIndex(3,0,-1) === 2`. jsdom: three cards, one with `ojrf-hidden`; press `j` twice → focus skips the hidden one; typing in an `<input>` and pressing `j` changes nothing; `d` calls `actions.dismiss` with the focused record.
- [ ] **Step 2/3: Implement** — keydown listener on `doc` (capture), ignore when `isTyping(event.target)`, `event.ctrlKey/metaKey/altKey`, or `isBlocked()`. Focus: toggle `ojrf-focused`, `scrollIntoView({block:'nearest'})`. `refresh()` is called by `main.js` after every render so a hidden focused card moves focus forward.
- [ ] **Step 4: Wire** — actions: `open: (r) => modal.open(r.href, {employer: r.employer})`, `dismiss: (r) => filter hooks onDismiss(r, true)`, `apply: (r) => { window.open(r.href,'_blank','noopener'); setApplication(jobKey(r.href), {title: r.title, url: r.href}) }`, `note`/`block` via the book with `window.prompt`/`confirm`-free toggling, `help: () => palette.openWith('Keyboard')`. Palette entry `Keyboard shortcuts` with hint joining `KEY_BINDINGS`.
- [ ] **Step 5: Commit** — `feat: keyboard triage`.

---

### Task 7: Saved-search alerts

**Files:**
- Create: `src/core/alerts.js`, `test/alerts.test.js`, `src/options/Alerts.jsx`
- Modify: `manifest.json` (`optional_permissions: ["alarms"]`, `optional_host_permissions: ["https://www.onlinejobs.ph/*"]`), `src/background.js`, `src/core/settings.js` (`alertsEnabled:false`, `alertIntervalMinutes:180`), `src/popup/*`, `src/core/backup.js` (`alertState`), `src/options/App.jsx`, `README.md`.

**Interfaces:**
- Produces: `ALERT_INTERVALS`, `MAX_WATCHED = 10`, `MAX_SEEN = 300`, `watchedSearches(searches, max)`, `jobKeysFromHtml(html) -> Set`, `diffSeen(previousSeen, found, {max}) -> {newKeys, seen, baseline: bool}`, `sanitizeAlertState(raw)`, `loadAlertState()`, `saveAlertState(state)`, `clearNewCount(nameKey)`, `clearAllNew()`, `totalNew(state)`, `ALERTS_KEY = 'ojRateFilterAlerts'`, `ALARM_NAME = 'ojrf-alerts'`.
- Background: `runAlertCheck()` — for each watched search, for each keyword, `fetch('https://www.onlinejobs.ph' + searchUrl(keyword, 0), {credentials:'omit'})`; union keys; `diffSeen`; store; `paintBadge()`. `chrome.alarms.onAlarm` → `runAlertCheck` when `alarm.name === ALARM_NAME`. `scheduleAlerts(settings)` creates/clears the alarm; called on startup, install, and when settings change. The options toggle calls `chrome.permissions.request({permissions:['alarms'], origins:['https://www.onlinejobs.ph/*']})` and only saves `alertsEnabled:true` on grant.
- `searchUrl` moves from `prefetch.js` to `src/core/search-url.js` (pure) and is re-exported from `prefetch.js`, so the worker can import it without DOM code.

- [ ] **Step 1: Tests** — `jobKeysFromHtml` on a fragment with two relative and one absolute job href, plus a non-job href → 3 keys; `diffSeen([], found)` → baseline, `newKeys: []`; `diffSeen(['a'], Set(['a','b']))` → `['b']`; cap keeps the newest 300; `watchedSearches` drops keyword-less searches and caps at 10 by name; `sanitizeAlertState` coerces junk.
- [ ] **Step 2/3: Implement.** **Step 4: Wire** background, options card (toggle/interval/watched list/last check/permission copy), popup "New matches" section (open link clears that search; "Mark all seen"), badge = due + new. Backup includes `alertState`.
- [ ] **Step 5: Commit** — `feat: saved-search alerts, opt-in`.

---

### Task 8: README, version, final verification

- [ ] README: add sections "Concerns at a glance", "Beginner-friendly or not", "Blocking an employer, and notes", "Following up", "The application funnel", "Keyboard", "Alerts for saved searches" in the house style; update the "What it never does" list (alerts fetch the site's own search pages only when you turned them on); update Architecture tree and Tests section.
- [ ] Bump `manifest.json` + `package.json` to `1.1.0`.
- [ ] `npm test`, `npm run build`, load in the debug Chrome profile (port 9222) and check: chips render, pills work, modal buttons, badge paints, popup sections, options tabs.
- [ ] Commit — `docs: README for the free-tier batch; version 1.1.0`.
