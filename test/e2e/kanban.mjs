/**
 * End-to-end checks for the application board.
 *
 *     node test/e2e/kanban.mjs
 *
 * Opens the board page directly (`?view=board`) rather than through the modal's
 * iframe on OnlineJobs.ph: the board is the same component either way, and
 * driving it straight is one less moving part between a failure and its cause.
 *
 * It seeds a lane with throwaway jobs so the scrolling and reordering checks
 * have something to work on, and puts the store back exactly as it found it -
 * including when a check fails, since a board left full of "E2E job 14" is a
 * test nobody runs twice.
 *
 * HTML5 drag-and-drop cannot be driven by mouse events in Chrome, so the drop
 * is dispatched as real DragEvents carrying a shared DataTransfer. That is what
 * the page's own handlers listen for, so it exercises the same code path a
 * person does - it just skips the pointer.
 */

import { chromium } from 'playwright-core';

// The browser to drive. Overridable so a run can target a throwaway Chrome
// instead of the one you are signed into and reading job posts in.
const CDP = process.env.OJRF_CDP ?? 'http://127.0.0.1:9222';
const EXTENSION_ID = process.env.OJRF_EXTENSION_ID ?? 'fbkfnjnmeibaoahefopkibbdikmcanjg';
const BOARD_URL = `chrome-extension://${EXTENSION_ID}/dist/options/index.html?view=board`;

const SAVED_KEY = 'ojRateFilterSaved';
const CONFIG_KEY = 'ojRateFilterBoardConfig';
/*
 * Restored too, and easy to forget.
 *
 * Moving a card to another lane turns a saved job into an APPLICATION, so it
 * leaves the saved store entirely. Snapshotting only saved+config meant each
 * run left one application behind, and the next run seeded fourteen cards and
 * found thirteen - a stale fixture reported as a broken lane.
 */
const APPS_KEY = 'ojRateFilterApplications';
const SEED_COUNT = 14;

const results = [];
let page;

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

const settle = (ms = 500) => page.waitForTimeout(ms);

/** Titles in the Saved lane, top to bottom. */
const laneTitles = () =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll('.kanban-col-saved .kanban-card .kanban-card-title'),
      (a) => a.textContent.trim(),
    ),
  );

/**
 * Drag one element onto another.
 *
 * Chrome will not start an HTML5 drag from synthetic mouse movement, and a
 * hand-built `new DragEvent(type, { dataTransfer })` arrives with a NULL
 * dataTransfer - so the board's dragstart threw on setData, never told React a
 * drag had begun, and every drop was ignored. That failure looked exactly like
 * broken drag-and-drop, including on the lane-to-lane move which has always
 * worked.
 *
 * Playwright's dispatchEvent builds the event properly around a live
 * DataTransfer handle, which is what the page's own handlers receive.
 */
async function dragOnto(sourceLocator, targetLocator, edge = 'top') {
  const data = await page.evaluateHandle(() => new DataTransfer());

  /*
   * Handles, not locators, and resolved before anything is dispatched.
   *
   * A cross-lane drop moves the card out of the lane its locator described, so
   * re-resolving that locator for `dragend` waits thirty seconds for an element
   * that has correctly gone somewhere else - a passing feature reported as a
   * timeout. A handle keeps pointing at the same node wherever React puts it.
   */
  const source = await sourceLocator.elementHandle();
  const target = await targetLocator.elementHandle();

  // The drop slot is decided by which half of the target the pointer is in, so
  // clientY has to be real - a bare dispatch would always read as the top half
  // and the bottom of a lane would stay unreachable.
  const box = await target.boundingBox();
  const clientY = edge === 'bottom' ? box.y + box.height * 0.8 : box.y + box.height * 0.2;
  const clientX = box.x + box.width / 2;

  await source.dispatchEvent('dragstart', { dataTransfer: data });
  await target.dispatchEvent('dragover', { dataTransfer: data, clientX, clientY });
  await target.dispatchEvent('drop', { dataTransfer: data, clientX, clientY });
  await source.dispatchEvent('dragend', { dataTransfer: data }).catch(() => {
    // The node can be gone already after a cross-lane move; the drop is done.
  });

  await Promise.all([source.dispose(), target.dispose(), data.dispose()]);
}

/** The Saved-lane card whose title matches, as a locator. */
const savedCard = (title) =>
  page.locator('.kanban-col-saved .kanban-card').filter({ hasText: title }).first();

async function main() {
  console.log(`\nConnecting to Chrome at ${CDP}\n`);
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  page = await context.newPage();

  await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded' });
  /*
   * The toolbar, not the lanes.
   *
   * An empty board renders its "nothing here yet" state instead of the kanban,
   * so waiting for `.kanban` before anything is seeded can only ever time out -
   * which is exactly what happens the first time this runs against a fresh
   * profile rather than the one you have been using all week. The toolbar is
   * there either way, and is the honest signal that the page came up.
   */
  await page.waitForSelector('.tracker-toolbar', { timeout: 20_000 });
  await settle(1200);

  // Everything below runs against seeded data; the originals go back at the end.
  const original = await page.evaluate(
    async ([saved, config, apps]) => {
      const store = await chrome.storage.local.get([saved, config, apps]);
      return {
        saved: store[saved] ?? null,
        config: store[config] ?? null,
        apps: store[apps] ?? null,
      };
    },
    [SAVED_KEY, CONFIG_KEY, APPS_KEY],
  );

  const restore = async () => {
    await page.evaluate(
      async ([saved, config, apps, data]) => {
        const put = async (key, value) => {
          if (value === null) await chrome.storage.local.remove(key);
          else await chrome.storage.local.set({ [key]: value });
        };
        await put(saved, data.saved);
        await put(config, data.config);
        await put(apps, data.apps);
      },
      [SAVED_KEY, CONFIG_KEY, APPS_KEY, original],
    );
  };

  try {
    console.log('Application board\n');

    // Put one card in before the lane checks, so they have a board to look at
    // even on a profile that has never saved a job.
    await page.evaluate(
      async ([key]) => {
        const store = (await chrome.storage.local.get(key))[key] ?? {};
        if (Object.keys(store).length === 0) {
          await chrome.storage.local.set({
            [key]: {
              'e2e-prime': {
                title: 'E2E prime',
                url: 'https://www.onlinejobs.ph/jobseekers/job/e2e-prime',
                employer: 'E2E Co',
                savedAt: Date.now(),
              },
            },
          });
        }
      },
      [SAVED_KEY],
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.kanban', { timeout: 20_000 });
    await settle(900);

    await check('the board renders its lanes', async () => {
      const lanes = await page.$$eval('.kanban-col', (els) =>
        els.map((e) => e.querySelector('.kanban-title')?.textContent.trim()).filter(Boolean),
      );
      assert(lanes.length >= 5, `only ${lanes.length} lanes: ${lanes}`);
      assert(lanes.includes('Saved'), `no Saved lane among ${lanes}`);
      return lanes.join(' · ');
    });

    await check('the board offers the drag-to-reorder sort', async () => {
      const options = await page.$$eval('select[aria-label="Sort jobs"] option', (els) =>
        els.map((e) => ({ value: e.value, label: e.textContent.trim() })),
      );
      const manual = options.find((o) => o.value === 'manual');
      assert(manual, `no manual sort among ${options.map((o) => o.value)}`);
      return `${options.length} sorts, incl. "${manual.label}"`;
    });

    await check(`a lane with ${SEED_COUNT} cards scrolls inside itself`, async () => {
      await page.evaluate(
        async ([key, count, appsKey]) => {
          /*
           * Clear our own leftovers first.
           *
           * A cross-lane drop in an earlier run promoted a seeded job to an
           * application, and an application is excluded from Saved - so the
           * next run seeded fourteen and counted twelve. Self-healing beats
           * remembering to tidy up by hand.
           */
          const apps = (await chrome.storage.local.get(appsKey))[appsKey] ?? {};
          for (const id of Object.keys(apps)) {
            if (id.startsWith('e2e-job-')) delete apps[id];
          }
          await chrome.storage.local.set({ [appsKey]: apps });

          const now = Date.now();
          const seeded = {};
          for (let i = 1; i <= count; i += 1) {
            seeded[`e2e-job-${i}`] = {
              title: `E2E job ${String(i).padStart(2, '0')}`,
              url: `https://www.onlinejobs.ph/jobseekers/job/e2e-${i}`,
              employer: 'E2E Co',
              savedAt: now - i * 1000,
            };
          }
          await chrome.storage.local.set({ [key]: seeded });
        },
        [SAVED_KEY, SEED_COUNT, APPS_KEY],
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.kanban-col-saved .kanban-card', { timeout: 15_000 });
      await settle(900);

      const geometry = await page.evaluate(() => {
        const lane = document.querySelector('.kanban-col-saved');
        const cards = lane.querySelector('.kanban-cards');
        return {
          count: lane.querySelectorAll('.kanban-card').length,
          overflowY: getComputedStyle(cards).overflowY,
          scrollable: cards.scrollHeight > cards.clientHeight + 4,
          laneHeight: Math.round(lane.getBoundingClientRect().height),
          boardHeight: Math.round(document.querySelector('.kanban').getBoundingClientRect().height),
        };
      });

      assert(geometry.count === SEED_COUNT, `seeded ${SEED_COUNT}, board shows ${geometry.count}`);
      assert(geometry.overflowY === 'auto', `lane overflow-y is "${geometry.overflowY}"`);
      assert(geometry.scrollable, 'the lane is not actually scrollable with a full stack');
      assert(
        geometry.laneHeight <= geometry.boardHeight + 2,
        `lane ${geometry.laneHeight}px is taller than the board ${geometry.boardHeight}px`,
      );
      return `${geometry.count} cards, lane ${geometry.laneHeight}px, scrolls internally`;
    });

    await check('the lane actually scrolls to the last card', async () => {
      const scrolled = await page.evaluate(() => {
        const cards = document.querySelector('.kanban-col-saved .kanban-cards');
        cards.scrollTop = cards.scrollHeight;
        return {
          top: Math.round(cards.scrollTop),
          max: Math.round(cards.scrollHeight - cards.clientHeight),
        };
      });
      assert(scrolled.top > 0, 'scrollTop stayed at 0');
      assert(
        Math.abs(scrolled.top - scrolled.max) < 3,
        `stopped at ${scrolled.top} of ${scrolled.max}`,
      );
      return `scrolled ${scrolled.top}px`;
    });

    await check('dragging a card within a lane reorders it', async () => {
      await page.selectOption('select[aria-label="Sort jobs"]', 'manual');
      await settle(700);

      const before = await laneTitles();
      assert(before.length >= 4, `not enough cards to reorder: ${before.length}`);

      const moved = before[3];
      const target = before[0];
      await dragOnto(savedCard(moved), savedCard(target));
      await settle(900);

      const after = await laneTitles();
      assert(after[0] === moved, `expected "${moved}" first, got "${after[0]}"`);
      assert(after.length === before.length, `lost a card: ${before.length} -> ${after.length}`);
      assert(new Set(after).size === after.length, 'a card was duplicated by the reorder');
      return `"${moved}" moved above "${target}"`;
    });

    await check('a card can be dropped at the very bottom of a lane', async () => {
      const before = await laneTitles();
      const moved = before[0];
      const last = before[before.length - 1];

      await dragOnto(savedCard(moved), savedCard(last), 'bottom');
      await settle(900);

      const after = await laneTitles();
      assert(
        after[after.length - 1] === moved,
        `expected "${moved}" last, got "${after[after.length - 1]}"`,
      );
      assert(after.length === before.length, `lost a card: ${before.length} -> ${after.length}`);
      return `"${moved}" moved below "${last}"`;
    });

    await check('a card can be dropped at the very top of a lane', async () => {
      const before = await laneTitles();
      const moved = before[before.length - 1];
      const first = before[0];

      await dragOnto(savedCard(moved), savedCard(first), 'top');
      await settle(900);

      const after = await laneTitles();
      assert(after[0] === moved, `expected "${moved}" first, got "${after[0]}"`);
      return `"${moved}" moved above "${first}"`;
    });

    await check('a drop indicator shows where the card would land', async () => {
      const before = await laneTitles();
      const source = await savedCard(before[2]).elementHandle();
      const target = await savedCard(before[0]).elementHandle();
      const data = await page.evaluateHandle(() => new DataTransfer());

      // Coordinates matter: the edge is chosen from which half of the target
      // the pointer is in, and a bare dispatch leaves clientY at 0 - which is
      // ABOVE the card when the lane is scrolled, so it read as the bottom edge.
      const box = await target.boundingBox();
      await source.dispatchEvent('dragstart', { dataTransfer: data });
      await target.dispatchEvent('dragover', {
        dataTransfer: data,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height * 0.2,
      });
      await settle(250);

      const marked = await page.evaluate(() => {
        const el = document.querySelector('.kanban-card-drop');
        if (!el) return null;
        const line = getComputedStyle(el, '::before');
        return {
          title: el.querySelector('.kanban-card-title')?.textContent.trim(),
          height: line.height,
          colour: line.backgroundColor,
          edge: el.classList.contains('kanban-card-drop-bottom') ? 'bottom' : 'top',
          hasLine: line.content !== 'none',
        };
      });

      assert(marked, 'nothing was marked as the drop point');
      assert(marked.title === before[0], `marked "${marked.title}", expected "${before[0]}"`);
      assert(marked.hasLine, 'the indicator draws no line');
      assert(marked.edge === 'top', `indicator on the ${marked.edge} edge, expected top`);
      // It was reported as "just a grey line" - the 8px gap between cards reads
      // as one, so the indicator has to be visibly the accent colour.
      const rgb = (marked.colour.match(/\d+/g) ?? []).map(Number);
      assert(rgb.length >= 3, `no colour on the indicator: ${marked.colour}`);
      assert(
        rgb[2] > rgb[0] + 40,
        `indicator is not accent-coloured (${marked.colour}) - reads as the grey gap`,
      );

      // Only one at a time, or it says nothing about where the card lands.
      const count = await page.evaluate(
        () => document.querySelectorAll('.kanban-card-drop').length,
      );
      assert(count === 1, `${count} cards marked at once`);

      await target.dispatchEvent('dragleave', { dataTransfer: data });
      await source.dispatchEvent('dragend', { dataTransfer: data });
      await settle(300);

      const cleared = await page.evaluate(
        () => document.querySelectorAll('.kanban-card-drop').length,
      );
      assert(cleared === 0, `indicator stayed up on ${cleared} cards after the drag ended`);

      await Promise.all([source.dispose(), target.dispose(), data.dispose()]);
      return `line above "${marked.title}", ${marked.height} tall, cleared after`;
    });

    await check('the indicator above the FIRST card is not clipped', async () => {
      /*
       * The case the generic indicator check misses.
       *
       * The line sits above its card, and the lane scrolls - so on every card
       * but the first there is a neighbour's gap to draw into, while on the
       * first there is only the container edge. With too little padding the
       * overflow clipped it, and dropping at the very top of a lane gave no
       * feedback at all while working perfectly.
       */
      const titles = await laneTitles();
      const first = savedCard(titles[0]);

      await page.evaluate(() => {
        document.querySelector('.kanban-col-saved .kanban-cards').scrollTop = 0;
      });

      const source = await savedCard(titles[2]).elementHandle();
      const target = await first.elementHandle();
      const data = await page.evaluateHandle(() => new DataTransfer());
      const box = await target.boundingBox();

      await source.dispatchEvent('dragstart', { dataTransfer: data });
      await target.dispatchEvent('dragover', {
        dataTransfer: data,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height * 0.2,
      });
      await settle(250);

      const visible = await page.evaluate(() => {
        const el = document.querySelector('.kanban-card-drop');
        if (!el) return null;
        const cards = document.querySelector('.kanban-col-saved .kanban-cards');
        const lane = cards.getBoundingClientRect();
        const card = el.getBoundingClientRect();
        const line = getComputedStyle(el, '::before');
        // Where the line actually lands: 6px above the card, 3px tall.
        const lineTop = card.top - 6;
        return {
          lineTop: Math.round(lineTop),
          laneTop: Math.round(lane.top),
          clearance: Math.round(lineTop - lane.top),
          height: line.height,
        };
      });

      await source.dispatchEvent('dragend', { dataTransfer: data });
      await settle(250);
      await Promise.all([source.dispose(), target.dispose(), data.dispose()]);

      assert(visible, 'nothing was marked as the drop point');
      assert(
        visible.clearance >= 0,
        `the line starts ${-visible.clearance}px above the scroll box and is clipped`,
      );
      return `${visible.clearance}px clear of the lane's top edge`;
    });

    await check('the new order is persisted, not just painted', async () => {
      /*
       * Wait for the write to land before reloading.
       *
       * setCardOrder is async, and the checks above finish the moment the board
       * repaints - so reloading straight away could read the store mid-write
       * and show the previous order. That failed roughly one run in two and
       * looked like broken persistence rather than a race in the test.
       */
      const readOrder = () =>
        page.evaluate(
          async (key) => (await chrome.storage.local.get(key))[key]?.cardOrder?.saved ?? null,
          CONFIG_KEY,
        );

      let stored = await readOrder();
      for (let i = 0; i < 10; i += 1) {
        await settle(300);
        const again = await readOrder();
        if (JSON.stringify(again) === JSON.stringify(stored)) break;
        stored = again;
      }
      assert(Array.isArray(stored), 'no saved cardOrder for the lane');
      assert(stored.length > 0, 'cardOrder saved empty');

      const onScreen = await laneTitles();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.kanban-col-saved .kanban-card', { timeout: 15_000 });
      await settle(900);
      await page.selectOption('select[aria-label="Sort jobs"]', 'manual');
      await settle(700);

      const afterReload = await laneTitles();
      assert(
        afterReload[0] === onScreen[0],
        `order did not survive a reload: "${onScreen[0]}" became "${afterReload[0]}"`,
      );
      return `${stored.length} keys, order survives a reload`;
    });

    await check('dragging a card to another lane still changes its status', async () => {
      const before = await laneTitles();
      const moving = before[0];

      const applied = page
        .locator('.kanban-col')
        .filter({ has: page.locator('.kanban-title', { hasText: 'Applied' }) })
        .first();

      await dragOnto(savedCard(moving), applied);
      await settle(1000);

      const inApplied = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('.kanban-col')).find(
            (l) => l.querySelector('.kanban-title')?.textContent.trim() === 'Applied',
          )?.querySelectorAll('.kanban-card').length ?? 0,
      );
      assert(inApplied > 0, 'nothing landed in Applied');

      const saved = await laneTitles();
      assert(!saved.includes(moving), `"${moving}" is still in Saved`);
      return `"${moving}" moved to Applied`;
    });

    await check('a card dropped onto a card in ANOTHER lane lands at that spot', async () => {
      // The gesture that did nothing before: aiming at a card rather than at
      // the lane's empty space stopped the event and refused the move.
      const before = await laneTitles();
      const moving = before[1];

      const target = page
        .locator('.kanban-col')
        .filter({ has: page.locator('.kanban-title', { hasText: 'Preparing' }) })
        .locator('.kanban-card')
        .first();

      if ((await target.count()) === 0) {
        // Seed one card in Preparing so there is something to aim at.
        const lane = page
          .locator('.kanban-col')
          .filter({ has: page.locator('.kanban-title', { hasText: 'Preparing' }) })
          .first();
        await dragOnto(savedCard(before[0]), lane);
        await settle(900);
      }

      await dragOnto(savedCard(moving), target, 'top');
      await settle(1000);

      const inPreparing = await page.evaluate(() =>
        Array.from(
          document
            .querySelectorAll('.kanban-col')
            [Array.from(document.querySelectorAll('.kanban-col')).findIndex(
              (l) => l.querySelector('.kanban-title')?.textContent.trim() === 'Preparing',
            )]?.querySelectorAll('.kanban-card-title') ?? [],
          (a) => a.textContent.trim(),
        ),
      );

      assert(inPreparing.includes(moving), `"${moving}" did not reach Preparing`);
      const saved = await laneTitles();
      assert(!saved.includes(moving), `"${moving}" is still in Saved`);
      return `"${moving}" -> Preparing at position ${inPreparing.indexOf(moving) + 1}`;
    });

    await check('the dragged card stays legible rather than fading out', async () => {
      const titles = await laneTitles();
      const source = await savedCard(titles[0]).elementHandle();
      const data = await page.evaluateHandle(() => new DataTransfer());

      await source.dispatchEvent('dragstart', { dataTransfer: data });
      await settle(250);

      const look = await page.evaluate(() => {
        const el = document.querySelector('.kanban-card-dragging');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { opacity: Number(cs.opacity), outlineWidth: cs.outlineWidth };
      });

      await source.dispatchEvent('dragend', { dataTransfer: data });
      await settle(250);

      assert(look, 'the dragged card was not marked');
      assert(look.opacity >= 0.95, `dragged card faded to ${look.opacity}`);
      assert(parseFloat(look.outlineWidth) >= 1, `no outline: ${look.outlineWidth}`);

      const cleared = await page.evaluate(
        () => document.querySelectorAll('.kanban-card-dragging').length,
      );
      assert(cleared === 0, 'the drag styling stayed after dragend');

      await Promise.all([source.dispose(), data.dispose()]);
      return `opacity ${look.opacity}, ${look.outlineWidth} outline`;
    });

    await check('each lane count matches what is in it', async () => {
      const counts = await page.$$eval('.kanban-col', (els) =>
        els.map((lane) => ({
          label: lane.querySelector('.kanban-title')?.textContent.trim(),
          badge: Number(lane.querySelector('.kanban-count')?.textContent ?? -1),
          cards: lane.querySelectorAll('.kanban-card').length,
        })),
      );
      for (const lane of counts) {
        assert(lane.badge === lane.cards, `${lane.label}: badge ${lane.badge}, ${lane.cards} cards`);
      }
      return counts
        .filter((c) => c.cards > 0)
        .map((c) => `${c.label} ${c.cards}`)
        .join(' · ');
    });

    await check('search narrows the board', async () => {
      const search = page.locator('input[placeholder*="Search"]').first();
      assert(await search.count(), 'no board search box');

      const before = await page.evaluate(() => document.querySelectorAll('.kanban-card').length);
      await search.fill('E2E job 07');
      await settle(800);
      const after = await page.evaluate(() => document.querySelectorAll('.kanban-card').length);

      await search.fill('');
      await settle(600);

      assert(after < before, `search did not narrow: ${before} -> ${after}`);
      assert(after > 0, 'search hid everything, including the match');
      return `${before} -> ${after} cards`;
    });

    /* ---- bulk actions -------------------------------------------------- */

    await check('a card can be picked without dragging it', async () => {
      const box = page.locator('.kanban-col-saved .kanban-card .kanban-card-pick').first();
      assert(await box.count(), 'no selection checkbox on a card');

      // Hidden at rest on purpose - a checkbox on every card turns a board
      // into a form - so click through the hover state rather than asserting
      // visibility.
      await box.click({ force: true });
      await settle(300);

      const state = await page.evaluate(() => ({
        selected: document.querySelectorAll('.kanban-card-selected').length,
        bar: Boolean(document.querySelector('.kanban-bulk')),
        selecting: Boolean(document.querySelector('.kanban.is-selecting')),
      }));
      assert(state.selected === 1, `${state.selected} cards selected after one click`);
      assert(state.bar, 'no bulk action bar appeared');
      assert(state.selecting, 'the board did not enter selecting mode');
      return 'one card, bar shown';
    });

    await check('select-all takes every card that is shown', async () => {
      await page.click('.kanban-bulk-btn');
      await settle(400);

      const counted = await page.evaluate(() => ({
        selected: document.querySelectorAll('.kanban-card-selected').length,
        onBoard: document.querySelectorAll('.kanban-card').length,
      }));
      assert(
        counted.selected === counted.onBoard,
        `selected ${counted.selected} of ${counted.onBoard} shown`,
      );
      return `${counted.selected} cards`;
    });

    await check('clear puts the selection down without touching the cards', async () => {
      const before = await page.evaluate(() => document.querySelectorAll('.kanban-card').length);

      await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('.kanban-bulk-btn')];
        buttons.find((b) => b.textContent.trim() === 'Clear')?.click();
      });
      await settle(400);

      const after = await page.evaluate(() => ({
        selected: document.querySelectorAll('.kanban-card-selected').length,
        bar: Boolean(document.querySelector('.kanban-bulk')),
        cards: document.querySelectorAll('.kanban-card').length,
      }));
      assert(after.selected === 0, `${after.selected} still selected after Clear`);
      assert(!after.bar, 'the bulk bar stayed up with nothing selected');
      // The check that matters: Clear is not Remove.
      assert(after.cards === before, `Clear changed the board: ${before} -> ${after.cards}`);
      return `${before} cards untouched`;
    });

    await check('moving several cards at once lands them all in one lane', async () => {
      const boxes = page.locator('.kanban-col-saved .kanban-card .kanban-card-pick');
      for (let i = 0; i < 3; i += 1) await boxes.nth(i).click({ force: true });
      await settle(300);

      const before = await page.evaluate(
        () => document.querySelectorAll('.kanban-col-saved .kanban-card').length,
      );

      await page.selectOption('.kanban-bulk-move select', 'applied');
      await settle(900);

      const after = await page.evaluate(() => ({
        saved: document.querySelectorAll('.kanban-col-saved .kanban-card').length,
        selected: document.querySelectorAll('.kanban-card-selected').length,
        bar: Boolean(document.querySelector('.kanban-bulk')),
      }));

      assert(
        after.saved === before - 3,
        `Saved went ${before} -> ${after.saved}, expected ${before - 3}`,
      );
      // Crossing between the saved store and the applications store is two
      // writes; leaving the selection up would invite a second, duplicate move.
      assert(after.selected === 0, 'the selection survived the move');
      assert(!after.bar, 'the bulk bar stayed up after moving');

      // Put them back, so the later restore has the shape it expects.
      const moved = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll('.kanban-col:not(.kanban-col-saved) .kanban-card'),
        ).length,
      );
      return `3 moved, ${moved} now outside Saved`;
    });

    /* ---- interview prep ------------------------------------------------ */

    await check('an application carries interview prep, and a template to start it', async () => {
      // Prep belongs to applications, not saved jobs, so this runs on a card
      // the previous check moved into Applied.
      const card = page.locator('.kanban-col:not(.kanban-col-saved) .kanban-card').first();
      assert(await card.count(), 'no application card to open');

      await card.locator('.kanban-kebab').first().click();
      await settle(300);
      await page.locator('.kanban-menu-item', { hasText: 'Edit details' }).first().click();
      await page.waitForSelector('.kanban-card-editor', { timeout: 10_000 });
      await settle(400);

      const prep = page.locator('.kanban-prep');
      assert(await prep.count(), 'no interview prep box on an application card');

      await page.locator('button', { hasText: 'Start from a template' }).first().click();
      await settle(300);

      const filled = await prep.inputValue();
      assert(filled.includes('Ask them'), 'the template did not fill the box');
      assert(filled.includes('- [ ]'), 'the template has no checklist lines');

      // The checklist parser is shared with the description note; prep gets it
      // for free, which is the whole reason the template uses `- [ ]`.
      const ticks = await page.evaluate(
        () => document.querySelectorAll('.kanban-card-editor .note-checklist input').length,
      );
      assert(ticks > 0, 'the template lines did not render as a checklist');

      await page.keyboard.press('Escape');
      await settle(400);
      return `${filled.split(/\r?\n/).length} lines, ${ticks} checkboxes`;
    });
  } finally {
    await restore();
    await settle(400);
    console.log('\n  (seeded jobs removed, board config restored)');
  }

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

  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nE2E run could not start:', error.message);
  process.exit(2);
});
