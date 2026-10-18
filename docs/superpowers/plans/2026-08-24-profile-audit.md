# Profile Audit Implementation Plan

> ## ⚠️ Completed, then reverted — do not execute this plan
>
> This was built and removed again in `c076d90`. None of the code described
> below is in the extension, and the checkboxes are a record of work that no
> longer exists rather than work waiting to be done.
>
> It was dropped because the value is front-loaded: you read an audit once, fix
> your profile, and it has little to say again until the market moves. For that
> it carried a main-world script, an XHR tap that breaks whenever OnlineJobs.ph
> changes how their app loads, a storage key and a manifest entry.
>
> The part worth keeping is the reconnaissance on how OLJ serves a profile,
> which lives in `../specs/2026-08-24-profile-audit-design.md`. Start there if
> this is ever revisited — and expect a different shape, because what failed was
> the shape, not the findings.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a Filipino freelancer a free, evidence-citing audit of their real OnlineJobs.ph profile, so employers searching OLJ can find them — with one optional paid AI rewrite of their headline and overview.

**Architecture:** The content script already running on `v2.onlinejobs.ph` reads the worker's profile off the rendered page when they visit it and saves a copy locally. A pure audit function compares that copy against the per-skill rate histogram `src/core/benchmark.js` already keeps, and a dock mini app renders the ranked findings. Only the optional rewrite leaves the machine, as an ordinary tool on the existing `/api/analyze` route.

**Revised after the spike.** The original plan fetched the profile in the service worker and parsed the HTML with regex. That cannot work: the page is client-rendered, so a fetch returns an empty shell, and the JSON API behind it wants a Bearer token the site holds in memory. See the spec's "What the spike found".

**Tech Stack:** Vanilla JS ES modules (`src/core/`), React 18 + Vite (`src/options/`), Vitest, Chrome MV3. Server: Next.js App Router, Zod, Vitest.

Spec: `docs/superpowers/specs/2026-08-24-profile-audit-design.md`

## Global Constraints

- **A wrong finding is worse than no finding.** Every failure path returns nothing, never a guess. A partial parse yields zero findings.
- **Never claim precision the data lacks.** `BUCKETS` are bands, so pay is reported as a band (`"$500-650"`), never as an invented exact median.
- **`MIN_SAMPLES` (25) gates every claim.** Below it, say "not enough data yet" rather than a number.
- **No comparison against other freelancers.** The histogram is built from job *postings*. We hold no data on other workers.
- Core logic in `src/core/` is **pure**: no `chrome.*`, no network, no clock — those are arguments. `readProfileFromDom` takes a document; `saveProfile` takes the time.
- Comments explain *why*, matching the surrounding house style. No comment restates the code.
- Run `npm test` from the repo the change lives in. Extension baseline: 1616 passing. Server baseline: 219 passing.
- **Do not touch OnlineJobs.ph's servers.** This feature adds **zero network requests.** It reads the profile off a page the reader opened themselves, and its market data comes from the histogram the rate filter has already built from pages they browsed. No fetching, no background timer, no polling, no following links, no reading anyone else's profile, ever.
- **Do not use `api.onlinejobs.ph`,** however much better the data is. It authenticates with a Bearer token the site keeps in memory, so reaching it means replaying their sign-in. That is what gets an extension blocked, and being blocked would cost every reader every feature — not just this one.

---

### Task 0: Capture a profile fixture

The URL spike is **done** — see the spec's "What the spike found". The profile is at `/jobseekers/info/<id>`, redirects to `v2.onlinejobs.ph`, and is client-rendered, so it is read from the DOM rather than fetched. What is still needed is a fixture.

**Files:**
- Create: `test/fixtures/olj-profile.html`
- Create: `test/fixtures/olj-profile-changed.html`

- [ ] **Step 1: Save the rendered page**

In the debug Chrome signed in to OnlineJobs.ph, open your own profile (the account-settings page links to it as `/jobseekers/info/<id>`), let it finish rendering, then save `document.documentElement.outerHTML` — **not** the network response, which is an empty shell.

- [ ] **Step 2: Redact it**

Replace the real name, email, photo filename and any id numbers with obviously fake values (`Juan Dela Cruz`, `juan@example.com`). Keep the markup structure exactly as-is — that is the thing under test.

- [ ] **Step 3: Save a "shape changed" fixture**

Copy it to `test/fixtures/olj-profile-changed.html` and delete the elements holding the headline, skills and rate. This fixture proves a redesigned page yields *nothing* rather than nonsense.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/olj-profile.html test/fixtures/olj-profile-changed.html
git commit -m "test: fixtures for reading the OLJ profile

Saved from the rendered DOM, because the page is client-rendered and the
network response is an empty shell. The -changed fixture has the
headline, skills and rate removed, so the reader can be held to
returning nothing when the page shape moves."
```

---

### Task 2: Read the profile from the page

**Files:**
- Create: `src/core/olj-profile.js`
- Test: `test/olj-profile.test.js`

**Interfaces:**
- Consumes: the fixtures from Task 0; the rate parsing in `src/core/parse-rate.js`.
- Produces: `readProfileFromDom(doc) → { headline, overview, skills, rate, hasIdProof, hasPhoto, links } | null`
  - `headline: string`, `overview: string`, `skills: string[]`, `links: string[]`
  - `rate: { usdPerMonth: number|null, raw: string }`
  - `hasIdProof: boolean`, `hasPhoto: boolean`
  - returns `null` when the page cannot be read with confidence

The profile shows pesos (`₱1,250.00/hour (₱110,000.00/month)`). Convert to USD per month using the rate parsing the filter already uses, so the audit compares like with like against the histogram. Where no conversion is possible, leave `usdPerMonth` as `null` and let the rate finding stay silent.

- [ ] **Step 1: Write the failing test**

Create `test/olj-profile.test.js`. It parses the fixture into a real DOM with jsdom, which the suite already uses.

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { readProfileFromDom } from '../src/core/olj-profile.js';

const docFrom = (name) =>
  new JSDOM(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).window.document;

describe('readProfileFromDom', () => {
  it('reads the headline and overview', () => {
    const profile = readProfileFromDom(docFrom('olj-profile.html'));
    expect(profile.headline.length).toBeGreaterThan(0);
    expect(profile.overview.length).toBeGreaterThan(0);
  });

  it('reads the skills as a list of trimmed strings', () => {
    const profile = readProfileFromDom(docFrom('olj-profile.html'));
    expect(profile.skills.length).toBeGreaterThan(0);
    expect(profile.skills.every((s) => typeof s === 'string' && s.trim() === s)).toBe(true);
  });

  it('reads the rate as written', () => {
    const profile = readProfileFromDom(docFrom('olj-profile.html'));
    expect(profile.rate.raw.length).toBeGreaterThan(0);
  });

  it('notices a verified ID', () => {
    expect(readProfileFromDom(docFrom('olj-profile.html')).hasIdProof).toBe(true);
  });

  it('returns null when the page shape has moved', () => {
    // A redesigned page must yield nothing, so no finding is ever computed
    // from a half-read profile.
    expect(readProfileFromDom(docFrom('olj-profile-changed.html'))).toBeNull();
  });

  it('returns null for junk', () => {
    expect(readProfileFromDom(new JSDOM('<html><body>nope</body></html>').window.document)).toBeNull();
    expect(readProfileFromDom(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/olj-profile.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reader**

Create `src/core/olj-profile.js`. Write the selectors against the **real fixture** from Task 0 — the ones below are the shape to follow, not values to trust.

```js
/**
 * Reading your own OnlineJobs.ph profile - the thing employers search.
 *
 * Off the rendered page, not off the wire. The profile page is client-rendered,
 * so fetching its url returns a shell with nothing in it, and the JSON API
 * behind it authenticates with a token the site keeps in memory. Reaching that
 * would mean replaying OnlineJobs.ph's own sign-in, which is how an extension
 * gets itself blocked - and being blocked would cost every reader every
 * feature, not just this one.
 *
 * So this runs where the data already is: the content script on the profile
 * page, reading what is on screen. It adds no requests at all.
 *
 * Takes a document rather than reaching for the global one, which is what lets
 * it be tested against a saved page.
 */

const text = (node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

export function readProfileFromDom(doc) {
  if (!doc?.querySelector) return null;

  const headline = text(doc.querySelector('[data-profile-headline], .profile-headline, h1'));

  // Without a headline we are not on a profile - either the page shape moved or
  // this is a redirect. Either way there is nothing to audit.
  if (headline.length === 0) return null;

  const overview = text(doc.querySelector('[data-profile-overview], .profile-overview'));

  const skills = [...doc.querySelectorAll('[data-profile-skill], .profile-skill')]
    .map(text)
    .filter((name, index, all) => name.length > 0 && all.indexOf(name) === index);

  const rateRaw = text(doc.querySelector('[data-profile-rate], .profile-rate'));

  const links = [...doc.querySelectorAll('a[href^="http"]')]
    .map((a) => a.getAttribute('href'))
    .filter((href) => !href.includes('onlinejobs.ph'))
    .filter((href, index, all) => all.indexOf(href) === index);

  const body = text(doc.body);

  return {
    headline,
    overview,
    skills,
    rate: { usdPerMonth: null, raw: rateRaw },
    hasIdProof: /id\s*proof[\s\S]{0,40}verified/i.test(body),
    hasPhoto: Boolean(doc.querySelector('[data-profile-photo], .profile-photo img')),
    links,
  };
}
```

Then fill in `rate.usdPerMonth` from `rateRaw` using `src/core/parse-rate.js`, so a peso monthly figure becomes USD per month.

- [ ] **Step 4: Run the tests, correcting the selectors against the fixture**

Run: `npx vitest run test/olj-profile.test.js`
Expected: PASS. If a selector does not match the real page, fix the selector — not the test.

- [ ] **Step 5: Commit**

```bash
git add src/core/olj-profile.js test/olj-profile.test.js
git commit -m "feat(profile): read your own OLJ profile off the page

Not off the wire. The page is client-rendered and the API behind it
wants a token the site keeps in memory; replaying that auth is how an
extension gets blocked. Reading the rendered page adds no requests."
```

---

### Task 3: Save what was read

**Files:**
- Modify: `src/core/olj-profile.js`
- Modify: `src/content/v2-main.js`
- Test: `test/olj-profile.test.js`

**Interfaces:**
- Consumes: `readProfileFromDom(doc)` (Task 2).
- Produces:
  - `saveProfile(profile, now) → Promise<void>`
  - `loadProfile() → Promise<{ profile, readAt } | null>`
  - `captureProfile(doc, now) → Promise<boolean>` — read and save if this is a profile page; returns whether anything was saved.
- Storage: one new key, `ojRateFilterOljProfile`, holding `{ profile, readAt }`.

- [ ] **Step 1: Write the failing test**

Append to `test/olj-profile.test.js`:

```js
import { captureProfile, loadProfile, saveProfile } from '../src/core/olj-profile.js';

describe('keeping the last good read', () => {
  beforeEach(() => {
    const store = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: async (key) => ({ [key]: store[key] }),
          set: async (patch) => Object.assign(store, patch),
        },
      },
    };
  });

  it('round-trips a profile with the time it was read', async () => {
    await saveProfile({ headline: 'VA' }, 1_700_000_000_000);
    const saved = await loadProfile();
    expect(saved.profile.headline).toBe('VA');
    expect(saved.readAt).toBe(1_700_000_000_000);
  });

  it('returns null before anything has been read', async () => {
    expect(await loadProfile()).toBeNull();
  });

  it('saves nothing when the page is not a profile', async () => {
    const doc = new JSDOM('<html><body>not a profile</body></html>').window.document;
    expect(await captureProfile(doc, 1)).toBe(false);
    expect(await loadProfile()).toBeNull();
  });

  it('saves when the page is a profile', async () => {
    expect(await captureProfile(docFrom('olj-profile.html'), 42)).toBe(true);
    expect((await loadProfile()).readAt).toBe(42);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/olj-profile.test.js`
Expected: FAIL — `saveProfile is not a function`.

- [ ] **Step 3: Implement the store**

Append to `src/core/olj-profile.js`:

```js
const PROFILE_KEY = 'ojRateFilterOljProfile';

/**
 * Keep the last good read, so the audit has something to work with later.
 *
 * The reader visits their profile at one moment and opens the audit at another;
 * without this the mini app would have to send them back to the page every
 * time. The clock is passed in rather than read, so a test can pin it.
 */
export async function saveProfile(profile, now) {
  await chrome.storage.local.set({ [PROFILE_KEY]: { profile, readAt: now } });
}

export async function loadProfile() {
  const stored = await chrome.storage.local.get(PROFILE_KEY);
  const entry = stored?.[PROFILE_KEY];
  return entry?.profile ? { profile: entry.profile, readAt: entry.readAt ?? 0 } : null;
}

/** Read the page if it is a profile, and remember it. */
export async function captureProfile(doc, now) {
  const profile = readProfileFromDom(doc);
  if (profile === null) return false;
  await saveProfile(profile, now);
  return true;
}
```

- [ ] **Step 4: Call it from the v2 content script**

In `src/content/v2-main.js`, add the import and one call after the existing setup:

```js
import { captureProfile } from '../core/olj-profile.js';
```

```js
// The reader is on their own profile from time to time; take a copy while we
// are here, so the audit has something to read later. Silent either way - this
// is a side errand, not the reason the script is running.
captureProfile(document, Date.now()).catch(() => {});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/olj-profile.test.js` — Expected: PASS.
Run: `npm test` — Expected: the previous suite plus the new tests, all passing.

- [ ] **Step 6: Commit**

```bash
git add src/core/olj-profile.js src/content/v2-main.js test/olj-profile.test.js
git commit -m "feat(profile): keep the last good read of your profile"
```

---

### Task 4: The audit

This is where the value lives, and it is pure — no chrome, no network, no clock.

**Files:**
- Create: `src/core/profile-audit.js`
- Test: `test/profile-audit.test.js`

**Interfaces:**
- Consumes: `matchSkills(text, skills) → {matched, missing, total, score}` from `src/core/skill-match.js`; `sampleCount(counts)`, `percentileOf(counts, usdPerMonth, minSamples)`, `medianBand(counts)` (Task 1), `MIN_SAMPLES` from `src/core/benchmark.js`; the profile shape from Task 2.
- Produces: `audit(profile, stats, storedProfile) → Finding[]` where
  `Finding = { id: string, severity: 'high'|'medium'|'low', title: string, evidence: string, fix: string }`,
  sorted high → low.

- [ ] **Step 1: Write the failing test**

Create `test/profile-audit.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { audit } from '../src/core/profile-audit.js';

/** A histogram with `count` samples in one band. */
const band = (index, count) => {
  const counts = new Array(18).fill(0);
  counts[index] = count;
  return counts;
};

const stats = {
  all: band(4, 200),
  skills: {
    Shopify: band(5, 40),      // 500-650, well sampled
    'Data Entry': band(1, 60), // 100-200, well sampled
    Kubernetes: band(9, 3),    // barely seen
  },
};

const profile = {
  headline: 'Virtual assistant and admin support',
  overview: 'A'.repeat(400),
  skills: ['Data Entry'],
  rate: { usdPerMonth: 120, raw: '$120/month' },
  hasIdProof: true,
  hasPhoto: true,
  links: ['https://portfolio.example.com'],
};

const stored = { body: 'I have run a Shopify store and done data entry for years.' };

const byId = (findings, id) => findings.find((f) => f.id === id);

describe('audit', () => {
  it('flags a skill you can evidence but do not list', () => {
    const finding = byId(audit(profile, stats, stored), 'missing-skill:Shopify');
    expect(finding).toBeDefined();
    expect(finding.evidence).toContain('40');
    expect(finding.evidence).toContain('$500-650');
  });

  it('does not flag a skill you already list', () => {
    expect(byId(audit(profile, stats, stored), 'missing-skill:Data Entry')).toBeUndefined();
  });

  it('stays silent about a skill it has barely seen', () => {
    const stored2 = { body: 'I know Kubernetes.' };
    expect(byId(audit(profile, stats, stored2), 'missing-skill:Kubernetes')).toBeUndefined();
  });

  it('flags a rate below the band for your strongest listed skill', () => {
    const finding = byId(audit(profile, stats, stored), 'rate-low');
    expect(finding).toBeDefined();
    expect(finding.evidence).toContain('$100-200');
  });

  it('flags a headline that never names your strongest missing skill', () => {
    expect(byId(audit(profile, stats, stored), 'headline-keywords')).toBeDefined();
  });

  it('flags a thin overview', () => {
    const thin = { ...profile, overview: 'I am a VA.' };
    expect(byId(audit(thin, stats, stored), 'thin-overview')).toBeDefined();
  });

  it('flags missing trust signals', () => {
    const bare = { ...profile, hasIdProof: false, hasPhoto: false, links: [] };
    const findings = audit(bare, stats, stored);
    expect(byId(findings, 'trust-id')).toBeDefined();
    expect(byId(findings, 'trust-photo')).toBeDefined();
    expect(byId(findings, 'trust-links')).toBeDefined();
  });

  it('makes no market claims for a fresh install with no samples', () => {
    const empty = { all: new Array(18).fill(0), skills: {} };
    const findings = audit(profile, empty, stored);
    expect(findings.some((f) => f.id.startsWith('missing-skill'))).toBe(false);
    expect(byId(findings, 'rate-low')).toBeUndefined();
  });

  it('returns nothing when there is no profile to audit', () => {
    expect(audit(null, stats, stored)).toEqual([]);
  });

  it('sorts high severity first', () => {
    const severities = audit(profile, stats, stored).map((f) => f.severity);
    const rank = { high: 0, medium: 1, low: 2 };
    expect(severities).toEqual([...severities].sort((a, b) => rank[a] - rank[b]));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/profile-audit.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the audit**

Create `src/core/profile-audit.js`:

```js
/**
 * What is missing from your OnlineJobs.ph profile, judged against the market
 * you have actually been looking at.
 *
 * Pure: the profile, the histogram and your stored notes go in, findings come
 * out. Every finding carries the number it was drawn from, because "add more
 * skills" is advice anyone could give and "40 of the postings you have seen
 * want Shopify" is a reason.
 *
 * Silence is the default. A skill seen a handful of times, an empty histogram,
 * an unreadable profile - all produce nothing rather than a soft guess. The
 * feature is only worth having if a finding can be trusted.
 */

import { matchSkills } from './skill-match.js';
import { MIN_SAMPLES, medianBand, percentileOf, sampleCount } from './benchmark.js';

/** Below this an overview reads as a placeholder rather than an introduction. */
const THIN_OVERVIEW = 200;

/** How many missing skills are worth naming before it becomes a chore. */
const MAX_SKILL_FINDINGS = 3;

/** Below this percentile a rate is low enough to be worth raising. */
const LOW_RATE_PERCENTILE = 40;

const rank = { high: 0, medium: 1, low: 2 };

/**
 * The skills worth talking about: seen often enough to mean something, with a
 * band we can quote. Strongest first.
 */
function establishedSkills(stats) {
  return Object.entries(stats?.skills ?? {})
    .map(([name, counts]) => ({ name, counts, samples: sampleCount(counts), band: medianBand(counts) }))
    .filter((entry) => entry.samples >= MIN_SAMPLES && entry.band !== null)
    .sort((a, b) => b.samples - a.samples);
}

export function audit(profile, stats, storedProfile) {
  if (!profile) return [];

  const findings = [];
  const established = establishedSkills(stats);
  const listed = profile.skills ?? [];
  const listedLower = new Set(listed.map((skill) => skill.toLowerCase()));

  // 1. Skills you can evidence but have not listed.
  const evidence = String(storedProfile?.body ?? '');
  const evidenced = matchSkills(evidence, established.map((entry) => entry.name)).matched;

  const missing = established
    .filter((entry) => evidenced.includes(entry.name) && !listedLower.has(entry.name.toLowerCase()))
    .slice(0, MAX_SKILL_FINDINGS);

  for (const entry of missing) {
    findings.push({
      id: `missing-skill:${entry.name}`,
      severity: 'high',
      title: `Add "${entry.name}" to your skills`,
      evidence: `${entry.samples} postings you have seen want it, typically ${entry.band.label}/mo. Your profile notes mention it; your OnlineJobs.ph skills do not.`,
      fix: `Add "${entry.name}" to your skill tags so employers searching for it can find you.`,
    });
  }

  // 2. Your rate against the strongest skill you actually list.
  const strongest = established.find((entry) => listedLower.has(entry.name.toLowerCase())) ?? established[0];
  const rate = profile.rate?.usdPerMonth ?? null;
  if (strongest && rate !== null) {
    const percentile = percentileOf(strongest.counts, rate);
    if (percentile !== null && percentile < LOW_RATE_PERCENTILE) {
      findings.push({
        id: 'rate-low',
        severity: 'high',
        title: 'Your rate sits below most of the work you are looking at',
        evidence: `Postings you have seen for "${strongest.name}" typically pay ${strongest.band.label}/mo. Yours reads ${profile.rate.raw}, lower than about ${100 - percentile}% of them.`,
        fix: 'Raise the rate on your profile, or say what the lower rate buys - a trial period, part-time hours.',
      });
    }
  }

  // 3. A headline that never says the thing you want to be found for.
  const topMissing = missing[0];
  if (topMissing && matchSkills(profile.headline ?? '', [topMissing.name]).matched.length === 0) {
    findings.push({
      id: 'headline-keywords',
      severity: 'medium',
      title: 'Your headline does not mention your strongest skill',
      evidence: `Employers scan headlines first, and yours does not contain "${topMissing.name}".`,
      fix: `Work "${topMissing.name}" into your headline in your own words.`,
    });
  }

  // 4. An overview too short to introduce anyone.
  const overview = String(profile.overview ?? '').trim();
  if (overview.length < THIN_OVERVIEW) {
    findings.push({
      id: 'thin-overview',
      severity: 'medium',
      title: 'Your overview is too short to say much',
      evidence: `It is ${overview.length} characters. Employers read this to decide whether to message you.`,
      fix: 'Say what you do, who you have done it for, and what you are looking for now.',
    });
  }

  // 5. Trust signals. Cheap to fix, and their absence is read as a risk.
  if (!profile.hasIdProof) {
    findings.push({
      id: 'trust-id',
      severity: 'medium',
      title: 'Your ID is not verified',
      evidence: 'Employers filter on verified workers to avoid being scammed themselves.',
      fix: 'Complete ID verification in your OnlineJobs.ph account.',
    });
  }
  if (!profile.hasPhoto) {
    findings.push({
      id: 'trust-photo',
      severity: 'low',
      title: 'Your profile has no photo',
      evidence: 'A profile without a face is skipped over in a list of ones that have them.',
      fix: 'Add a clear photo of yourself.',
    });
  }
  if ((profile.links ?? []).length === 0) {
    findings.push({
      id: 'trust-links',
      severity: 'low',
      title: 'Nothing to show for your work',
      evidence: 'There are no links on your profile to anything you have made.',
      fix: 'Add a portfolio link, or use the Portfolio tool to make a PDF you can link to.',
    });
  }

  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/profile-audit.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: the 1616 previous tests plus the new ones, all passing.

- [ ] **Step 6: Commit**

```bash
git add src/core/profile-audit.js test/profile-audit.test.js
git commit -m "feat(profile): the audit itself

Every finding carries the number it came from. 'Add more skills' is
advice anyone could give; '40 postings you have seen want Shopify,
typically 500-650 a month' is a reason. Silence wherever the samples do
not support a claim."
```

---

### Task 5: The mini app

**Files:**
- Create: `src/options/ProfileAudit.jsx`
- Modify: `src/options/widget-views.jsx`
- Modify: `src/core/dock.js`
- Modify: `src/options/options.css`

**Interfaces:**
- Consumes: `readOljProfile()` (Task 3), `audit()` (Task 4), `loadStats()` from `src/core/benchmark.js`, `hasOljPermission()`/`requestOljPermission()` from `src/core/olj-account.js`, and the stored-profile loader from `src/core/profiles.js`.
- Produces: a `profile` entry in `VIEWS` and in `WIDGETS`.

- [ ] **Step 1: Register the widget**

In `src/core/dock.js`, add to `WIDGETS`:

```js
  {
    id: 'profile',
    label: 'Profile',
    hint: 'Get found by employers',
    kind: 'view',
    size: 'large',
    tier: TIERS.FREE,
    icon: 'user',
  },
```

Use an icon name that already exists in `src/core/icons.js`; if `user` is not there, pick the closest one that is rather than adding an icon in this task.

- [ ] **Step 2: Register the view**

In `src/options/widget-views.jsx`, add the import and the table entry:

```js
import { ProfileAudit } from './ProfileAudit.jsx';
```

```js
  profile: ProfileAudit,
```

- [ ] **Step 3: Write the component**

Create `src/options/ProfileAudit.jsx`. Check the real export name in `src/core/profiles.js` before relying on `loadProfiles` — use whatever that module actually exports.

```jsx
import { useEffect, useState } from 'react';
import { loadStats } from '../core/benchmark.js';
import { readOljProfile } from '../core/olj-profile.js';
import { audit } from '../core/profile-audit.js';
import { hasOljPermission, requestOljPermission } from '../core/olj-account.js';
import { loadProfiles } from '../core/profiles.js';

/**
 * Your OnlineJobs.ph profile, judged against the market you have been reading.
 *
 * Everything here is local: the page is fetched once, the comparison runs
 * against the histogram the rate filter has been keeping all along. The one
 * button that costs anything is the rewrite, and it says so.
 */
export function ProfileAudit() {
  const [state, setState] = useState({ status: 'idle', findings: [], error: '' });
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    hasOljPermission().then(setAllowed);
  }, []);

  async function run() {
    setState({ status: 'working', findings: [], error: '' });

    if (!(await hasOljPermission())) {
      const granted = await requestOljPermission();
      setAllowed(granted);
      if (!granted) {
        setState({
          status: 'error',
          findings: [],
          error: 'Without access to OnlineJobs.ph this cannot read your profile.',
        });
        return;
      }
    }

    const result = await readOljProfile();
    if (!result?.ok) {
      setState({ status: 'error', findings: [], error: result?.error ?? 'Could not read your profile.' });
      return;
    }

    const [stats, profiles] = await Promise.all([loadStats(), loadProfiles()]);
    const stored = profiles.find((entry) => entry.isDefault) ?? profiles[0] ?? null;
    setState({ status: 'done', findings: audit(result.profile, stats, stored), error: '' });
  }

  return (
    <div className="widget-view profile-audit">
      <h2>Get found</h2>
      <p className="field-hint">
        Employers search OnlineJobs.ph profiles as well as reading applications. This checks yours
        against the pay and demand in the postings you have been looking at.
      </p>

      <button type="button" className="btn btn-primary" onClick={run} disabled={state.status === 'working'}>
        {state.status === 'working' ? 'Reading your profile…' : 'Check my profile'}
      </button>

      {!allowed && (
        <p className="field-hint">Checking asks for access to OnlineJobs.ph the first time.</p>
      )}

      {state.status === 'error' && <p className="profile-audit-error">{state.error}</p>}

      {state.status === 'done' && state.findings.length === 0 && (
        <p className="field-hint">
          Nothing to flag. If you have only just installed this, browse a few pages of jobs first -
          the comparison is built from postings you have seen.
        </p>
      )}

      <ul className="profile-audit-list">
        {state.findings.map((finding) => (
          <li key={finding.id} className={`profile-audit-item sev-${finding.severity}`}>
            <h3>{finding.title}</h3>
            <p className="profile-audit-evidence">{finding.evidence}</p>
            <p className="profile-audit-fix">{finding.fix}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Style it**

Append to `src/options/options.css`, reusing existing tokens:

```css
/* The audit reads as a list of findings, so severity carries the only colour. */
.profile-audit-list {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.profile-audit-item {
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-left-width: 3px;
  border-radius: 10px;
  background: #fff;
}
.profile-audit-item.sev-high { border-left-color: #c0392b; }
.profile-audit-item.sev-medium { border-left-color: #b8860b; }
.profile-audit-item.sev-low { border-left-color: var(--line); }
.profile-audit-item h3 { margin: 0 0 4px; font-size: 14px; }
.profile-audit-evidence { margin: 0 0 6px; color: var(--muted); font-size: 13px; }
.profile-audit-fix { margin: 0; font-size: 13px; }
.profile-audit-error { color: #c0392b; font-size: 13px; }
```

- [ ] **Step 5: Build and look at it**

Run `npm run build`, reload the extension over CDP, open
`chrome-extension://<id>/dist/options/index.html?view=profile` and click through
three states: the permission prompt, a successful read, and a signed-out read.

Confirm the window has no dead gutter on the right — `.widget-view` already
resets `max-width`/`margin` for exactly this.

- [ ] **Step 6: Commit**

```bash
git add src/options/ProfileAudit.jsx src/options/widget-views.jsx src/core/dock.js src/options/options.css
git commit -m "feat(profile): the Get found mini app"
```

---

### Task 6: The paid rewrite

**Files (server repo `c:\Users\llino\OneDrive\Desktop\oljextension`):**
- Create: `src/lib/ai-tools/profile-rewrite.ts`
- Modify: the tool registry `getTool(toolId)` reads, and `src/lib/ai-tools/costs.ts`
- Test: `test/profile-rewrite.test.ts`

**Interfaces:**
- Consumes: `defineTool` from `./types`, `costFor` from `./costs`, `COMMON_RULES`/`parseJson`/`asText` from `./context`.
- Produces: a tool with `id: 'profile-rewrite'` whose `parse` returns `{ headline: string, overview: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/profile-rewrite.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import profileRewrite from '@/lib/ai-tools/profile-rewrite';

describe('profile-rewrite', () => {
  test('asks for both fields by name', () => {
    const system = profileRewrite.buildSystemPrompt({} as never);
    expect(system).toContain('"headline"');
    expect(system).toContain('"overview"');
  });

  test('reads a reply with trailing prose, like every other tool', () => {
    const parsed = profileRewrite.parse(
      '{"headline":"Shopify VA","overview":"Ten years of..."}\nHope that helps!',
    );
    expect(parsed).toEqual({ headline: 'Shopify VA', overview: 'Ten years of...' });
  });

  test('rejects a reply with no headline', () => {
    expect(() => profileRewrite.parse('{"overview":"..."}')).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/profile-rewrite.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

Create `src/lib/ai-tools/profile-rewrite.ts`, following `src/lib/ai-tools/summary.ts` exactly in shape. The system prompt must instruct the model to write **in the applicant's own voice**, to invent nothing not present in the input, and to return only the two fields. Register it wherever the other tools are registered, and give it a cost in `costs.ts`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/profile-rewrite.test.ts` — Expected: PASS.
Run: `npm test && npm run typecheck && npm run lint` — Expected: the 219 previous tests plus the new ones; no new lint errors beyond the pre-existing ones in `test/paymongo.test.ts`.

- [ ] **Step 5: Wire the button**

Back in the extension, add a "Rewrite my headline and overview" button to `ProfileAudit.jsx` that posts `{ toolId: 'profile-rewrite', inputs: { profile, findings } }` through the existing analyze path, shows the result with a copy button, and states the cost the way the analysis panel does ("1 credit or BYOK").

- [ ] **Step 6: Test it against a real key**

With BYOK active, run the rewrite and confirm the response carries `billing: "byok"` and that credits do not move. Run it **8-10 times** — model failures here are intermittent, and a single pass proves nothing.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(profile): paid rewrite of the headline and overview"
```

---

## Self-review

**Spec coverage.** Real OLJ profile (Tasks 0, 2, 3) · hybrid free audit + paid rewrite (Tasks 4, 6) · dock mini app (Task 5) · five findings (Task 4) · error handling, all-or-nothing parse, `MIN_SAMPLES` gate, empty-histogram first run (Tasks 2, 4) · fixture and pure-logic testing (Tasks 0, 2, 4) · no score, no worker comparison, no writing to OLJ (nothing implements them).

**Departure from the spec, deliberate.** The spec's illustrative *"median $520/mo"* is not achievable: `BUCKETS` are bands and the exact figures are discarded on the way in. Task 1 introduces `medianBand` and every finding quotes a band instead. This is the spec's own "never claim precision the data lacks" rule applied to its own example.

**Type consistency.** `Finding` is `{id, severity, title, evidence, fix}` in Task 4's definition, its tests and Task 5's renderer. `readProfileFromDom`'s return shape is identical in Tasks 2, 3 and 4. `loadProfile()` returns `{profile, readAt}` in Task 3's tests, its implementation and Task 5's caller. `matchSkills(...).matched` is used as an array in Task 4, matching its real signature.

**Known soft spots for the implementer.**

- The **selectors** in Task 2 are shaped correctly but are guesses until checked against the real fixture from Task 0. They are a starting point, not an answer.
- **Task 5 must be adjusted for the new flow.** It was written when the app fetched the profile itself. It now reads the saved copy via `loadProfile()`, and when nothing has been saved it must say so and link to the profile page — not show an empty audit. The permission-request code in that task is no longer needed, because no new permission is involved.
- `loadProfiles` in Task 5 must be checked against what `src/core/profiles.js` actually exports.
- **Two findings from the spike change Tasks 2 and 4.**

  The **"70"** on the profile page belongs to **ID Proof** and is **not a score** — an earlier draft of these documents got that wrong twice before the account holder corrected it. So `hasIdProof` should not be a bare boolean: Task 2 should read both that value and the verified/unverified state, and Task 4's `trust-id` finding should tell the reader what their ID Proof actually is rather than only that it is missing. Confirm what the value means with the account holder before writing any copy about it — do not infer it from the page.

  It also means **OnlineJobs.ph publishes no profile-quality score**, so this audit duplicates nothing.

  Separately, the test account earns far above the VA bands in the histogram, so `rate-low` must stay **silent** for a high earner rather than nagging someone already well paid.
