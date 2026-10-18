# Employer side: the plan

Date: 2026-08-21. Branch: main. Status: product plan, nothing built.

## Why

The extension is jobseeker-only: content scripts match `/jobseekers/jobsearch*`,
`/jobseekers/job/*`, `v2.onlinejobs.ph/jobseekers*`. Employers get nothing.

OnlineJobs sells employers three tiers: **Free** (3 posts, 15 applicants per
post), **Pro $69/mo** (200 applicants per post, 75 contacts/mo) and **Premium
$99/mo** (+ AI Matching, Background Data Check, Worker Reviews, Worker
Mentoring, Contracts & Documents, 500 contacts/mo). Almost nobody buys Premium.
Its value is mostly *information the employer can already reach* plus
convenience. We build that layer ourselves — deeper, explainable, and priced
well under $99 — on the credit ledger and catalog engine that already exist in
`oljextension/`.

Survey basis: a real employer account walked read-only on 2026-08-21 — 3 active
posts, 366 applicants, **0 messages ever sent**, 356 unread. That inbox is the
problem statement.

## What the employer pages are

All on `v2.onlinejobs.ph` — a Next.js/Tailwind app with stable `data-cy`
attributes everywhere, far easier to inject into than the jobseeker pages.

| Page | URL | Holds |
|---|---|---|
| Dashboard | `/myaccount` | job cards: status, *N Applicants*, *Hits*, Edit / Delete / "Refresh in N days"; Your Workers (Timeproof); pinned workers |
| Applicant inbox | `/message/jobs/<key>`, `/message/job/all-applicants` | 20 rows per scroll (Radix scroll-area, "Loading messages.."); row = name, avatar, **AP badge**, subject, date, pin, checkbox, `(n)` repeat suffix; sidebar: Labels, 1–5★ rating filter |
| Thread | `/message/conversation/<key>` | message HTML, email, "First contacted for Job", Trix editor (+ Attach Files), quick verdicts, right rail (below) — **opening marks it read** |
| Worker profile | `/jobseekers/info/<id>` | everything in the rail plus tests, skills with experience bands, employment status |
| Pinned workers | `/employer/bookmarks` | pinned profiles with "Pin notes" |
| Sent / Pinned / Archive / Search | `/message/sent` … | standard folders |
| Background Data Check | `/background-data-check` | Premium upsell only on non-Premium accounts |
| Pricing | `/pricing` | tier facts above |

On `www.onlinejobs.ph` (separate session; **not yet surveyed**, needs a www
login): post-a-job form, `/employer/jobs`, `/employer/editjob/<id>`, talent
search `/employers/advancesearch` (filters seen: employment type, hours/day,
hourly USD range, ID proof ≥ 40–90, last active, IQ, English, skills rated
1–5★, "include hired"), Timeproof, EasyPay.

### Site controls we drive instead of duplicating state

`set-applicant-rating-1..5`, `label-thread-button`, `label-add`,
`label-manage`, `pin-worker-button`, `mark-as-hired-button`, `thread-archive`,
`thread-<id>-archive-button`, `thread-checkbox-<id>`, `pin-button-<id>`,
`job-application-love-it`, `job-application-did-not-follow-directions`,
`job-application-unqualified`, `trix-send-button`, `bottom-menu-quick-view`,
`bottom-menu-more-spam`, `bottom-menu-more-delete`, `applicant-rating-filter-N`.

### What one applicant yields (verified)

| Source | Fields |
|---|---|
| inbox row | thread id, conversation URL, name, avatar, **AP spent** (1–50), subject, timestamp, pinned, repeat `(n)` |
| thread | message HTML + links (Drive résumés, portfolios), email, originating job, headline, your rating/labels/hired, **résumé PDF link**, phone, email, "Looking for full-time (8 h/day) at $X/h ($Y/mo)", last active, education, experience overview, profile id |
| profile | **Current Employment Status** ("Hired Part Time on …"), ID Proof score + verified upload, **Timeproof**, member since, last active, description, top/other skills with category path + experience band, website/LinkedIn, address, age, gender, IQ, DISC, English CEFR |
| résumé PDF | `/resume/view?url=<media pdf>` returns `application/pdf` same-origin (verified) → pdf.js text |
| your posting | wage, hours/week, skills, **application instruction** ("Start with CARE", "Include: …") |

Dossier record shape (synthetic):

```json
{ "workerId": "123456", "threadKey": "abcd1234", "name": "J. Dela Cruz",
  "apSpent": 10, "subject": "CARE - Application", "appliedAt": "2026-08-21T06:31:00+08:00",
  "askedRate": { "raw": "$3.00/hour ($528.00/month)", "usdMonth": 528, "hoursPerDay": 8 },
  "idProof": 95, "idVerified": true, "timeproof": true, "english": "B2", "iq": 110,
  "lastActiveAt": "2026-08-21", "memberSince": "2016-03-05",
  "employment": { "status": "hired-part-time", "since": "2023-12-18" },
  "skills": [{ "path": ["Human Resources", "Recruiting"], "band": "1-2y" }],
  "resume": { "url": "...", "text": "…", "fetchedAt": "2026-08-21T03:00:00Z" },
  "checks": { "instruction": true, "boilerplate": false, "duplicateOf": null } }
```

Not reachable: Background Data Check contents (past-employer reviews,
site-wide application log, profile-edit log). Say so in the UI; never fake it.

Not to be used: age and gender are displayed by the site. We do not filter,
sort or score on them.

## Premium, feature by feature

| Premium | Ours |
|---|---|
| AI Matching | Fit score per applicant with per-criterion reasons, over message + profile + **résumé text**; ranked shortlist and "why not" |
| Background Data Check | Identity Signals panel (ID proof, verified upload, Timeproof, member age, links) + our own checks: repeat applications, boilerplate, résumé↔profile consistency, already-employed. Gap labelled. |
| Contracts & Documents | Contractor agreement, NDA, offer letter, SOW, confidentiality addendum, COE, end-of-contract, review form |
| Worker Mentoring | Onboarding checklist, 30/60/90 plan, check-in automations |
| 500 contacts, unlimited checks | Cannot lift site quotas; make each contact count (quota tracker, bulk templates) |
| Worker Reviews, One VA Away | Not replicable; skip |

## Feature catalog

Tier: **F** free/local, **P** paid (credits or subscription). Status: all New.

### A. Applicant intelligence

| # | Feature | What it does | Tier |
|---|---|---|---|
| A1 | Applicant Dossier | One cached record per applicant from row → thread → profile → résumé, fetched on demand and throttled; everything else reads it | F |
| A2 | Enriched Inbox Rows | Asked $/mo, hours/day, ID proof, English/IQ, last active, member since, résumé ✓, hired-elsewhere, AP, instruction ✓/✗ inline | F |
| A3 | Applicant Filters | Collapse by budget, English, ID score, activity, résumé, employment status, experience band, skill keywords, AP ≥ n | F |
| A4 | Followed-Instructions Check | Keyword, required items, subject format from the posting vs. each application | F |
| A5 | Résumé Scanner | pdf.js text → tools, years, certifications, gaps, keyword hits | F |
| A6 | Boilerplate Detector | Copy-paste / generic / "[Your Full Name]" / ALL-CAPS clickbait subjects | F |
| A7 | Duplicate & Repeat Detector | Same person across your posts or re-applying | F |
| A8 | Sort by Anything | Rate, English, ID, activity, AP, date, fit score | F |
| A9 | Compare Drawer | 2–5 applicants side by side | F |
| A10 | Keyboard Bulk Triage | j/k, 1–5★, label, archive, verdicts — via the site's own buttons | F |
| A11 | New-Since-Last-Visit | Per-posting count + highlight | F |
| A12 | Quick Peek | Read message + key facts from the list without marking read | F |
| A13 | Setup Extractor | Pulls computer/internet/speed/power-backup claims from messages when the posting asks for them | F |
| A14 | Schedule Fit | Flags night-shift/overlap conflicts against the posting's hours and the applicant's current employment | F |
| A15 | Cross-Posting Match | "Strong for Billing, weak here" — suggests your other open posts | F |

### B. AI hiring assistant

| # | Feature | What it does | Tier |
|---|---|---|---|
| B1 | Fit Score & Ranking | Batch score of a whole posting with reasons; the AI-Matching replacement | P |
| B2 | Application Summary | 5 bullets from message + profile + résumé | P |
| B3 | Red-Flag Screen | Inconsistencies, status conflicts, date gaps, suspicious links | P |
| B4 | Specialized Interview Questions | From posting × this applicant's résumé; rubric + model answers | P |
| B5 | Screening Test Generator | Practical task + grading guide | P |
| B6 | Candidate Q&A | Natural-language questions over all dossiers | P |
| B7 | Job Post Writer / Optimizer | Brief → posting with salary guidance, skill tags, screening instruction | P |
| B8 | Talent-Search Query Builder | Brief → advanced-search filter set (respecting the site's 5★ caps) | P |
| B9 | Reply Drafter | Invite, rejection, offer, negotiation, clarification; tone-aware | P |
| B10 | Offer & Rate Advisor | Asked vs. offered gap, negotiation room, market band | P |

### C. Messaging & automation

| # | Feature | What it does | Tier |
|---|---|---|---|
| C1 | Templates with Merge Fields | `{first_name}` `{job_title}` `{asked_rate}` `{slots}`; invite/screen/test/reject/offer/onboard/acknowledge | F |
| C2 | Bulk Send with Review | Select N → template → preview each → human-paced send via Trix; per-session cap; log | P |
| C3 | Auto-Acknowledge | "Application received" to every new applicant (opt-in); the ghost-free employer | P |
| C4 | Auto-Reply Rules | "missing keyword → re-apply template", "★≥4 → invite", only while the tab is open, capped, logged | P |
| C5 | Close-the-Loop | On hire: bulk thank-and-reject the rest, archive, mark hired | P |
| C6 | Follow-Up Nudges | Unanswered invites after N days; one-click chaser | F |
| C7 | Interview Scheduler | Slots in both time zones, `.ics`, confirmation template | F |
| C8 | Contact & Cap Tracker | Contacts used / month, applicants vs. per-post cap, refresh-day reminders | F |
| C9 | Inbox Zero Dashboard | Unread by posting, oldest unanswered, response SLA | F |

### D. Pipeline, ATS & CRM

| # | Feature | What it does | Tier |
|---|---|---|---|
| D1 | Hiring Kanban | New → Screened → Interview → Test → Offer → Hired/Rejected, backed by OLJ labels | F |
| D2 | Notes, Tags, Rating History | Per person, private | F |
| D3 | Talent Pool | Park good-but-not-now candidates; re-engage on the next post | F |
| D4 | Funnel Analytics | Stage conversion, time-to-hire, drop-off, per post and overall | P |
| D5 | Posting Performance | Hits → applicants → quality; refresh reminders; best repost time | F |
| D6 | Hired Worker Roster | Start, rate, schedule, TZ, review/raise reminders; Timeproof hours when present | F |
| D7 | Export / Backup | CSV/JSON of applicants, pipeline, notes | F |
| D8 | Team Share | Export a shortlist pack for a partner (file); shared workspace later, server-side | F / P |
| D9 | Side Panel | Chrome side panel with pipeline + dossier beside any OLJ page | F |
| D10 | New-Applicant Alerts | Notifications for applicants matching your filters (reuses alerts/alarms) | F |

### E. Documents & compliance

| # | Feature | Tier |
|---|---|---|
| E1 | Contractor Agreement Builder (PDF, merge fields from dossier) | P |
| E2 | NDA Builder | P |
| E3 | Offer Letter Builder | P |
| E4 | SOW / Job Description Sheet | P |
| E5 | Onboarding Checklist & 30/60/90 Plan | F |
| E6 | Performance Review Template | P |
| E7 | Certificate of Employment & End-of-Contract Letter | P |
| E8 | Data & Confidentiality Addendum | P |
| E9 | Equipment & Security Checklist | F |

Every document carries "template, not legal advice". A real EOR (an entity
that employs and remits SSS/PhilHealth/Pag-IBIG) is a business, not a feature;
at most a partner link later.

### F. Pay & operations

| # | Feature | Tier |
|---|---|---|
| F1 | Payroll Calculator (USD↔PHP, hourly↔monthly, pro-rating, optional 13th-month) | F |
| F2 | Payment Log (Wise/PayPal/GCash/EasyPay; receipts; no processing) | F |
| F3 | Payment Reminders + "payment sent" template | F |
| F4 | Payslip / Remittance Slip PDF | P |
| F5 | Fee Comparator (EasyPay 2 % forex vs. Wise/PayPal/Payoneer) | F |
| F6 | Time-Zone Overlap Planner | F |
| F7 | PH Holiday Calendar | F |
| F8 | Rate Benchmark for Your Offer (what applicants for similar roles asked) | F |
| F9 | Timeproof Digest (hours/screenshots summary from Your Workers → payroll) | F |

### G. Talent search & sourcing (after the www survey)

| # | Feature | Tier |
|---|---|---|
| G1 | Merged Search Pages | F |
| G2 | Multi-Term Search, deduplicated | F |
| G3 | Seen / Dismissed Profiles | F |
| G4 | Saved Searches & New-Profile Alerts | F |
| G5 | Profile Compare | F |
| G6 | Invite-to-Apply Bulk Template (within contact quota) | P |
| G7 | Talent Search Filters+ (rate ceiling in $/mo, keyword in description, exclude already-contacted) | F |

### H. Trust & safety

| # | Feature | Tier |
|---|---|---|
| H1 | Identity Signals Panel | F |
| H2 | Profile ↔ Résumé Consistency Check | P |
| H3 | Already-Employed Warning | F |
| H4 | Link Safety (Drive/portfolio links checked against `safe-url.js` rules) | F |

Totals: 64 features — 41 free, 23 paid.

## Pricing

- Free: everything that reads, organises and drafts locally — same promise as
  the jobseeker side ("never sends anything anywhere").
- **Employer Pro, $19–29/mo** as a monthly credit grant, or credit packs; AI,
  automation, documents, analytics. A quarter of Premium with more in it.

## Architecture

```
manifest.json        + content_scripts for https://v2.onlinejobs.ph/message*,
                       /myaccount, /jobseekers/info/*, /employer/*; later www
src/core/employer/   pure, tested
  dossier.js           merge row+thread+profile+résumé into one record
  applicant-criteria.js  hide rules + reasons (mirror of criteria.js)
  instructions.js      parse a posting's "how to apply" into checks
  boilerplate.js       template / clickbait detection
  resume-text.js       pdf.js wrapper → normalised text + extracted facts
  pipeline.js          stages, transitions, label mapping
  templates.js         merge-field rendering
  quotas.js            contact/applicant caps by tier
src/content/employer/
  inbox-main.js        entry for /message/jobs/*, all-applicants
  inbox-rows.js        meta row + collapse (reuse collapse.js, control-bar.js)
  thread-main.js       right-rail additions, drafters, templates
  profile-main.js      signals panel, notes, add-to-pool
  dashboard-main.js    per-post counters, quota tracker, nudges
  fetch-applicant.js   throttled same-origin fetch + cache (reuse prefetch.js cap, page-cache.js)
  site-actions.js      wrappers over the data-cy controls
src/options/           Employer tab: pipeline board, CRM, analytics, documents, templates
oljextension/          catalog entries: fit, summary, red-flags, interview-q, test, qa, post-writer, query-builder, reply, rate-advisor
```

Reuse: `parse-rate.js`, `normalize.js`, `criteria.js` pattern, `collapse.js`,
`keys.js`, `typing.js`, `highlight.js`, `prefetch.js` cap, `page-cache.js`,
`job-notes.js`/`job-tags.js` keyed by worker id, `board-overlay.js`,
`funnel.js`, `follow-ups.js`, `alerts.js`, `badge.js`, `ics.js`, `shift.js`,
`salary-calc.js`, `safe-url.js`, `snippets.js`, `backup.js`.

Rules carried over: never remove a site node; never mine pages you did not
open — dossiers are built on demand for the list you are looking at, behind the
shared request cap; nothing leaves the browser except credit-gated AI calls and
only the fields those need; no auto-open of threads (it marks them read).

Storage: `chrome.storage.local`, keyed by worker id; dossier cache with TTL;
notes/pipeline/pool permanent; export/backup through the existing Backup tab.

## Build order

1. **Foundation** — manifest routes, `fetch-applicant.js` + `dossier.js`,
   `site-actions.js`, tests against saved fixtures of the three page types.
2. **Inbox, free** — A1–A4, A6–A8, A10–A12, C8, C9. Prove on the 366-applicant
   account.
3. **Résumé + profile depth** — A5, A9, A13–A15, H1, H3, H4.
4. **AI wave 1** — B1, B2, B4, B9 as catalog entries; B3, B5, B6, B10 next.
5. **Messaging** — C1, C6, C7 free; C2, C3, C4, C5 paid with caps and logs.
6. **Pipeline/CRM** — D1–D3, D5–D7, D9, D10; D4 paid.
7. **Documents & pay** — E*, F*.
8. **Talent search** — G*, B7, B8, after surveying the www pages.

## Open questions

- Survey `www.onlinejobs.ph` employer pages (needs a www login in the employer
  profile, port 9333): post-job form fields, job list, talent-search results
  markup, Timeproof reports layout.
- Inbox infinite scroll: the Radix viewport did not load more on programmatic
  scroll; find the sentinel/observer before building A1.
- Per-post cap of 15 on Free means small inboxes; confirm the product still
  earns its keep there (filters matter less, templates and documents more).
- Bulk-send pacing that OLJ tolerates; start conservative (one message per few
  seconds, batch confirm, daily cap) and make the log visible.
