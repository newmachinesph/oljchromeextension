# Free-tier batch: seven local features

Date: 2026-08-20. Branch: main.

Seven features that run on the reader's own machine. Six send nothing anywhere;
the seventh (saved-search alerts) fetches the site's own search pages from the
service worker, which is the one new network behaviour and the one new
permission set, and is off by default.

Export was on the original list and is dropped: "Copy every loaded listing" and
the Backup tab's application export already cover it.

Build order, chosen so each feature lands on the one before it:

1. Concerns chip (rolls up warnings already computed)
2. Beginner-friendly identification (same chip rail, same phrase-table pattern)
3. Employer book: block + notes (a store the chip and the modal both read)
4. Follow-up reminders (badge on the toolbar icon; first service-worker logic)
5. Application funnel (options tab over the same store)
6. Keyboard triage (bindings over things 1-4 made possible)
7. Saved-search alerts (alarms + host permission; last because it is the only
   one that changes the permission story)

Every feature follows the existing split: pure logic in `src/core/` with a
unit test, DOM wiring in `src/content/`, React in `src/options/`.

---

## 1. Concerns chip

**What.** One chip per card, first on the meta row, that states every reason to
read the listing carefully, instead of a separate chip per reason.

**Inputs**, all already computed in `filter.js` or remembered locally:

| concern | source | label |
|---|---|---|
| costly-terms phrases | `findRedFlags(searchText)` | the flag's own label |
| advertised >= 3 weeks | `weeksAdvertised` + `describeStaleness` | "advertised 5 wks" |
| rate at the low end | `rateStanding` -> `standingTone === 'low'` | "below going rate" |
| new employer account | employer book memory (see section 3) | "new employer" |
| contact details censored | employer book memory | "censored post" |

**Core.** New `src/core/concerns.js`, pure:

```
gatherConcerns({ flags, staleness, standingTone, employerMemory })
  -> [{ id, label, why }]           // declaration order, most serious first
describeConcerns(list)  -> 'asks for money +2'   // first label, then a count
explainConcerns(list)   -> 'asks for money: ...\nadvertised 5 wks: ...'
```

Red flags lead, then employer memory, then staleness, then standing. The count
suffix is `+N` rather than a bare number so a single concern reads as itself.

**Content.** `filter.js` builds the list per listing and passes
`concerns`/`concernsWhy` to `renderMeta`, replacing today's `redFlags` and
`staleness` chips with one `ojrf-chip-flag` chip. The employer count chip stays
(it is context, not a warning). The standing arrow on the rate chip stays.

**Settings.** No new keys. `showRedFlags` and `showStaleness` decide whether
those two sources contribute; `showBenchmark` gates the standing source. The
chip shows when the list is non-empty.

**Hiding.** `hideRedFlagged` is unchanged: it still hides only on phrase flags.
Staleness and standing never hide.

**Tests.** `test/concerns.test.js`: ordering, counting, each source present and
absent, empty input -> empty list.

---

## 2. Beginner-friendly identification

**What.** Each listing is judged *beginner-friendly*, *experienced*, or
*unclear*. Friendly and experienced get a chip; unclear shows nothing. An
opt-in filter can narrow to beginner-friendly or hide experienced-only.

**Core.** New `src/core/experience-level.js`, pure:

```
LEVELS = { BEGINNER: 'beginner', EXPERIENCED: 'experienced', UNCLEAR: 'unclear' }
BEGINNER_PHRASES    -> [{ id, label, pattern }]  // "no experience needed", "will train",
                                                 // "fresh graduates", "newbies welcome",
                                                 // "entry level", "willing to learn",
                                                 // "training provided", "we will teach"
EXPERIENCED_PHRASES -> [{ id, label, pattern }]  // "N+ years", "at least N years",
                                                 // "minimum N yrs", senior/lead/manager/
                                                 // expert/specialist in the title,
                                                 // "proven track record", "send portfolio",
                                                 // "case studies", "certified",
                                                 // "experienced only", "not for beginners"
ENTRY_ROLE_PHRASES  -> data entry, lead generation, appointment setting,
                       transcription, chat support, email support, general VA
judgeExperience(title, text) -> { level, matched: [{id,label}], why }
describeLevel(level) -> 'Beginner-friendly' | 'Experienced' | ''
```

Rules, in order: any experienced phrase -> `experienced` (a poster saying both
"2 years" and "willing to learn" means 2 years). Else any beginner phrase, or an
entry-role phrase in the title -> `beginner`. Else `unclear`.

"N years" only counts when N >= 1 and the phrase is about experience
(`years? (of )?(experience|exp)` or `experience.{0,20}years?`), so "2 years
contract" does not mark a job experienced. Seniority words match the title
only, since a body saying "report to the senior manager" is not about you.

**Content.** The chip (`ojrf-chip-level`, `data-level`) sits after the job type
chip. Title: the matched phrases, so the verdict is explainable. The modal
re-judges on the full description and, when its verdict differs from the card's
(the card only saw an excerpt), shows the fuller verdict as a note line.

**Settings.** `showExperienceChip: true`; `experienceFilter: 'all' | 'beginner'
| 'not-experienced'` (default `'all'`). `SEARCH_FIELDS` gains
`experienceFilter`, so a saved search can carry it. Criteria reason
`'experience'` with stub "experienced" / "not beginner-friendly", placed with the
other list-shaping rules after `job-type`. Palette gets "Show only
beginner-friendly jobs" / "Hide experienced-only jobs" / "Show every experience
level". The sidebar pills row gains a three-way pill group.

**Shipped preset.** `presets.js` gains "First job: beginner-friendly VA" with
`experienceFilter: 'beginner'`, the default rate floor, and admin/VA keywords.

**Tests.** `test/experience-level.test.js` with a table of real-shaped phrases
for each bucket, the precedence rule, the "years" guard, and the title-only
seniority rule. `criteria.test.js` gains the new reason.

---

## 3. Employer book: block and notes

**What.** Block an employer (every listing of theirs collapses, like a
dismissal) and keep a note on an employer, shown on each of their cards and in
the modal. The same store remembers what the job page said about the employer
(new account, censored post) so section 1 can show it on the card next time.

**Core.** New `src/core/employer-book.js`, `chrome.storage.local`, keyed by
`employerKey(name)`:

```
Entry = { name, blocked: bool, note: string (<= 500), newAccount: bool|null,
          censored: bool|null, seenAt: number, updatedAt: number }
MAX_ENTRIES = 2000 (oldest updatedAt dropped)
sanitizeBook(raw) -> Map
loadBook() / onBookChanged(cb)
setBlocked(name, blocked) / setNote(name, note) / rememberSignals(name, {newAccount, censored})
replaceBook(raw) / clearBook()
```

An entry that ends up all-default (not blocked, empty note, no signals) is
removed rather than kept. Listings with no employer name cannot be blocked or
noted; the controls are simply absent for them.

**Content.**
- Criteria: reason `'blocked-employer'`, checked right after `dismissed`
  (it is also a decision you made). Stub: "blocked employer". Setting
  `hideBlockedEmployers: true`.
- Meta row: when a note exists, a `ojrf-chip-note` chip with the first ~40
  chars and the full note as title. Not a concern - it is yours.
- Modal actions row gains "Block employer" / "Unblock" and "Note..." (a
  `window.prompt` prefilled with the current note - the same one-prompt rule as
  naming a search). Both are absent when `context.employer` is empty.
- Modal: after `readEmployerSignals`, `rememberSignals(employer, {...})` when
  the employer is named. Never reads a page to do it.
- Options -> Backup includes the book; Options -> Filter gets a "Blocked
  employers" list with unblock buttons, next to the dismissed count.

**Tests.** `test/employer-book.test.js`: sanitizing, cap, default-entry
pruning, key normalisation ("Young Publisher " == "young publisher").
`criteria.test.js` gains `blocked-employer`.

---

## 4. Follow-up reminders

**What.** An application that has sat in `applied` for N days (default 7,
settable 1-60) is "due for follow-up". The toolbar icon shows the count as a
badge; the card gets a small "follow up" chip; the bar gets a "Needs follow-up"
pill that narrows the list to those; the popup lists them with links.

**Core.** New `src/core/follow-ups.js`, pure:

```
FOLLOW_UP_DAYS_DEFAULT = 7
dueFollowUps(applications: Map, now, days) -> [{ key, title, url, appliedAt, daysWaiting }]
   // status === 'applied' only; interviewing/offer/rejected are not waiting on you
   // sorted oldest first
describeWaiting(daysWaiting) -> 'applied 9d ago'
```

Applications gain an optional `usdPerMonth` (set from the modal's chip when
known) and `followedUpAt` - pressing "Followed up" on the popup or modal stamps
it and resets the clock; the record stays `applied`.

**Settings.** `followUpDays: 7`, `showFollowUpChip: true`. A pill
`onlyFollowUps` (default false, not saved to searches) is a list-shaping rule
like `onlyNew`: criteria reason `'not-follow-up'`.

**Background.** `background.js` learns to paint the badge:
`chrome.action.setBadgeText` with the due count (empty when 0), recomputed on
`onStartup`, `onInstalled`, on `storage.onChanged` for the applications key or
the settings key, and on a daily `chrome.alarms` tick once section 7 adds the
permission; until then a recompute also happens whenever the popup or a content
script loads. Badge colour: a neutral slate, not red - this is a todo, not an
alert.

**Popup.** A "Follow-ups" section above the account pane: each due
application's title (link, opens the job), "applied 9d ago", a "Followed up"
button. Hidden when none are due.

**Tests.** `test/follow-ups.test.js`: status filtering, threshold boundary,
`followedUpAt` resetting the clock, ordering.

---

## 5. Application funnel

**What.** An "Applications" tab on the options page: the funnel, a weekly
table, and the list itself.

- Funnel: counts for Applied / Interviewing / Offer / Rejected, and a response
  rate = (interviewing + offer + rejected) / total, since a rejection is also
  a reply.
- By week: rows of ISO weeks (last 12), columns applied / replies, computed
  from `appliedAt` and `updatedAt`.
- By rate band: for applications carrying `usdPerMonth`, response rate per
  band using the benchmark's existing band edges (`benchmark.js`).
- List: every application, newest first, with status select, "Followed up",
  remove, and the link. The Backup tab's export is unchanged.

**Core.** New `src/core/funnel.js`, pure:

```
summarize(applications) -> { total, byStatus, responseRate }
byWeek(applications, now, weeks = 12) -> [{ weekStart, applied, replies }]
byRateBand(applications) -> [{ band, total, replies, responseRate }]
```

**Tests.** `test/funnel.test.js`: empty, one of each status, week boundaries
at Monday 00:00 UTC, band assignment, records without a rate excluded from
band rows but counted in the funnel.

---

## 6. Keyboard triage

**What.** Move through visible cards and act on the focused one without the
mouse. Bindings only fire when focus is not in a text field and the palette and
modal are closed.

| key | action |
|---|---|
| `j` / `k` | focus next / previous visible card (wraps, scrolls into view) |
| `Enter` / `o` | open the focused job in the modal |
| `d` | dismiss the focused card |
| `a` | open the focused job's apply page in a new tab and record the application |
| `n` | note on the focused job's employer (prompt) |
| `b` | block the focused job's employer |
| `?` | open the palette prefilled with "Keyboard" - a command that lists these |

**Content.** New `src/content/keys.js`: `createKeyboardTriage({ filter,
actions })`. Focus is a class `ojrf-focused` on the card, with a visible
outline in `content.css`; it never moves a node. The focused card is dropped
when a render hides it (focus jumps to the next visible). `isTyping` is shared
with `palette-ui.js` (moved to a tiny `src/content/typing.js`).

**Core.** `src/core/key-nav.js`, pure: `nextIndex(visibleCount, current,
delta)` and `KEY_BINDINGS` (the table above, for the palette's help entry).

**Tests.** `test/key-nav.test.js` for wrapping and empty lists;
`test/keys.test.js` (jsdom) for j/k focus movement, the typing guard, and that
a hidden card is skipped.

---

## 7. Saved-search alerts

**What.** Opt-in. The service worker re-fetches the first page of each saved
search that has keywords, on a timer, and counts job links it has not seen
before. The toolbar badge shows the total; the popup lists per-search counts
with a link that opens the search and clears its count.

**Honest limits, stated in the options page and README.**
- A service worker has no DOM, so no rate parsing: "new" means a new listing
  for those keywords, not a listing that passes the search's rate floor. The
  page itself still filters the moment it opens.
- First page only, one request per keyword per tick, at most 10 searches
  (alphabetical by name; the options page says which are watched).
- Off by default. Turning it on grants nothing silently: the permissions are
  requested at enable time with `chrome.permissions.request` - `alarms` and
  `https://www.onlinejobs.ph/*` are listed as `optional_permissions` /
  `optional_host_permissions` in the manifest, so the install-time prompt is
  unchanged. If the request is declined, the toggle stays off.

**Core.** New `src/core/alerts.js`, pure:

```
ALERT_INTERVALS = [60, 180, 360, 720, 1440]  // minutes; default 180
watchedSearches(searches, max = 10) -> those with searchKeywords, by name
jobKeysFromHtml(html) -> Set<string>   // regex over href="/jobseekers/job/...", via jobKey()
diffSeen(previousSeen: string[], found: Set) -> { newKeys: string[], seen: string[] }
   // first run (previousSeen empty) records a baseline and reports no new keys
sanitizeAlertState(raw) -> { bySearch: { [nameKey]: { seen: string[], newCount, checkedAt, lastError } } }
```

State lives in `chrome.storage.local` under `ojRateFilterAlerts`; `seen` is
capped at 300 keys per search.

**Background.** On the alarm: for each watched search, `fetch(searchUrl(keyword,
0))` for each keyword, union the keys, diff, store, then repaint the badge as
follow-ups due + new matches. The badge text is the sum; the popup breaks it
down. Failures per search are logged to the state (`lastError`) and shown in
the popup, never thrown.

**Settings.** `alertsEnabled: false`, `alertIntervalMinutes: 180`. The options
page Filter tab gets an "Alerts" card: toggle, interval, the watched list, last
check time, and the permission explanation.

**Popup.** "New matches" section: per search, "`name` - 4 new" with an open
link (`/jobseekers/jobsearch?jobkeyword=...`, first keyword); opening clears that
search's `newCount`. "Mark all seen" clears all.

**Tests.** `test/alerts.test.js`: key extraction from realistic HTML
fragments, baseline behaviour, cap, watched-list selection and cap, sanitize.

---

## Cross-cutting

- **Backup** (`backup.js`) gains the employer book and the alert state
  (`BACKUP_VERSION` -> 2; v1 files still restore).
- **README** gains a section per feature in the house style, and the
  permissions paragraph changes to describe the optional permissions.
- **Version** bumps to 1.1.0.
- **No new hard permissions.** `alarms` and the onlinejobs.ph host permission
  are optional and requested on enabling alerts. The badge needs none.
- **Commits**: one per feature, conventional `feat:` messages, tests green
  before each.

## Out of scope

Cloud sync, server-side fetching, AI features, PayMongo, and anything that
reads a page the reader did not open.
