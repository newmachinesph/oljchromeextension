# Master test prompt

Paste everything below the line into a fresh Claude Code session opened on
`c:\Users\llino\OneDrive\Desktop\extension`. It brings up the whole stack,
drives it through a real browser, and encodes the traps that have already
cost a session's worth of debugging.

Trim the scope section to what you actually want covered — the rest of the
document is setup and discipline, and should stay.

---

You are testing OljExtension end to end: a Chrome MV3 extension, a Next.js
website + API, and the AI features that join them. Work through the stack for
real — a live browser, a live server, real HTTP — not by reading code and
reasoning about what should happen.

## The two repositories

| What | Where |
| --- | --- |
| Extension (MV3, vanilla JS content scripts, React options page) | `c:\Users\llino\OneDrive\Desktop\extension` |
| Website + API (Next.js, Neon Postgres, Drizzle) | `c:\Users\llino\OneDrive\Desktop\oljextension` |

The extension talks to the server through `API_BASE` in
`src/core/account.js`. For local work it must read `http://localhost:3100`.
Check it before anything else — if it points at `https://oljextension.site` you
will be testing production and wondering why your changes do nothing.

## Bring the stack up

Do these in order and confirm each before moving on.

1. **Server.** In the server repo, `npm run db:migrate`, then start the dev
   server **with its output redirected to a file you can read**:

   ```bash
   npm run dev > /path/to/scratchpad/dev.log 2>&1
   ```

   Run it in the background. This matters more than it looks: the route logs
   the real reason for a failure (`[analyze] byok model failed: <reason>`) and
   without a log file you get a generic 502 and no idea why. Poll
   `http://localhost:3100/` until it answers 200 rather than sleeping.

2. **Extension build.** In the extension repo, `npm run build`. The options
   page and every mini app are served from `dist/options`, so an unbuilt tree
   means you are testing a stale UI.

3. **Chrome.** Launch with remote debugging on a **persistent** profile:

   ```
   chrome.exe --remote-debugging-port=9222
              --user-data-dir="%LOCALAPPDATA%\ojrf-debug"
              --no-first-run --no-default-browser-check
   ```

   Reuse that profile. A fresh one is signed out of both OnlineJobs.ph and
   OljExtension, and half the surface under test needs a session.

4. **Load the extension over CDP.** Chrome 137+ ignores `--load-extension`, so
   it has to go in through `Extensions.loadUnpacked` on a browser-level CDP
   session. Its id is stable: `fbkfnjnmeibaoahefopkibbdikmcanjg`.

5. **Drive it with `playwright-core`**, already in the extension's
   `node_modules`. `chromium.connectOverCDP('http://127.0.0.1:9222')`. Resolve
   it with `createRequire` pointed at the extension's `package.json` when your
   script lives outside the repo.

Keep throwaway driver scripts in the session scratchpad, never in the repo.

## Traps that have already burned a session

Read these before writing a single assertion.

- **Extension network calls are invisible to the page.** They run in the
  background service worker, so `page.on('request')` and page-level CDP
  `Network` see nothing at all. To inspect one: wake the worker (open the
  popup), then `Target.setDiscoverTargets` → find the `service_worker` target →
  `Target.attachToTarget` → `Runtime.evaluate` a monkey-patch over `self.fetch`.
  The worker **sleeps when idle** and then does not appear in `/json/list`, so
  wake it first and install the tap before you trigger anything.

- **Never trust a single pass on anything touching a model.** Temperature makes
  failures intermittent. A bug that failed 6 times in 8 looked completely fine
  when sampled twice, and nearly shipped as "works". Run every model-dependent
  check **8–10 times** and report the ratio, not the last result.

- **Rate limits will bite your own test loop**, not just users:
  `ai:settings` 10/min (this covers `DELETE`, so your cleanup call can 429 and
  silently leave a credential behind), `ai:analysis` 30/min, `ai:draft` 12/min.
  After a burst of saves, wait out the window before asserting anything.

- **The rate filter collapses low-paying listings**, so the first
  `a[href*="/jobseekers/job/"]` on a search page is often hidden and unclickable.
  Navigate straight to a job URL, or pick a visible link.

- **Assert numbers, not vibes.** Measure `getBoundingClientRect()`, count
  MutationObserver records, diff credit balances. "Looks right" has been wrong
  here repeatedly.

- Foreground `sleep` is blocked; poll or use a background command.

- **Curated test data hides the defect you are looking for.** If you fill a
  form with a well-written scope of work, the contract PDF looks excellent and
  you learn nothing. See the next section.

## Judge the output, not just the status code

A 200 is not a pass. This is meant to be a high-quality tool, so for every
artefact a user sees or sends — a PDF, a drafted message, an analysis panel, a
dashboard figure — answer three questions and record the answer:

1. **Would a real user be glad to receive this, or embarrassed to send it?**
   Judge it as the person who has to put their name on it and give it to an
   employer or a client.
2. **Where does the hard part live?** If the tool asks the user to supply the
   expertise and then only formats what they typed, it is a formatter, not a
   tool. Say so.
3. **Should this be AI-assisted, and is it?** The product already has an AI
   layer (credits or BYOK) and already holds the context — the job posting, the
   applicant profile, the client record, the rate. Note every place where a
   draft-from-context would turn a blank box into a real answer.

**Test as a lazy first-time user, not as an author.** Fill only the obvious
identity fields, leave the hard boxes empty or type one careless line, then
generate. That is what the median user will do, and it is the only way the
defect shows up. Then repeat with good input to confirm the ceiling is high
too. Report both.

### The worked example to calibrate against

`http://localhost:3100/dashboard/contracts` asks a Filipino VA to write, from
an empty textarea, the scope of work, the deliverables, the payment terms and —
under "Additional terms" — *confidentiality, IP, termination*. That is legal
drafting, handed to the person least equipped to do it, and it is the reason
they opened a contract tool at all. Leave those blank and
`src/lib/ops/pdf/contract-pdf.ts:150` prints **"To be defined."** into a
document with signature lines on it. The PDF is beautifully typeset and
professionally worthless.

That is the shape of the bug. It is not a crash, nothing logs, every test
passes, and the tool ships looking finished.

### Where else to look for the same shape

Walk every one of these and apply the three questions:

- **Get-paid ops** — contracts, invoices (notes and terms), portfolio
  (*"a short paragraph about what you do and who you help"*, *"what it was,
  your role, the outcome"*), client book notes, timesheet → invoice.
- **Money and figures** — income, expenses, earnings, the PH tax estimate.
  Check the arithmetic against a hand calculation, check currency handling and
  rounding, and check what a zero/one-row account renders. A wrong number
  presented confidently is worse than no number.
- **AI outputs** — the five analysis lenses and the draft. Are they specific to
  *this* posting and *this* profile, or interchangeable advice that would suit
  any job? Does the draft sound like the applicant, or like an AI cover letter
  an employer has read a hundred times? Does "How to apply" give the actual
  steps from the posting?
- **Extension surfaces** — the red-flag and scam calls (any false positives on
  plainly legitimate posts? any obvious scam waved through?), rate parsing on
  awkward strings, the collapsed-listing stub, empty states everywhere.

### Empty and degenerate states

For every output: what does it produce with nothing filled in, with one row,
with a very long input, with non-ASCII names, with a huge number? Anything that
prints a placeholder into a finished document, silently drops a field, or
renders "undefined"/"NaN"/"—" where a user expects content is a defect worth
raising even though it never throws.

### Does it remember me?

People do not finish in one sitting. They open a mini app, drag it where they
want it, get interrupted, close the browser, and come back tomorrow expecting
to carry on. Test that, because losing someone's place is the kind of thing
that never throws an error and quietly makes a tool annoying to live with.

For each dock mini app (tracker/board, saved, snippets, calculator, timer,
pomodoro, clocks): open it, **move and resize the window**, put something
half-finished in it, minimise or maximise it, then **close the browser
entirely** and reopen. Check what survived:

- window position and size, and whether it reopens where you left it
- which apps were open, and whether they reopen
- minimised/maximised state
- the work inside — a half-typed note, a filter, a running timer, a scroll
  position, an unsaved row
- the same again across the two OnlineJobs.ph sites and after a page reload,
  which is a weaker test than a browser restart but catches different bugs

`src/content/widget-shell.js` opens every window from a fixed size preset at
`x: 'center'` and does not appear to read or write geometry anywhere, so the
likely answer is "nothing is remembered". Confirm it rather than assume it, and
say which of the above a user would actually miss. Losing a dragged window is
mildly irritating; losing a half-written note is not.

Do the same for the settings page (does it return to the tab you were on?), the
job search page (filters, sort, keywords, the skill selection, scroll position
after a reload), and the dashboard.

## Use it as a person, not as a checklist

Some of the above can be measured. The important part cannot, so do not only
tick boxes — **actually use the product, as the person it is for**: a Filipino
freelancer hunting work on OnlineJobs.ph, who is not technical, is competing
with hundreds of applicants, and will not tolerate a tool that wastes their
time or makes them look unprofessional.

Walk complete journeys rather than isolated features:

- Arrive on the job search page for the first time, set a rate, and try to find
  something worth applying to.
- Find a promising posting, check whether it is a scam, decide whether to apply,
  draft the application, send it, and track it on the board.
- Win the client, then invoice them, write the contract, log the hours, and see
  what you earned this month.

At every step ask what a person would ask: *Do I understand what this is asking
me for? Is this worth what it cost me? Would I send this to an employer? Do I
trust this number? Where did my thing go?*

Then answer the only question that matters, and answer it honestly:

> **Would I be satisfied using this? Would I recommend it to a friend who
> needed work?**

If the answer is no, say exactly where it lost you. A tool that passes every
test and still feels cheap has failed, and that failure is the one worth
reporting.

## What to cover

### 1. Static checks (both repos)

Extension: `npm test` (expect 1608 passing across 77 files) and `npm run build`.
Server: `npm test` (219 across 19), `npm run typecheck`, `npm run lint`. Lint
has pre-existing errors in `test/paymongo.test.ts` — confirm you added none
beyond those.

### 2. Free features, signed out

These must work with no account at all. On the OnlineJobs.ph job search page:
rate filtering and the collapsed-listing stub, the search/keyword row,
red-flag and scam marking, sorting, auto-refresh, the pager, the skill cloud
(hover it and click a chip **twice** — it must select then deselect, and the
chips must not flicker or rebuild while idle), and the dock with its mini apps
(tracker/board, saved, snippets, calculator, timer, pomodoro, clocks).

In the options page: every tab renders, settings persist across a reload,
backup export/import round-trips.

### 3. Account and money

Sign in, verification against the OnlineJobs.ph account, referral link and
code, account deletion. Credit balance display. A PayMongo checkout in test
mode, and the webhook at `/api/webhooks/paymongo` — sign a request the way
PayMongo does (HMAC-SHA256 over `` `${t}.${rawBody}` `` with the whole
`whsk_…` secret as the key, header `t=<unix>,te=<sig>`) and confirm a correct
signature returns 200 while a tampered one, a signature over a different body,
and a missing header all return 401. Use an event type the route reports but
does not act on, so you do not write to the credit ledger.

### 4. BYOK

The picker is a closed catalog of five models per provider
(`src/lib/byok-models.ts`). Cover:

- Save → encrypt → activate through the **dashboard UI**, not just the API.
- Every catalog model: save it, then run a real analysis and confirm
  `billing: "byok"` and **credits unchanged**.
- Off-catalog ids (`gpt-4o-mini`, a made-up id) → `400 model_unsupported`.
- A bad key → `400 credential_invalid`, and nothing persisted.
- Pause, resume, remove.
- Encryption at rest: read the `ai_credentials` row straight from Postgres and
  confirm the stored value is not the key, that it decrypts under
  `BYOK_ENCRYPTION_SECRET` and **not** under `AUTH_SECRET`, and that swapping
  the provider in the AAD (`ai-credential:{userId}:{provider}:v1`) is rejected.
- Extension surfaces agree: popup shows `BYOK · <provider>`, options Account
  names the model and says credits are not spent.

Delete the credential when you are done — it is a real key.

### 5. AI tools, through the extension

On a live job page, click each tool on the analysis panel (Should I apply?,
Job fit, Red flags, How to apply, Summary) and the draft panel. Every one must
return content, not "The AI could not answer". **Run the set repeatedly** —
this is exactly where the intermittent JSON bug hid. Confirm credits are
unchanged under BYOK, and that they decrement by the tool's cost when BYOK is
off.

### 6. API directly

Auth (401 without a token), input validation, the documented error codes
(`insufficient_credits`, `rate_limited`, `duplicate`, `model_failed`,
`credential_invalid`, `model_unsupported`), and that a failed model call under
credits refunds while under BYOK it does not.

### 7. Website

Dashboard, pricing, sign-up and sign-in, the marketing and legal pages, and
the get-paid ops tools (invoices, contracts, portfolio, client book, income,
expenses, earnings, tax estimate).

## What is missing

Testing finds broken things. It does not find absent things, and an absent
thing is often the bigger problem — nobody files a bug for a feature that was
never there, they just quietly use something else.

So finish by naming **the most important thing this product does not do.** Not
a wishlist: one or two gaps, argued. To find them, stop looking at the code and
look at the person's week. Where does the job hunt still hurt after they have
used everything here? What do they still open a spreadsheet, a chat with a
friend, or a different site for? What does a competitor do that lands better?

Judge a candidate gap on three things:

- **Does a real user feel it?** Tie it to a moment in the journey, not to a
  category of software.
- **Is this product uniquely placed to fill it?** It already holds the job
  market data it has scraped, the applicant's profile, and their whole
  application history. A feature only this product could build well beats a
  feature anyone could bolt on.
- **Is it worth the build?** Say roughly what it would take and what it would
  change for the user.

Write it as a short brief someone could act on, not as a feature name.

## How to report

For each area: what you ran, what happened, pass or fail. For anything
model-dependent give the ratio over repeated runs. For a failure, quote the
line from `dev.log` — the server's own reason beats your inference. Say plainly
what you could not test and why, rather than leaving a gap unmarked.

Separate **broken** from **shabby**. A crash is easy to see and easy to fix; an
output that works and still embarrasses the user is the thing that decides
whether they keep the tool. Rank findings by what a user would care about, not
by technical severity — a "To be defined." in a signed contract outranks a
console warning.

Close with the two honest answers: **would you be satisfied using this**, and
**what is the most important thing it still cannot do**.

Do not fix anything unless asked. Find, prove, report.
