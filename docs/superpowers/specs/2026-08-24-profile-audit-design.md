# Profile audit — design

**Date:** 2026-08-24
**Status:** built, then reverted in `c076d90`. **Kept on purpose, as reconnaissance.**

> The feature is not in the extension, and this document does not describe
> anything you can run today. It is retained because the expensive part to learn
> was never the code — it was how OnlineJobs.ph serves a profile: the page is
> client-rendered, the API wants a token held in memory, the markup is Tailwind
> utilities, the skill list caps at 15 (3/4/8 by rating), and the Profile
> Description renders HTML.
>
> It was dropped because the value is front-loaded. You read an audit once, fix
> your profile, and it has little to say again until the market moves — and for
> that it carried a main-world script, an XHR tap that breaks whenever OLJ
> changes how their app loads, a storage key and a manifest entry.
>
> Read what follows as notes about OLJ, not as a description of this product.
> The implementation plan is `../plans/2026-08-24-profile-audit.md`.

## The problem

Everything OljExtension does is outbound. It filters postings, spots scams,
judges fit, drafts the application and tracks it. All of it helps someone send a
better application into a pile of two hundred.

On OnlineJobs.ph hiring runs both ways: workers apply to posts, **and employers
search worker profiles and message people directly.** A large share of hires
start with the employer finding you. Nothing in the product touches that half,
so the worker's own profile — their only inbound channel — is unimproved and
unmeasured.

## Why this product can build it and others cannot

`src/core/benchmark.js` already keeps, on the user's machine,
`stats.skills[name]` — a rate histogram per skill, accumulated from every
listing they have scrolled past, decayed at `MAX_SAMPLES` (2000) and stored as
bucketed counts rather than a log of individual jobs.

That yields two things nobody else has pointed at this problem:

- **Demand** — `sampleCount(stats.skills[name])`, how often a skill appears in
  postings this person actually sees.
- **Pay** — `percentileOf(...)`, what that skill is worth in their corner of the
  market.

So instead of generic profile advice, the audit can say: *"38 postings you have
seen want Shopify, median $520/mo. Your resume mentions Shopify. Your OLJ
profile does not list it."*

**Honest limit:** the histogram reflects what *this user* has browsed, not the
whole market. It is a personalised demand signal, not a market index, and must
never be described as one.

## Decisions

| Question | Decision |
| --- | --- |
| What is audited | The worker's **real OLJ public profile** — what employers actually see |
| Free vs paid | **Hybrid.** The audit is free, local and deterministic. One paid AI action rewrites the headline and overview. |
| Surface | A **dock mini app**, beside Tracker and Saved |
| Shape | **Gap report** — a ranked fix list where every finding cites its evidence |

Rejected: a profile strength score. We have data on job *postings*, not on other
workers' profiles, so any "you rank in the top 20% of VAs" claim would be
fabricated. A score could only measure completeness against a checklist we
invented. Not worth the dishonesty.

Held in reserve: an employer simulation ("would an employer searching 'Shopify
VA' contact you?") as a second paid action, if the rewrite does not land.

## Architecture

Four new units, each with one job, following patterns already in the codebase.

### `src/core/olj-profile.js`

**Revised after the spike — see "What the spike found" below.** Reads the
profile from the page the reader is already looking at. No fetch, anywhere.

- `readProfileFromDom(doc)` — **pure**, takes a document and returns the profile
  or `null`. Called by the existing v2 content script when the reader is on
  their own profile page.
- `saveProfile(profile)` / `loadProfile()` — keep the last good read in
  `chrome.storage.local` with the time it was taken, so the mini app has
  something to audit later.

Pure in, pure out: the reading logic takes a document and is unit-testable
against a saved fixture, exactly as `parseAccountEmail` is today.

Shape returned by `parseProfile`:

```
{
  headline: string,
  overview: string,
  skills: string[],
  rate: { usdPerMonth: number|null, raw: string },
  hasIdProof: boolean,
  hasPhoto: boolean,
  links: string[],
}
```

Any field it cannot read with confidence is `null`/empty rather than guessed.

### `src/core/profile-audit.js`

Pure. `audit(profile, stats, storedProfile, applications) → Finding[]`.

```
Finding = {
  id: string,
  severity: 'high' | 'medium' | 'low',
  title: string,
  evidence: string,   // the number and where it came from
  fix: string,        // what to do about it
}
```

No I/O, no chrome APIs, no clock. This holds the real value of the feature and
takes the bulk of the tests.

### `src/options/ProfileAudit.jsx`

The mini app. Renders findings, handles the permission request and the empty and
error states, and offers the paid rewrite.

### `src/lib/ai-tools/profile-rewrite.ts` (server repo)

The one paid step, registered as an ordinary tool on the existing `/api/analyze`
route, so it inherits billing, BYOK, rate limiting and the JSON parsing already
in place. Takes the profile and the top findings; returns a rewritten headline
and overview.

### Wiring

One line in `src/options/widget-views.jsx`, one entry in `src/core/dock.js`, and
a `profile-request` handler in `src/background.js` beside `analyze-request`.

## Data flow

1. The reader visits their own OnlineJobs.ph profile — something they do anyway.
   The v2 content script, which already runs on that page, reads what is on
   screen and saves it locally.
2. Later, the reader opens the Profile app from the dock.
3. The app loads the saved profile, the benchmark stats and their stored notes —
   all from local storage.
4. `audit(...)` returns ranked findings.
5. The app renders them, each with its evidence and its fix.
6. Optionally the reader spends one credit (or their own key) to rewrite the
   headline and overview, and copies the result into OnlineJobs.ph.

**Network requests added by this feature: zero.** Everything except step 6
happens on pages the reader opened themselves, offline.

If nothing has been saved yet, the app says so and links to the profile page
rather than showing an empty audit.

## The findings

Five in v1, ranked by severity.

1. **In-demand skill missing from your tags.** Ranked by
   `sampleCount × pay percentile`.
   *"38 postings you have seen want Shopify, median $520/mo."*

   "Evidenced" is concrete, not a judgement call: run the existing
   `matchSkills(text, skills)` from `src/core/skill-match.js` over the worker's
   stored profile body and resume, with the candidate list being the keys of
   `stats.skills`. A skill is evidenced when it matches there, and is a finding
   when it is also absent from the OLJ profile's skill tags.

2. **Rate below market.** Their listed rate against `percentileOf` for their
   strongest skill — "strongest" being the skill with the most samples, the same
   rule `rateStanding` already uses to pick a comparison.

3. **Headline missing your strongest in-demand skill.** Whether the names of the
   top-ranked skills from finding 1 appear anywhere in the headline.

   Note what this deliberately is *not*: we cannot analyse the language
   employers use in their postings, because the benchmark stores skill names and
   bucketed rate counts only — never posting text. The check is limited to skill
   *names*, which is what we actually hold.

4. **Thin overview.** Below a length where employers stop reading.
5. **Trust gaps.** Missing ID proof, photo or portfolio links.

## Error handling

A wrong finding is worse than no finding. Every failure degrades to silence, not
to a guess.

| Situation | Behaviour |
| --- | --- |
| Parse fails (OLJ changed their markup) | "Could not read your profile." **No findings at all** — never infer from a partial parse |
| Not signed in to OLJ | Say so, and what to do about it |
| Host permission not granted | Reuse the existing request-permission flow |
| Fewer than `MIN_SAMPLES` (25) for a skill | "Not enough data yet — keep browsing jobs", never a low-confidence number |
| Fresh install, empty histogram | An honestly near-empty audit. This is the common first run and must not look broken |

## Testing

- `parseProfile` against saved HTML fixtures, the way `parseAccountEmail` is
  tested today — including a fixture whose shape has changed, asserting it
  returns nothing rather than nonsense.
- `audit(...)` with synthetic stats and profiles: each finding fires when it
  should, stays silent below `MIN_SAMPLES`, and ranks correctly.
- No network in any test.

## Out of scope

- **No score**, for the reason given above.
- **No comparison against other freelancers** — we have no data on them.
- **No editing the OLJ profile.** The audit produces text to paste and a deep
  link. Writing to their site on the user's behalf is a different, riskier
  feature.
- **No tracking over time.** Worth considering later; not needed to prove value.

## What the spike found

Run against the live site on 2026-08-24, before any code was written. It
invalidated the original approach, which is why it was run first.

**The profile lives at `/jobseekers/info/<id>` and redirects to
`v2.onlinejobs.ph`.** The id is discoverable — the account-settings page links
to it — so that part was fine.

**But the page is client-rendered.** Fetching that URL returns about 230
characters of navigation and footer. There is nothing in the HTML to parse, so
the original plan (fetch in the worker, parse with regex) could never have
worked.

**The real data comes from `api.onlinejobs.ph/api/v1/users/profile`** — 30KB of
structured JSON, and `/users/profile` needs no id at all, it means "me". It is
far richer than anything scraped: `job_data.job_description` (the headline),
`job_data.skill_summary` (the overview), `rate` / `rate_per_hour` / `salary`,
`jobseeker_skills[]`, `id_proof`, `is_verified`, `is_profile_complete`,
`picture_filename`, `education`, `last_edit_date`.

**We are not going to use it.** It authenticates with a Bearer token the SPA
holds in memory — not in localStorage, not in sessionStorage, minted from the
`ojv2hs` cookie. Reaching it would mean replaying OnlineJobs.ph's own auth flow,
which is precisely the behaviour that gets an extension blocked. The data being
better is not a good enough reason.

**So the profile is read from the rendered page instead**, by the content script
already running on `https://v2.onlinejobs.ph/jobseekers*`. Everything the five
findings need is on screen: name, headline, ID PROOF status, rate in both pesos
per hour and per month, availability, education, overview.

Two things worth knowing that also came out of it:

- **The "70" on the rendered page belongs to ID Proof, not to profile quality,
  and it is not a score.** It sits directly above the `ID PROOF / Verified`
  label. Corrected by the account holder after this spec first recorded it
  wrongly as a profile score; its exact meaning is OnlineJobs.ph's, not ours to
  invent, so confirm it before any copy refers to it.

  Two consequences. **OnlineJobs.ph publishes no profile-quality score**, so this
  audit competes with nothing and duplicates nothing — the gap it fills is real.
  And `hasIdProof` should not be a bare boolean: the page carries both this
  value and a verified/unverified state, and a finding that can say what a
  reader's ID Proof actually is beats one that only says it is missing.
- **The test account's rate is ₱110,000/month**, far above the VA bands in the
  histogram. The "rate below market" finding has to handle a high earner
  gracefully and stay silent, rather than nagging someone who is already paid
  well.

## Second spike: the page has no semantic hooks

Captured the rendered page (233KB) to write the reader against reality. It is
built with Tailwind utility classes and carries no semantic ones:

```
"ID PROOF"        span.pl-1.pr-2.text-[11px].font-semibold.text-primary-500
"₱1,250.00/hour"  <strong> inside .group.inline-flex.flex-wrap.gap-1.5
skills            nothing matches [class*=skill] at all
```

Selecting on those is selecting on styling. They change when someone adjusts
padding or a shade, which is often, and the breakage is silent. So the reader
cannot be written the way this spec first described.

Three ways forward, in the order they were considered:

1. **Anchor on text landmarks** — find the element whose text is "ID PROOF",
   then walk to its neighbour. Survives restyling, breaks on rewording or
   translation, and the walking is delicate.
2. **Observe the response the page already received.** The app fetches
   `api/v1/users/profile` itself on that page. A content script in the main
   world can watch `fetch` and read the reply as it arrives. **This is not the
   thing rejected earlier** — we never mint a token, never send a request, and
   never call their API. We read a reply the reader's own browser already has,
   about the reader, on a page they opened. Added requests: still zero. And the
   payload is the structured JSON described above, which is far more stable
   than styling.
3. **Call the API ourselves** — still rejected, for the same reason as before.

Option 2 looks strongest: better data than scraping and no more network than
option 1. It costs a main-world injection, and it breaks if the app changes how
it loads its own profile — a data contract, which moves more slowly than CSS.

**Not yet decided.** Whoever picks this up should settle it before writing the
reader.

## Remaining risk

Reading the rendered DOM breaks if OnlineJobs.ph redesigns that page. This is
the same fragility the job parser already lives with, and the same answer
applies: when the shape moves, read nothing and say so, rather than producing
findings from a half-read page.
