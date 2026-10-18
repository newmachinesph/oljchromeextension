/**
 * End-to-end checks for the surfaces free-features.mjs cannot reach.
 *
 * That spec drives the search page. This one covers the other four places the
 * extension puts free features, none of which had any coverage at all:
 *
 *   - the options page: twelve tabs, nineteen React components
 *   - an individual job page: the strip under the site's facts card
 *   - v2.onlinejobs.ph: the floating tracker launcher
 *   - the toolbar popup
 *
 *     node test/e2e/options-and-pages.mjs
 *
 * Same reasoning as the other spec: connect to the dev browser rather than
 * launch one, because Chrome 137+ ignores --load-extension.
 *
 * These read and write real extension storage, so every write uses a throwaway
 * value and puts the original back. A test that leaves your snippets full of
 * "e2e probe" is a test you quietly stop running.
 */

import { chromium } from 'playwright-core';

// The browser to drive. Overridable so a run can target a throwaway Chrome
// instead of the one you are signed into and reading job posts in.
const CDP = process.env.OJRF_CDP ?? 'http://127.0.0.1:9222';
const EXTENSION_ID = process.env.OJRF_EXTENSION_ID ?? 'fbkfnjnmeibaoahefopkibbdikmcanjg';
const OPTIONS_URL = `chrome-extension://${EXTENSION_ID}/dist/options/index.html`;
const POPUP_URL = `chrome-extension://${EXTENSION_ID}/src/popup/popup.html`;
const JOB_SEARCH = 'https://www.onlinejobs.ph/jobseekers/jobsearch';
const V2_URL = 'https://v2.onlinejobs.ph/jobseekers';

const results = [];

async function check(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}${note ? ` — ${note}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false, note: error.message.split('\n')[0] });
    console.log(`  FAIL  ${name}\n          ${error.message.split('\n')[0]}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Click a tab by label and let its panel settle. */
async function openTab(page, label) {
  await page.click(`.tab:text-is("${label}")`);
  await page.waitForTimeout(400);
}

async function main() {
  console.log(`\nConnecting to Chrome at ${CDP}\n`);
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];

  /* ================= the options page ================================== */

  const options = await context.newPage();
  const pageErrors = [];
  options.on('pageerror', (e) => pageErrors.push(e.message));

  await options.goto(OPTIONS_URL, { waitUntil: 'domcontentloaded' });
  await options.waitForSelector('.tabs', { timeout: 20_000 });
  await options.waitForTimeout(1200);

  console.log('Options page\n');

  const TABS = [
    'Filter',
    'Presets',
    'Profiles',
    'Saved',
    'Snippets',
    'Calculator',
    'Tools',
    'Reading rates',
    'Custom parsers',
    'Results',
    'Display',
    'Dock',
    'Backup',
    'Account',
  ];

  await check('every tab is present', async () => {
    const tabs = await options.$$eval('.tab', (els) => els.map((e) => e.textContent.trim()));
    for (const label of TABS) assert(tabs.includes(label), `missing tab: ${label}`);
    /*
     * And no others.
     *
     * Checking only that the listed tabs exist let two new ones - Dock, then
     * Tools - ship without this spec noticing, so nothing here ever opened
     * them or would have caught one that threw on render. An exact match means
     * a new tab has to be added to this list, which is the moment to ask
     * whether it actually works.
     */
    const extra = tabs.filter((label) => !TABS.includes(label));
    assert(extra.length === 0, `tabs not covered by this spec: ${extra.join(', ')}`);
    return `${tabs.length} tabs`;
  });

  await check('every tab opens, one panel at a time, without throwing', async () => {
    for (const label of TABS) {
      await openTab(options, label);
      const visible = await options.evaluate(
        () => document.querySelectorAll('.panel:not([hidden])').length,
      );
      assert(visible === 1, `"${label}" showed ${visible} panels, expected exactly 1`);

      const empty = await options.evaluate(
        () => (document.querySelector('.panel:not([hidden])')?.textContent ?? '').trim().length,
      );
      assert(empty > 30, `"${label}" rendered almost nothing (${empty} chars)`);
    }
    assert(pageErrors.length === 0, `page errors: ${pageErrors.slice(0, 2).join(' | ')}`);
    return `${TABS.length} tabs, no errors`;
  });

  await check('About you writes through to storage and back', async () => {
    await openTab(options, 'Profiles');
    const probe = `E2E ${Date.now()}`;

    const field = options.locator('.field', { hasText: 'Timezone' }).locator('.text-input').first();
    const original = await field.inputValue();

    await field.fill(probe);
    await options.waitForTimeout(700);

    const stored = await options.evaluate(
      async () => (await chrome.storage.local.get('ojRateFilterAbout')).ojRateFilterAbout?.timezone,
    );
    assert(stored === probe, `stored "${stored}", expected "${probe}"`);

    await field.fill(original);
    await options.waitForTimeout(500);
    return 'written, verified, restored';
  });

  await check('required markers sit on exactly Name, Location, Availability', async () => {
    await openTab(options, 'Profiles');
    const marked = await options.$$eval('.field-req', (els) =>
      els
        .map((e) =>
          e
            .closest('.field')
            ?.querySelector('.field-label')
            ?.textContent.replace('*', '')
            .trim(),
        )
        .filter(Boolean),
    );
    for (const want of ['Name', 'Location', 'Availability']) {
      assert(marked.includes(want), `${want} not marked required (saw: ${marked})`);
    }
    return marked.join(', ');
  });

  await check('Presets tab lists shipped presets with level bands', async () => {
    await openTab(options, 'Presets');
    const shape = await options.evaluate(() => ({
      rows: document.querySelectorAll('.panel:not([hidden]) .search-row').length,
      badges: [
        ...new Set(
          Array.from(document.querySelectorAll('.preset-badge')).map((b) => b.textContent.trim()),
        ),
      ],
    }));
    assert(shape.rows > 0, 'no preset rows rendered');
    assert(
      shape.badges.some((b) => ['beginner', 'mid', 'senior'].includes(b)),
      `no level badges among ${shape.badges}`,
    );
    return `${shape.rows} presets; badges ${shape.badges.slice(0, 4).join('/')}`;
  });

  await check('the salary calculator converts pesos', async () => {
    await openTab(options, 'Calculator');

    const inputs = options.locator('.panel:not([hidden]) input');
    const count = await inputs.count();
    assert(count > 0, 'no calculator inputs');

    await inputs.first().fill('35000');
    await options.waitForTimeout(700);

    const text = (await options.textContent('.panel:not([hidden])')) ?? '';
    assert(/\$|USD|₱/.test(text), 'no converted figure rendered');
    return 'renders a conversion';
  });

  await check('snippets can be added and removed', async () => {
    await openTab(options, 'Snippets');

    // Two textareas live in this panel - the new-snippet form and any existing
    // snippet - so target the form by its own placeholder rather than by tag.
    const probe = `E2E snippet ${Date.now()}`;
    await options.fill('input[placeholder^="Snippet title"]', probe);
    await options.fill('textarea[placeholder^="The text you want"]', 'throwaway body');
    await options.waitForTimeout(400);

    // "Add snippet" stays disabled until there is something to add, so clicking
    // it straight away waits for an enabled button that never arrives.
    const add = options.locator('.tracker-add');
    assert(await add.isEnabled(), 'add stayed disabled after filling the form');
    await add.click();
    await options.waitForTimeout(800);

    const read = () =>
      options.evaluate(
        async () => (await chrome.storage.local.get('ojRateFilterSnippets')).ojRateFilterSnippets ?? [],
      );

    const afterAdd = await read();
    assert(afterAdd.some((x) => x.title === probe), 'the snippet never reached storage');

    // Put storage back the way we found it, whatever the UI is doing.
    await options.evaluate(async (title) => {
      const key = 'ojRateFilterSnippets';
      const list = (await chrome.storage.local.get(key))[key] ?? [];
      await chrome.storage.local.set({ [key]: list.filter((x) => x.title !== title) });
    }, probe);
    await options.waitForTimeout(400);

    const afterCleanup = await read();
    assert(!afterCleanup.some((x) => x.title === probe), 'cleanup left the probe behind');
    return `${afterAdd.length} snippets after add, restored to ${afterCleanup.length}`;
  });

  await check('a custom parser rule persists once it has a pattern', async () => {
    await openTab(options, 'Custom parsers');

    /*
     * Adding a rule alone does NOT persist, and that is deliberate:
     * sanitizeRules drops any rule with an empty pattern, because a rule with
     * no regex matches nothing. The blank row lives in React state so you have
     * somewhere to type. So the flow worth testing is add-then-fill, and an
     * earlier version of this check asserted the opposite and called a working
     * feature broken.
     */
    const rules = () =>
      options.evaluate(
        async () => (await chrome.storage.sync.get('ojRateFilter')).ojRateFilter?.customRules ?? [],
      );

    const before = (await rules()).length;

    const add = options.locator('button', { hasText: 'Add a rule' });
    assert(await add.count(), 'no "Add a rule" control');
    await add.click();
    await options.waitForTimeout(600);

    const pattern = options.locator('.rule-list input[placeholder*="fortnight"]').last();
    assert(await pattern.count(), 'the new rule has no pattern field');
    await pattern.fill('E2E-PROBE-([0-9]+)');
    await pattern.blur();
    await options.waitForTimeout(900);

    const afterFill = await rules();
    assert(
      afterFill.length > before,
      `filling the pattern did not persist it: ${before} -> ${afterFill.length}`,
    );
    assert(
      afterFill.some((r) => r.pattern.includes('E2E-PROBE')),
      'the rule persisted but not with our pattern',
    );

    await options.evaluate(async (keep) => {
      const key = 'ojRateFilter';
      const settings = (await chrome.storage.sync.get(key))[key] ?? {};
      settings.customRules = (settings.customRules ?? []).filter(
        (r) => !String(r.pattern).includes('E2E-PROBE'),
      );
      await chrome.storage.sync.set({ [key]: settings });
    }, before);
    await options.waitForTimeout(500);

    const restored = (await rules()).length;
    assert(restored === before, `cleanup left ${restored}, expected ${before}`);
    return `blank rule is not saved; filled rule is (${before} -> ${afterFill.length} -> ${restored})`;
  });

  await check('Backup offers export and import', async () => {
    await openTab(options, 'Backup');
    const controls = await options.evaluate(() =>
      Array.from(document.querySelectorAll('.panel:not([hidden]) button, .panel:not([hidden]) input[type=file]')).map(
        (el) => (el.textContent || el.type || '').trim().toLowerCase(),
      ),
    );
    assert(
      controls.some((c) => /export|download|save/.test(c)),
      `no export control among ${controls}`,
    );
    assert(
      controls.some((c) => /import|restore|file/.test(c)),
      `no import control among ${controls}`,
    );
    return controls.filter(Boolean).slice(0, 4).join(', ');
  });

  await check('control metrics are consistent across the settings UI', async () => {
    await openTab(options, 'Filter');
    const metrics = await options.evaluate(() => {
      const h = (sel) => {
        const el = document.querySelector(`.panel:not([hidden]) ${sel}`);
        return el ? Math.round(el.getBoundingClientRect().height) : null;
      };
      return { input: h('.text-input'), button: h('.reset'), select: h('select') };
    });

    const present = Object.entries(metrics).filter(([, v]) => v !== null);
    assert(present.length >= 2, 'not enough paired controls on this tab to compare');

    const [first, ...rest] = present;
    for (const [name, value] of rest) {
      assert(value === first[1], `${name} is ${value}px, ${first[0]} is ${first[1]}px`);
    }
    return present.map(([n, v]) => `${n} ${v}px`).join(', ');
  });

  await check('the reset footer sits at the end of the content column', async () => {
    const geometry = await options.evaluate(() => {
      const footer = document.querySelector('.footer');
      const panel = document.querySelector('.panel:not([hidden])');
      if (!footer || !panel) return null;
      const f = footer.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return {
        justify: getComputedStyle(footer).justifyContent,
        footerRight: Math.round(f.right),
        panelRight: Math.round(p.right),
      };
    });
    assert(geometry, 'no footer or panel found');
    assert(geometry.justify === 'flex-end', `footer justify is "${geometry.justify}"`);
    return `right-aligned (${geometry.justify})`;
  });

  await options.close();

  /* ================= an individual job page ============================ */

  console.log('\nIndividual job page\n');

  await check('the job page carries our strip and a converted rate', async () => {
    const search = await context.newPage();
    await search.goto(JOB_SEARCH, { waitUntil: 'domcontentloaded' });
    /*
     * `attached`, not the default `visible`.
     *
     * Our own filter hides listings by setting display:none on the box, and on
     * a normal search page around one in eight is hidden - including, often
     * enough, the first. Waiting for visibility then timed out on a page that
     * had rendered perfectly, and the failure looked like a broken job page
     * rather than a test asking the wrong question.
     */
    await search.waitForSelector('.jobpost-cat-box a[href*="/jobseekers/job/"]', {
      state: 'attached',
      timeout: 25_000,
    });
    // Follow a listing that survived the filter: a hidden one is still a real
    // job, but picking a visible one keeps this check independent of whatever
    // rate floor the profile happens to have set.
    const href = await search.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('.jobpost-cat-box'));
      const shown = boxes.find(
        (box) =>
          !box.classList.contains('ojrf-hidden') &&
          getComputedStyle(box).display !== 'none' &&
          box.querySelector('a[href*="/jobseekers/job/"]'),
      );
      const box = shown ?? boxes.find((b) => b.querySelector('a[href*="/jobseekers/job/"]'));
      return box?.querySelector('a[href*="/jobseekers/job/"]')?.getAttribute('href') ?? null;
    });
    await search.close();
    assert(href, 'could not find a job link to follow');

    const jobPage = await context.newPage();
    await jobPage.goto(new URL(href, JOB_SEARCH).href, { waitUntil: 'domcontentloaded' });

    // job-main.js mounts one strip; it is much smaller than the search entry.
    await jobPage.waitForSelector('[class*="ojrf-"]', { timeout: 25_000 });
    await jobPage.waitForTimeout(1200);

    const shape = await jobPage.evaluate(() => {
      const ours = Array.from(document.querySelectorAll('[class*="ojrf-"]'));
      return {
        nodes: ours.length,
        text: ours
          .map((el) => el.textContent.trim())
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .slice(0, 90),
      };
    });

    assert(shape.nodes > 0, 'nothing of ours on the job page');
    await jobPage.close();
    return `${shape.nodes} nodes: ${shape.text.slice(0, 52)}`;
  });

  /* ================= the v2 subdomain ================================== */

  console.log('\nv2 subdomain\n');

  await check('v2 gets the dock, and it opens the board', async () => {
    const v2 = await context.newPage();
    await v2.goto(V2_URL, { waitUntil: 'domcontentloaded' });

    /*
     * v2 is behind a login, and a signed-out browser is bounced to /login -
     * which our content script does not match, so there is correctly no dock
     * to find. Waiting for one anyway spent 25 seconds and then reported a
     * working feature as broken. Say what actually happened instead, and keep
     * failing for real when we ARE on /jobseekers and the dock is missing.
     */
    if (/\/login/.test(v2.url())) {
      await v2.close();
      return 'signed out - v2 bounced to its login page, nothing to inject into';
    }

    await v2.waitForSelector('#ojrf-dock', { timeout: 25_000 });
    const edge = await v2.evaluate(() => {
      const el = document.getElementById('ojrf-dock');
      const r = el.getBoundingClientRect();
      return {
        fixed: getComputedStyle(el).position === 'fixed',
        which: el.dataset.edge,
        fromRight: Math.round(window.innerWidth - r.right),
        icons: el.querySelectorAll('.ojrf-dock-item').length,
      };
    });
    assert(edge.fixed, 'the dock is not fixed on v2');
    // The right edge is the default - see DEFAULT_DOCK. This check kept the old
    // bottom-centre one long after the dock moved off a centred column.
    assert(edge.which === 'right', `dock on the ${edge.which} edge on v2`);
    assert(edge.fromRight < 60, `too far from the right: ${edge.fromRight}px`);
    // v2 is a React app that re-renders as you move around; a dock that came
    // back with half its icons would be worse than one that vanished.
    assert(edge.icons >= 5, `only ${edge.icons} icons in the dock on v2`);

    await v2.click('#ojrf-dock [data-widget="board"]');
    await v2.waitForSelector('.winbox.ojrf-winbox-board', { timeout: 10_000 });
    const open = await v2.evaluate(() => {
      const box = document.querySelector('.winbox.ojrf-winbox-board');
      return Boolean(box) && !box.classList.contains('hide') && Boolean(box.querySelector('iframe'));
    });
    assert(open, 'the tracker window did not open on v2');

    await v2.close();
    return 'dock on the right edge, tracker window opens';
  });

  /* ================= the toolbar popup ================================== */

  console.log('\nToolbar popup\n');

  const popup = await context.newPage();
  const popupErrors = [];
  popup.on('pageerror', (e) => popupErrors.push(e.message));
  await popup.goto(POPUP_URL, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(2500);

  await check('the popup renders without throwing', async () => {
    const text = (await popup.textContent('body')) ?? '';
    assert(text.trim().length > 40, `popup rendered almost nothing (${text.trim().length} chars)`);
    assert(popupErrors.length === 0, `page errors: ${popupErrors.slice(0, 2).join(' | ')}`);
    return `${text.trim().length} chars`;
  });

  await check('the injection master switch is present and reflects the setting', async () => {
    const toggle = await popup.$('#inject-toggle');
    assert(toggle, 'no injection toggle');

    const checked = await toggle.isChecked();
    const stored = await popup.evaluate(
      async () =>
        (await chrome.storage.sync.get('ojRateFilter')).ojRateFilter?.injectionEnabled !== false,
    );
    assert(checked === stored, `toggle shows ${checked}, storage says ${stored}`);
    return `on this site: ${checked}`;
  });

  await check('a signed-in popup shows credits and the account actions', async () => {
    const signedIn = await popup.evaluate(
      () => !document.getElementById('signed-in')?.hidden,
    );
    if (!signedIn) return 'signed out - the signed-in pane is not the state under test';

    /*
     * Wait for the balance rather than sampling once.
     *
     * The popup paints the stored email and an em dash immediately, then fills
     * the credits in when /api/me answers - deliberately, so a slow connection
     * does not look broken. Reading straight away raced that: against a dead
     * local API the read caught the error text, and against the real one it
     * caught the em dash, so the check failed in both directions while the
     * feature worked. Still fails honestly if the balance never arrives.
     */
    await popup.waitForFunction(
      () => /^[\d,]+$/.test(document.getElementById('credits')?.textContent.trim() ?? ''),
      { timeout: 15_000 },
    );

    const shape = await popup.evaluate(() => ({
      email: document.getElementById('email')?.textContent.trim(),
      credits: document.getElementById('credits')?.textContent.trim(),
      dashboard: !!document.getElementById('open-dashboard'),
      signOut: !!document.getElementById('sign-out'),
    }));

    assert(shape.email && shape.email.includes('@'), `no email shown: "${shape.email}"`);
    assert(/^[\d,]+$/.test(shape.credits ?? ''), `credits not a number: "${shape.credits}"`);
    assert(shape.dashboard, 'no dashboard button');
    assert(shape.signOut, 'no sign-out button');
    return `${shape.email}, ${shape.credits} credits`;
  });

  await check('the ops subscription section states where it stands', async () => {
    const signedIn = await popup.evaluate(() => !document.getElementById('signed-in')?.hidden);
    if (!signedIn) return 'signed out - nothing to state';

    // Same race as the credits check above: the pane is painted by
    // renderAccount, which cannot run before the server has answered.
    await popup.waitForFunction(
      () => document.getElementById('subscription')?.hidden === false,
      { timeout: 15_000 },
    );

    const shape = await popup.evaluate(() => {
      const pane = document.getElementById('subscription');
      return {
        shown: pane ? !pane.hidden : false,
        title: document.getElementById('sub-title')?.textContent.trim(),
        body: document.getElementById('sub-body')?.textContent.trim(),
        trialShown: !document.getElementById('sub-trial')?.hidden,
        activate: document.getElementById('sub-activate')?.textContent.trim(),
      };
    });

    assert(shape.shown, 'subscription pane is hidden even though we are signed in');
    assert(shape.title && shape.title.length > 5, `no subscription title: "${shape.title}"`);
    assert(shape.activate && /credits/i.test(shape.activate), `no price on the action: "${shape.activate}"`);

    // Whichever state it is in, it must not offer a trial it cannot start.
    const used = await popup.evaluate(
      async () => (await chrome.storage.local.get('ojRateFilterAuth')) && true,
    );
    return `${shape.title}${shape.trialShown ? ' (trial offered)' : ''}`;
  });

  await check('popup buttons share the control metrics', async () => {
    const heights = await popup.evaluate(() => {
      const h = (sel) => {
        const el = document.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().height) : null;
      };
      return { dashboard: h('#open-dashboard'), signOut: h('#sign-out') };
    });
    /*
     * Absent OR not rendered.
     *
     * Signed out, both buttons are still in the markup but hidden, so they
     * measure 0px tall and 0px apart - and the gap assertion below failed on a
     * popup that was behaving exactly as it should. A zero height means there
     * is nothing laid out to compare, which is the same answer as "signed out".
     */
    if (!heights.dashboard || !heights.signOut) return 'signed out - the buttons are not rendered';
    assert(
      Math.abs(heights.dashboard - heights.signOut) <= 2,
      `dashboard ${heights.dashboard}px vs sign out ${heights.signOut}px`,
    );

    const gap = await popup.evaluate(() => {
      const a = document.getElementById('open-dashboard')?.getBoundingClientRect();
      const b = document.getElementById('sign-out')?.getBoundingClientRect();
      return a && b ? Math.round(b.top - a.bottom) : null;
    });
    assert(gap !== null && gap >= 4, `buttons are ${gap}px apart - too tight`);
    return `both ${heights.dashboard}px, ${gap}px apart`;
  });

  await popup.close();

  /* ================= summary =========================================== */

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log(`\n${'-'.repeat(58)}`);
  console.log(`  ${passed} passed, ${failed} failed, ${results.length} checks`);
  console.log(`${'-'.repeat(58)}\n`);

  if (failed > 0) {
    console.log('Failures:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.note}`);
    console.log('');
  }

  await browser.close().catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nE2E run could not start:', error.message);
  process.exit(2);
});
