/**
 * End-to-end checks for the free features, driven through a real browser.
 *
 * Deliberately NOT part of the Vitest suite. Those tests are pure and run in
 * milliseconds against jsdom; these need a live Chrome, a loaded extension and
 * the real OnlineJobs.ph, and folding them together would make `npm test`
 * depend on all three. Run this on purpose:
 *
 *     node test/e2e/free-features.mjs
 *
 * It CONNECTS to an already-running Chrome rather than launching one, because
 * Chrome 137+ ignores --load-extension: the extension has to be put there by
 * CDP's Extensions.loadUnpacked first, which is what the dev browser on 9222
 * already has. Launching our own would give us a browser with no extension in
 * it, which would pass nothing.
 *
 * Every check is independent and reports its own verdict, so one failure does
 * not hide the twelve after it. A check that cannot run says so rather than
 * quietly counting as a pass - a green run has to mean something.
 */

import { chromium } from 'playwright-core';

// The browser to drive. Overridable so a run can target a throwaway Chrome
// instead of the one you are signed into and reading job posts in.
const CDP = process.env.OJRF_CDP ?? 'http://127.0.0.1:9222';
const SEARCH_URL = 'https://www.onlinejobs.ph/jobseekers/jobsearch';

const results = [];
let page;

/** Run one check, catching everything so the rest of the run continues. */
async function check(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note ?? '' });
    console.log(`  PASS  ${name}${note ? ` — ${note}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false, note: error.message });
    console.log(`  FAIL  ${name}\n          ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Settle after an action that re-renders the list. */
const settle = (ms = 500) => page.waitForTimeout(ms);

/**
 * Wait until page merging has stopped bringing listings in.
 *
 * The extension pulls several further result pages after load, one request at
 * a time, so the list keeps growing for a few seconds. Asserting before it
 * settles measures a moving target - a rate-floor check once read "18 visible"
 * beforehand and "60 visible" after RAISING the floor, purely because thirty
 * more listings arrived in between. Two identical samples in a row is enough:
 * merges land in whole pages, not a trickle.
 */
async function waitForMerge({ timeout = 45_000 } = {}) {
  const loaded = () =>
    page.evaluate(() => {
      const text = document.querySelector('.ojrf-count-line')?.textContent ?? '';
      return Number(/of (\d+) loaded/.exec(text)?.[1] ?? 0);
    });

  const deadline = Date.now() + timeout;
  let previous = -1;

  while (Date.now() < deadline) {
    const current = await loaded();
    if (current > 0 && current === previous) return current;
    previous = current;
    await settle(1500);
  }
  return previous;
}

/**
 * Close the job modal and prove it closed.
 *
 * Its backdrop covers the page, so a modal that quietly stays open turns every
 * later check into a click-intercepted timeout - which reads as five broken
 * features instead of one unclosed dialog.
 */
async function closeModal() {
  const close = await page.$('#ojrf-modal .ojrf-modal-close');
  if (close) await close.click();
  else await page.keyboard.press('Escape');

  await page.waitForFunction(
    () => {
      const modal = document.getElementById('ojrf-modal');
      return !modal || modal.hidden;
    },
    { timeout: 5000 },
  );
}

async function main() {
  console.log(`\nConnecting to Chrome at ${CDP}\n`);
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];

  page =
    context.pages().find((p) => p.url().includes('/jobseekers/jobsearch')) ??
    (await context.newPage());

  if (!page.url().includes('/jobseekers/jobsearch')) {
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
  }

  /*
   * Reload before asserting anything.
   *
   * This connects to a long-lived dev browser, so whatever the last run left
   * behind is still on screen - and an overlay left open by one failure blocks
   * every click after it, which reads as a dozen broken features instead of one
   * dialog nobody closed. A reload is the only cheap way to know what state we
   * are starting from.
   */
  await page.reload({ waitUntil: 'domcontentloaded' });

  // The content script mounts after document_idle; wait for our own bar rather
  // than a fixed sleep, so a slow page does not read as a broken extension.
  await page.waitForSelector('#ojrf-bar', { timeout: 30_000 });
  await settle(2500);

  const stale = await page.evaluate(() =>
    ['ojrf-modal', 'ojrf-presets', 'ojrf-palette']
      .map((id) => document.getElementById(id))
      .filter((el) => el && !el.hidden).length,
  );
  assert(stale === 0, `${stale} overlay(s) already open after a reload`);

  console.log('Extension is mounted. Running checks.\n');

  /* ---- the control bar ------------------------------------------------ */

  await check('control bar renders its controls', async () => {
    const parts = await page.evaluate(() => ({
      amount: !!document.querySelector('.ojrf-amount'),
      sort: !!document.querySelector('.ojrf-sort-select'),
      terms: !!document.querySelector('.ojrf-term-input'),
      palette: !!document.querySelector('.ojrf-palette-open'),
      presets: !!document.querySelector('.ojrf-presets-open'),
      copyAll: !!document.querySelector('.ojrf-copy-all'),
    }));
    for (const [k, v] of Object.entries(parts)) assert(v, `missing control: ${k}`);
    return `${Object.keys(parts).length} controls`;
  });

  await check('result count line is rewritten with our numbers', async () => {
    const text = await page.textContent('.ojrf-count-line');
    assert(/of \d+ loaded/.test(text), `unexpected count line: ${text}`);
    return text.trim().slice(0, 52);
  });

  await check('summary reports why listings are hidden', async () => {
    const text = (await page.textContent('.ojrf-detail')) ?? '';
    assert(text.trim().length > 0, 'summary detail is empty');
    return text.trim().slice(0, 52);
  });

  /* ---- rate filtering ------------------------------------------------- */

  await check('page merging settles before anything is measured', async () => {
    const loaded = await waitForMerge();
    assert(loaded > 30, `only ${loaded} listings loaded - merging did not run`);
    return `${loaded} listings loaded`;
  });

  await check('raising the rate floor hides more listings', async () => {
    const before = await page.evaluate(
      () => document.querySelectorAll('.jobpost-cat-box:not(.ojrf-hidden)').length,
    );

    await page.fill('.ojrf-amount', '5000');
    await page.dispatchEvent('.ojrf-amount', 'change');
    await settle(900);

    const after = await page.evaluate(
      () => document.querySelectorAll('.jobpost-cat-box:not(.ojrf-hidden)').length,
    );
    assert(after < before, `expected fewer visible listings, got ${before} -> ${after}`);
    return `${before} -> ${after} visible`;
  });

  await check('lowering it brings them back', async () => {
    await page.fill('.ojrf-amount', '900');
    await page.dispatchEvent('.ojrf-amount', 'change');
    await settle(900);

    const visible = await page.evaluate(
      () => document.querySelectorAll('.jobpost-cat-box:not(.ojrf-hidden)').length,
    );
    assert(visible > 0, 'no listings came back');
    return `${visible} visible`;
  });

  /* ---- collapse ------------------------------------------------------- */

  await check('hidden listings collapse into an expandable stub', async () => {
    const group = await page.$('#ojrf-hidden-group');
    assert(group, 'no hidden-listings group found');

    const heading = (await page.textContent('.ojrf-group-heading, .ojrf-group-toggle')) ?? '';
    assert(/hidden/i.test(heading), `group heading unexpected: ${heading.trim()}`);

    // It expands: the stubs inside are the point of collapsing rather than
    // simply removing, so a group that will not open is a broken feature.
    await page.click('.ojrf-group-toggle');
    await settle(400);
    const opened = await page.evaluate(
      () => document.querySelector('#ojrf-hidden-group')?.classList.contains('ojrf-group-open'),
    );
    assert(opened, 'the hidden group did not expand');

    const stubs = await page.evaluate(() => document.querySelectorAll('.ojrf-stub').length);
    assert(stubs > 0, 'expanded, but no stubs inside');

    await page.click('.ojrf-group-toggle');
    await settle(300);
    return `${heading.trim().slice(0, 28)}, ${stubs} stubs`;
  });

  /* ---- per-listing chips ---------------------------------------------- */

  await check('listings carry our meta chips', async () => {
    const chips = await page.evaluate(() => {
      const card = document.querySelector('.jobpost-cat-box:not(.ojrf-hidden)');
      if (!card) return null;
      return Array.from(card.querySelectorAll('[class*="ojrf-chip"], .ojrf-meta-row *'))
        .map((el) => el.textContent.trim())
        .filter(Boolean)
        .slice(0, 6);
    });
    assert(chips && chips.length > 0, 'no meta chips on the first visible listing');
    return chips.join(' · ').slice(0, 60);
  });

  /* ---- auto-refresh tick ---------------------------------------------- */

  await check('auto-refresh tick sits in the control row and toggles', async () => {
    const tick = await page.$('.ojrf-auto .ojrf-auto-on');
    assert(tick, 'auto-refresh tick not found');

    const inStats = await page.evaluate(() => !!document.querySelector('.ojrf-stats .ojrf-auto'));
    assert(inStats, 'tick is not in the stats row');

    const before = await tick.isChecked();
    await tick.click();
    await settle(400);
    const after = await tick.isChecked();
    assert(before !== after, 'clicking the tick did not change it');

    const selectDisabled = await page.evaluate(
      () => document.querySelector('.ojrf-auto-every').disabled,
    );
    assert(selectDisabled === !after, 'interval select did not follow the tick');

    await tick.click(); // put it back
    await settle(400);
    return `toggled ${before} -> ${after} -> ${await tick.isChecked()}`;
  });

  /* ---- preset picker --------------------------------------------------- */

  await check('preset picker opens with groups and level bands', async () => {
    await page.click('.ojrf-presets-open');
    await page.waitForSelector('#ojrf-presets:not([hidden])', { timeout: 5000 });

    const shape = await page.evaluate(() => ({
      groups: document.querySelectorAll('.ojrf-preset-group').length,
      cards: document.querySelectorAll('.ojrf-preset-card').length,
      levels: Array.from(document.querySelectorAll('.ojrf-presets-menu .ojrf-preset-level')).map(
        (b) => b.textContent.trim(),
      ),
      newBtn: !!document.querySelector('.ojrf-presets-new'),
    }));

    assert(shape.groups > 0, 'no preset groups');
    assert(shape.cards > 0, 'no preset cards');
    assert(shape.newBtn, 'no "new preset" button');
    assert(shape.levels.includes('Beginner'), `level bands missing: ${shape.levels}`);
    return `${shape.cards} cards in ${shape.groups} groups`;
  });

  await check('the level filter narrows the picker', async () => {
    const before = await page.evaluate(
      () => document.querySelectorAll('.ojrf-preset-card').length,
    );
    await page.click('.ojrf-presets-menu .ojrf-preset-level:has-text("Beginner")');
    await settle(300);
    const after = await page.evaluate(
      () => document.querySelectorAll('.ojrf-preset-card').length,
    );
    assert(after < before, `expected fewer cards, got ${before} -> ${after}`);

    await page.click('.ojrf-presets-menu .ojrf-preset-level:has-text("Any level")');
    await settle(300);
    return `${before} -> ${after} cards`;
  });

  await check('the kebab offers edit, copy and hide', async () => {
    await page.click('.ojrf-preset-kebab');
    await settle(250);
    const items = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('.ojrf-preset-menu:not([hidden]) .ojrf-preset-menu-item'),
      ).map((b) => b.textContent.trim()),
    );
    assert(items.includes('Edit'), `no Edit: ${items}`);
    assert(items.includes('Copy'), `no Copy: ${items}`);
    assert(items.includes('Hide'), `no Hide: ${items}`);
    return items.join(', ');
  });

  await check('the in-modal editor opens and cancels cleanly', async () => {
    await page.keyboard.press('Escape'); // close the kebab
    await settle(200);
    await page.click('.ojrf-presets-new');
    await page.waitForSelector('.ojrf-preset-editor', { timeout: 4000 });

    const fields = await page.evaluate(
      () => document.querySelectorAll('.ojrf-preset-editor .ojrf-preset-input').length,
    );
    assert(fields >= 5, `expected the full form, saw ${fields} inputs`);

    await page.click('.ojrf-preset-editor .ojrf-preset-minor:has-text("Cancel")');
    await settle(300);
    const gone = await page.evaluate(() => !document.querySelector('.ojrf-preset-editor'));
    assert(gone, 'editor did not close on cancel');
    return `${fields} fields, cancelled`;
  });

  await check('Escape closes the picker', async () => {
    await page.keyboard.press('Escape');
    await settle(300);
    const hidden = await page.evaluate(() => document.getElementById('ojrf-presets').hidden);
    assert(hidden, 'picker stayed open');
    return 'closed';
  });

  /* ---- command palette -------------------------------------------------- */

  await check('command palette opens and closes', async () => {
    await page.click('.ojrf-palette-open');
    await settle(500);
    await page.waitForSelector('#ojrf-palette', { timeout: 8000 });
    const open = await page.evaluate(() => {
      const el = document.getElementById('ojrf-palette');
      return Boolean(el) && !el.hidden;
    });
    assert(open, 'palette exists but is hidden');

    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('ojrf-palette');
        return !el || el.hidden;
      },
      { timeout: 5000 },
    );
    return 'opened and closed';
  });

  /* ---- job modal -------------------------------------------------------- */

  await check('a listing opens in the modal, with its description', async () => {
    await page.evaluate(() => {
      const card = document.querySelector('.jobpost-cat-box:not(.ojrf-hidden)');
      const link = card?.querySelector('a[href*="/jobseekers/job/"]');
      link?.click();
    });

    // The shell appears immediately and the description arrives from a fetch,
    // so waiting for the shell would assert on an empty box.
    await page.waitForSelector('.ojrf-modal-desc', { timeout: 20_000 });
    const body = (await page.textContent('.ojrf-modal-desc')) ?? '';
    assert(body.trim().length > 40, `modal description too short: ${body.trim().length} chars`);

    await closeModal();
    return `${body.trim().length} chars of description`;
  });

  /* ---- application board ------------------------------------------------ */

  await check('the dock opens the tracker', async () => {
    await closeModal().catch(() => {});

    const icon = await page.$('#ojrf-dock [data-widget="board"]');
    assert(icon, 'no tracker icon in the dock');

    // Pinned to an edge, not wherever the flow happened to put it - that
    // placement is the whole reason the tracker left the control bar.
    //
    // The right edge, not the bottom: OLJ centres its results column, so a dock
    // pinned to the middle of the bottom edge covers a listing and swallows the
    // clicks meant for it. This check was written against the old default and
    // went on asserting it long after DEFAULT_DOCK moved.
    const edge = await page.evaluate(() => {
      const el = document.getElementById('ojrf-dock');
      const r = el.getBoundingClientRect();
      return {
        fixed: getComputedStyle(el).position === 'fixed',
        which: el.dataset.edge,
        fromRight: Math.round(window.innerWidth - r.right),
      };
    });
    assert(edge.fixed, 'the dock is not fixed');
    assert(edge.which === 'right', `dock defaulted to the ${edge.which} edge`);
    assert(edge.fromRight < 60, `too far from the right edge: ${edge.fromRight}px`);

    assert(!(await page.$('.ojrf-board-open')), 'the old toolbar tracker icon is still there');
    assert(!(await page.$('#ojrf-board-launcher')), 'the old floating launcher is still there');

    await icon.click();
    await settle(1400);
    await page.waitForSelector('.winbox.ojrf-winbox', { timeout: 10_000 });

    const win = await page.evaluate(() => {
      const box = document.querySelector('.winbox.ojrf-winbox');
      const frame = box?.querySelector('iframe');
      return {
        title: box?.querySelector('.wb-title')?.textContent?.trim(),
        hasFrame: Boolean(frame),
        view: frame ? new URL(frame.src).searchParams.get('view') : null,
        zIndex: Number(getComputedStyle(box).zIndex),
        controls: ['wb-min', 'wb-max', 'wb-close'].filter((c) => box.querySelector(`.${c}`)).length,
      };
    });
    assert(win.hasFrame, 'the tracker window has no frame in it');
    assert(win.view === 'board', `the window framed "${win.view}" rather than the board`);
    assert(win.title === 'Tracker', `wrong window title: ${win.title}`);
    // It has to clear the job site's own chrome, and the dock.
    assert(win.zIndex >= 2147482000, `window z-index too low: ${win.zIndex}`);
    assert(win.controls === 3, `expected minimise, maximise and close; found ${win.controls}`);

    /*
     * Closing hides the window, it does not destroy it.
     *
     * The frame has to survive so a half-written note or a running timer is
     * still there when you come back - so this asserts the iframe is still in
     * the document, not that the window is gone.
     */
    await page.click('.winbox.ojrf-winbox .wb-close');
    await page.waitForFunction(
      () => {
        const box = document.querySelector('.winbox.ojrf-winbox');
        return box && box.classList.contains('hide');
      },
      { timeout: 5000 },
    );
    const kept = await page.evaluate(
      () => Boolean(document.querySelector('.winbox.ojrf-winbox iframe')),
    );
    assert(kept, 'closing threw the frame away instead of hiding the window');
    return `titled "${win.title}", ${win.controls} controls, hidden not destroyed`;
  });

  await check('a mini app opens in its own window, sized for what it is', async () => {
    // The whole point of the descriptor-driven shell: a clock is not the board
    // and must not be given the same window.
    await page.click('#ojrf-dock [data-widget="clocks"]');
    await page.waitForFunction(
      () => {
        const box = document.querySelector('.winbox.ojrf-winbox-clocks');
        return box && !box.classList.contains('hide');
      },
      { timeout: 10_000 },
    );

    const sizes = await page.evaluate(() => {
      const read = (sel) => {
        const box = document.querySelector(sel);
        if (!box) return null;
        const r = box.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        clocks: read('.winbox.ojrf-winbox-clocks'),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        title: document
          .querySelector('.winbox.ojrf-winbox-clocks .wb-title')
          ?.textContent?.trim(),
        // Two windows now exist at once, which the old single-modal shell
        // could not do at all. The board is hidden, so it is counted rather
        // than measured - a display:none element has a zero-size rect, and
        // comparing against that measures nothing.
        windows: document.querySelectorAll('.winbox.ojrf-winbox').length,
      };
    });

    assert(sizes.title === 'Clocks', `wrong title: ${sizes.title}`);
    assert(sizes.windows === 2, `expected two windows to coexist, found ${sizes.windows}`);
    // The board asks for 100% and a clock asks for 400px; the claim under test
    // is that a glanceable widget does not take the screen.
    assert(
      sizes.clocks.w < sizes.viewport.w * 0.7,
      `the clock window (${sizes.clocks.w}px) took most of a ${sizes.viewport.w}px viewport`,
    );

    await page.click('.winbox.ojrf-winbox-clocks .wb-close');
    await settle(500);
    return `clocks ${sizes.clocks.w}x${sizes.clocks.h} in a ${sizes.viewport.w}px viewport, 2 windows`;
  });

  /* ---- sorting ---------------------------------------------------------- */

  await check('sorting reorders the list', async () => {
    /*
     * Read the VISUAL order, not the DOM.
     *
     * order.js ranks by setting a CSS `order` on each flex child and leaves the
     * DOM exactly as the site built it - that is the point, so switching sorting
     * off unwinds to nothing. Asserting on document order therefore tests the
     * opposite of the design and fails on a feature that is working.
     */
    const visualFirst = () =>
      page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll('.jobpost-cat-box:not(.ojrf-hidden)'),
        );
        const ranked = cards
          .map((card) => ({
            order: Number(getComputedStyle(card).order) || 0,
            href:
              card.querySelector('a[href*="/jobseekers/job/"]')?.getAttribute('href') ?? '',
          }))
          .sort((a, b) => a.order - b.order);
        return ranked[0]?.href ?? '';
      });

    const current = await page.evaluate(() => document.querySelector('.ojrf-sort-select').value);
    const options = await page.evaluate(() =>
      Array.from(document.querySelector('.ojrf-sort-select').options).map((o) => o.value),
    );
    const other = options.find((o) => o !== current);
    assert(other, `no alternative sort mode among ${options}`);

    const before = await visualFirst();
    assert(before, 'no visible listing to rank');

    await page.selectOption('.ojrf-sort-select', other);
    await settle(1200);
    const after = await visualFirst();

    const sortedClass = await page.evaluate(() =>
      Boolean(document.querySelector('.ojrf-sorted')),
    );

    await page.selectOption('.ojrf-sort-select', current);
    await settle(800);
    const restored = await visualFirst();

    assert(sortedClass, 'the container was never put into sorted mode');
    assert(before !== after, `top listing unchanged under "${other}"`);
    assert(restored === before, 'switching back did not restore the original order');
    return `${current} -> ${other} -> ${current}, order restored`;
  });

  await check('PHP listings convert at the configured rate', async () => {
    const fx = await page.evaluate(
      async () => (await chrome.storage.sync.get('ojRateFilter')).ojRateFilter?.fxPhpPerUsd ?? 61,
    ).catch(() => 61);

    const sample = await page.evaluate(() => {
      // The site writes pesos both ways - "PHP 35,000/month" is far more common
      // on this board than the symbol, and matching only "₱" skipped every one
      // of them while reporting "none found", which reads like a clean pass.
      const MONEY = /(?:₱|PHP|Php)\s?([\d,]{4,})(?:\s*-\s*(?:₱|PHP|Php)?\s?[\d,]{4,})?\s*\/?\s*(?:mo|month)/i;

      for (const card of document.querySelectorAll('.jobpost-cat-box')) {
        const raw = (card.textContent ?? '').replace(/\s+/g, ' ');
        const match = MONEY.exec(raw);
        if (!match) continue;

        const badge = card.querySelector('[class*="ojrf"][class*="rate"], .ojrf-badge');
        if (!badge) continue;

        return {
          php: Number(match[1].replace(/,/g, '')),
          badge: badge.textContent.trim(),
          // A range quotes the low end first; our badge may read either end, so
          // the assertion below allows for that rather than guessing.
          isRange: /-/.test(match[0]),
          raw: match[0],
        };
      }
      return null;
    });

    if (!sample) return 'no peso-quoted listing on this page right now';

    const shown = Number((/\$([\d,]+)/.exec(sample.badge)?.[1] ?? '').replace(/,/g, ''));
    assert(shown > 0, `badge carried no dollar figure: "${sample.badge}"`);

    const expected = sample.php / fx;
    const drift = Math.abs(shown - expected) / expected;
    // A range is allowed to read from either end, so only assert the low end
    // when the listing quoted a single figure.
    const tolerance = sample.isRange ? 4 : 0.15;
    assert(
      drift < tolerance,
      `${sample.raw} at ${fx}/USD should be ~$${Math.round(expected)}, badge said $${shown}`,
    );
    return `${sample.raw} -> $${shown} at ${fx}/USD`;
  });

  /* ---- summary ---------------------------------------------------------- */

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

  // Detach, never close: this is the developer's live browser, not ours.
  await browser.close().catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nE2E run could not start:', error.message);
  process.exit(2);
});
