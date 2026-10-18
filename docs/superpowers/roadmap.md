# Roadmap: the free/premium feature list vs. what exists

Reconciling the 2026-08-20 feature list against what the extension already ships.
Status: **Built** (works today), **Partial** (some of it exists), **New** (not
yet). Tier per the `free-premium-split` memory: local/cheap = free, token-spend =
premium.

## Free — tools

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Advanced job search | **Partial** | Have: include & exclude keywords, a salary **floor**, employment type, date posted (max age), experience level (beginner/experienced), hide applied. Gaps: salary **range** (max as well as min), day/night **shift** keywords, generic **hide viewed** (we hide *dismissed*, not every viewed job). |
| 2 | Saved jobs (bookmark, favorite, saved page) | **New** | We have dismiss (hide) and applied, but no "save for later" list. Small local store like dismissed. |
| 3 | Application tracker, richer stages | **Partial** | Have: Applied / Interviewing / Offer / Rejected + a funnel tab + follow-up reminders. Add: **Saved, Preparing, Replied, Hired** stages, and the **local kanban** board view (drag between columns). |
| 4 | Per-job notes | **Partial** | We have *employer* notes (per employer). A note pinned to one *job* is new — a small local store keyed by jobKey. |
| 5 | Job tags | **New** | Free, local. Tag a job (High Priority, VA, Day Shift…), filter by tag. |
| 6 | Salary calculator (USD to PHP, hourly to monthly) | **Partial** | The conversion math exists (`normalize.js`) and drives badges; expose it as a small standalone tool in options/popup. |
| 7 | Application history (viewed / saved / applied / date) | **Partial** | Applied (with date), dismissed, and expired are tracked; "viewed" is not. Ties to #2 and a viewed-store. |
| 8 | Duplicate job warning | **Built** | `findReposts` — same employer + title, pay discounted; "posted twice" / "1 of N copies". |
| 9 | Basic job comparison (manual) | **New** | Free, local: pick 2–3 jobs, table salary/schedule/type/skills/company/date. |
| 10 | Basic dashboard | **Built** | The Applications tab (counts, by week, by rate band). Broaden to include saved/tags. |

Also already free and not on the list: the concerns chip, rate benchmarking,
page-merge, saved searches + alerts, keyboard triage, the job-page strip with
email/subject copy, employer block, backup.

## Premium — AI, per-credit

| # | Feature | Status | Notes |
|---|---|---|---|
| 6 | AI application drafter | **Built** | `POST /api/drafts`, 1 credit, refund on failure, now profile-aware. (List says 2 credits; currently 1 — a pricing choice.) |
| 1 | AI job fit analysis | **New** | Job + profile → match/skills/gaps. |
| 2 | Should I apply? | **New** | A verdict on top of fit. |
| 3 | AI job summary | **New** | Long post → structured summary. |
| 4 | AI requirement extractor | **New (upgrades a free heuristic)** | We already detect a demanded subject/email/red-flags **locally, free**; the AI version finds the subtler "answer these questions / include internet speed / start with BLUE". Was "Feature C — how to apply"; premium confirmed. |
| 5 | AI red-flag analysis | **New (upgrades a free heuristic)** | Local phrase red-flags ship free; the AI version reasons about the whole post. |
| 7 | Application rewrite | **New** | Shorter / more natural / more confident, over an existing draft. |
| 8 | Application quality score | **New** | |
| 9 | Answer generator | **New** | Answer questions the post asks. |
| 10 | Résumé-to-job matcher | **New** | |
| 11 | AI profile optimizer | **New** | Improve an OLJ profile. Pairs well with the new profiles store. |
| 12 | Salary intelligence | **New (partial base)** | Effective hourly/monthly exists; the "vs your target / vs jobs seen" analysis is new. |
| 13 | AI job comparison | **New** | The AI-ranked sibling of free #9. |
| 14 | AI interview preparation | **New** | (Confirmed premium earlier.) |
| 15 | STAR answer generator | **New** | |
| 16 | AI mock interview (5 credits/session) | **New** | Multi-turn — the biggest build. |
| 17 | Interview answer review | **New** | |
| 18 | AI follow-up drafter | **New** | Follow-up / thank-you. Reuses the draft plumbing. |
| 19 | AI career analytics | **New** | Over the local application history. |

## Shape confirmations

- **No subscription; buy credits** — matches the built ledger (per-use credits,
  `signup_bonus`, and the future PayMongo top-up).
- **Credit tiers** 1 / 2 / 3–5 by task weight — a pricing table to apply when each
  premium feature lands; drafts are currently 1.
- **Resilience to OLJ changes** — the free tier's value is local tools, and
  credits aren't a subscription tied to a specific OLJ layout. Aligns with the
  extension's "two site-coupled constants" design.

## Suggested next free slices (cheap, high-value, mostly local)

1. **Saved jobs** (#2) + **hide viewed** (#1 gap) — one small viewed/saved store.
2. **Application tracker → kanban** (#3) — extend statuses, add a board view.
3. **Per-job notes** (#4) and **tags** (#5) — one keyed-by-jobKey store each.
4. **Salary calculator** (#6) — expose the existing math.

Premium builds all reuse the drafts path (auth → ledger → model → panel), so the
cheapest next premium is **rewrite / follow-up** (same shape as drafts), then the
**analysis family** (fit / should-I-apply / summary) which share one "analyze this
job against this profile" call.

## Progress — 2026-08-20 (free batch shipped)

Built and committed this session (44 new unit tests, full suite 1205 green):

- **Saved jobs** (#2) — `saved.js` store; Save toggle in the job modal; a
  **Saved** options tab listing each with a link, employer, rate, remove.
- **Per-job notes** (#4) and **tags** (#5) — `job-notes.js` / `job-tags.js`;
  edited on each card in the Saved tab (note textarea, tag chips, tag filter).
- **Hide viewed** (#1 gap, #7) — `viewed.js`; every opened job is recorded;
  `criteria` gains a `viewed` hide reason behind the off-by-default
  `hideViewed` setting (ranked below applied/dismissed); Filter-tab toggle.
- **Salary calculator** (#6) — `salary-calc.js` pure converter + a **Calculator**
  options tab (amount × currency × period → per hour/month in USD & PHP).
- **Backup v4** — all four new stores export/restore; older backups restore empty.

Still open (free):
- **Application tracker → kanban** (#3) — DEFERRED. Extending
  `APPLICATION_STATUSES` breaks the funnel's `isReply = status !== 'applied'`
  semantics, and the drag board is real UI. Needs its own brainstorm + plan
  (redesign funnel reply-detection; add Saved/Preparing/Replied/Hired; board view).
- **Job comparison** (#9) — New. Leans on the saved-jobs store now in place.
- Entering notes/tags directly on the job page/modal (today they are edited in
  the Saved tab; the modal only has Save). A modal note/tag affordance is a
  cheap follow-up.

See also memory **login-gated-credits**: registration + all credit use must be
gated on an OnlineJobs.ph login — a premium/auth slice, not free.

## Progress — 2026-08-20 (kanban + the rest, live-verified)

- **Application tracker → kanban** (#3) — DONE. Seven stages (Preparing, Applied,
  Replied, Interviewing, Offer, Hired, Rejected); funnel reply-detection fixed
  (`isReplyStatus`/`isPreApplication`, response rate over *submitted*); a
  drag-between-columns board with a per-card status menu. Saved-tab **Track**
  promotes a saved job into Preparing.
- **Job comparison** (#9) — DONE. Tick Compare on up to 3 saved jobs → a
  side-by-side table (pay/employer/tags/saved), best pay marked.
- **Modal note/tags** — DONE. A private note + tag chips inline in the job modal,
  wired to the same stores the Saved tab uses.

Live-verified in the debug Chrome (extension reloaded via CDP): Saved + Calculator
tabs render; calculator computes; opening a job shows the Save button + note/tag
block; Save → Saved tab (with the tag) → Track → the card lands in the board's
Preparing column across all seven stages. Test artifacts cleaned from storage.

Free tier remaining: only polish (e.g. showing a job's own tags as chips on the
list card; a list-level tag filter on the page). Everything substantive from the
free list is now built.

## Solidification pass — 2026-08-20 (audit-driven hardening)

The whole free tier is feature-complete; this pass hardened it. A multi-agent
audit ran over every free feature; findings were fixed in rounds, each gated on
a green build + full suite. Trajectory (converging): round 1 = 22 findings,
round 2 = 7 (incl. one regression the round-1 fixes introduced), round 3 = the
employer field not threaded through every application entry point + a
non-idempotent tag remove; the store write-queue refactor was audited **clean**.

Dominant theme fixed: **silent lost writes**. Every job store (saved, viewed,
applications, job-tags, job-notes) now serializes its writes through
`core/queue.js`, so concurrent edits can't clobber. Other fixes: `javascript:`/
`data:` URLs neutralised (`core/safe-url.js`); an inverted salary band no longer
hides every listing; the `employer` field is carried to every place an
application is first recorded; backup restore has error handling; the board
modal closes on Escape from inside its iframe and manages focus; a
viewed-jobs count/clear control; keyboard-operable promotion; idempotent tag
add/remove; honest salary-calc assumptions. New tests throughout (suite 1228).

## Board redesign — remaining requests (2026-08-20, for a fresh session)

Delivered so far: colored full-height lanes with icons, tags + employer on cards,
per-lane "+ Add job", card kebab (move/tag/followed-up/delete), lane kebab
(rename/hide), click-title-to-rename. Still requested by the user, deferred
because this session hit its context limit — each is a real change, not polish:

1. **Add a custom column** (top menu). Needs board-config to store custom
   columns `[{value,label}]` and applications to carry a non-canonical status
   (relax sanitizeRecord's coerce-to-'applied'; check funnel/isReplyStatus
   ripple). The biggest one.
2. **Rearrange (reorder) swimlanes** — store a lane `order:[values]` in
   board-config; drag lane headers (HTML5 DnD) to reorder; apply in columnsFor.
3. **Kanban settings modal** off the top toolbar — move "Reset lanes to
   defaults" (currently an inline button) into it, plus future board options.
4. **Card left-border colour** — per-card colour with a default palette the user
   can extend (store a colour per jobKey, and the custom palette, in a new store
   or board-config); a colour picker in the card kebab.
5. **Tags management** — a place to rename/merge/delete tags across all jobs and
   see counts (a Tags admin view; job-tags store already keyed by jobKey).

All are additive to the existing stores; none block each other. Suggested order:
2 and 3 (cheap, board-config only), then 4 and 5 (new small stores), then 1.

## Board redesign — delivered (2026-08-20, live-verified)

All five remaining items above are now built, tested, and verified in the debug
Chrome. Suite 1241 → 1266 (+25 unit tests).

1. **Custom column** — `board-config` stores `columns:[{value,label}]`; a lane's
   value is namespaced `custom-…` so it can never collide with a built-in stage.
   `applications.js` gained `isCustomStatus`/`isStorableStatus`; `sanitizeRecord`
   and `setApplication` now keep a custom status instead of coercing it to
   `applied`. Added from the board-settings modal; deleted from the lane kebab
   (its cards return to Applied so nothing orphans).
2. **Reorder lanes** — `board-config` stores `order:[values]`; `columnsFor`
   applies it (unlisted lanes keep default place). Drag a lane header, or use the
   lane kebab's Move left / Move right.
3. **Board settings modal** — a ⚙ Board button on the toolbar opens a dialog:
   add a column, tag manager, saved-colour palette, and Reset lanes to defaults
   (the old inline reset button is gone).
4. **Per-card colour** — new `job-colors.js` store (jobKey→hex); a swatch row in
   the card kebab (built-in palette + user-added colours saved in
   `board-config.palette`); the card's left border uses its colour, falling back
   to the lane colour. In backup **v6**.
5. **Tag management** — `job-tags.js` gained `tagCounts` / `renameTagEverywhere`
   (rename = merge on collision) / `deleteTagEverywhere`; a Tags section in the
   settings modal lists every tag with its count, renames in place, deletes
   across all jobs.

Also this pass — **card polish** the user asked for: unified `JobCard` component
(Saved + application lanes share one card), a hover drag-grip (top-left), the
card kebab moved to the lower-right, and a uniform card min-height so title-only
cards don't look cramped. **Componentization**: the board's cards, menus
(`LaneMenu`/`CardMenu`), settings dialog and tag rows are now discrete
components, so the board reads consistently and future changes touch one place.

Backup is now **v6** (adds `jobColors`; v5 and older restore no colours).

## Tag system, card editing, dates & history — delivered (2026-08-20)

A second board pass, all live-verified by driving the real UI (CDP clicks/typing,
React handling native events). Suite → 1280.

- **Coloured tags + default tags for one-click selection** — new `tags-catalog.js`
  (8 defaults with colours, `tagColor`, `tagChipStyle`) + `tag-colors.js` store
  (tagLower→hex). Tag chips are tinted everywhere they show: board cards, the card
  kebab picker, the Saved tab, and the job modal.
- **Per-card tag manager** — the card kebab lists current tags (removable) and
  one-click suggestions (defaults + used tags), plus a new-tag field; the menu
  stays open so several tags add in a row. **Fixed** the modal's "can't add a
  second tag" bug (it re-created the input without refocusing).
- **Tag management + colorize** — the board-settings Tags section recolours,
  renames (rename = merge, carries the colour), and deletes across all jobs.
- **In-place card editing** — a card-kebab "Edit details…" opens an editor for
  title / employer / link / rate / description (the per-job note). Editing an
  application preserves its stage (was resetting to Applied).
- **Card dates** — each card shows "Saved …" / "Updated …".
- **Application stage history** — `applications.js` records a `{status, at}` trail
  on every stage move (not on field edits); the editor shows the timeline. Carried
  by the existing applications backup (no version bump).
- Backup **v7** adds `tagColors`.

Also written: `oljextension/PAID-FEATURES-ANALYSIS.md` — a strategic analysis of
which paid features to build and in what order (analysis only, no implementation),
grounded in IDEAS.md, IMPLEMENTATION.md, NOTIFICATION.md, and the existing ledger.

## New free features batch — delivered (2026-08-20)

Beyond the original free list, this batch added net-new local (no-credit) features.
Full suite 1281 → 1312.

1. **Gig minimum fee** — `settings.minFixedFeeUsd`: keep gigs/fixed-price work on
   the list but hide the ones paying below a floor you set (Filter tab). The
   existing `hideTaskBased`/`hideNoRate`/`hideNegotiable`/`hideUnclearRate`
   toggles already covered "hide all gigs" — this is the "show the good ones".
2. **Funnel velocity** (`funnel.js`) — avg/median days-to-reply and a "gone
   quiet" list of applications waiting 14+ days, all from the stage-history
   trail; shown in the Stats panel.
3. **Board Export** — a toolbar button dumps every saved job + application to a
   spreadsheet (.tsv) via the existing `job-export` util.
4. **Note checklists** (`checklist.js`) — `- [ ] task` lines in a card's
   description render as tickable checkboxes; ticking rewrites the note text.
5. **Next-action dates** — per-application `nextActionAt`/`nextActionLabel`
   (`setNextAction`), a card badge (overdue in red), and a local **.ics**
   calendar export (`ics.js`). No email/SMS — that stays the premium line.
6. **Text snippets** (`snippets.js` + Snippets tab) — a local library of your own
   templates with one-click copy. Backup **v8**.
7. **Local skill-match** (`skill-match.js`) — a "Skills 4/7" chip on the job page
   from your `requiredSkills` vs the post; a free preview of the paid AI fit.
8. **Dark mode** — `settings.theme` (System/Light/Dark) in the Display tab;
   `main.jsx` resolves it and themes the options page + board (never OLJ itself).

Also answered a filter question: two jobs showing despite a min rate were a
piece-rate ("$1-$5 per approved comment") and a gig fixed fee ($250) — neither
has a monthly figure to judge, so the floor never applied; `hideTaskBased` (or
the new gig minimum) is the control for those. All live-verified by driving the
real UI in the debug Chrome.
