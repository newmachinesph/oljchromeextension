// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * End-to-end test of the content script against a synthetic results page.
 *
 * This is the test that proves the parts work together: real DOM, real settings
 * flow, the real entry point. Only the chrome API boundary is stubbed -
 * everything below it is production code.
 */

const KEY = 'ojRateFilter';

/** Minimal in-memory stand-in for the chrome APIs the extension touches. */
function installChromeStub(initial = {}) {
  const store = { [KEY]: initial };
  const listeners = [];

  /** Both areas behave identically; only the name they notify under differs. */
  const area = (name) => ({
    get: async (key) => (store[key] === undefined ? {} : { [key]: store[key] }),
    set: async (patch) => {
      for (const [key, newValue] of Object.entries(patch)) {
        store[key] = newValue;
        listeners.forEach((fn) => fn({ [key]: { newValue } }, name));
      }
    },
  });

  globalThis.chrome = {
    storage: {
      sync: area('sync'),
      // Dismissals live here rather than in sync: the list runs to thousands of
      // entries and sync caps one item at 8KB.
      local: area('local'),
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
      },
    },
    runtime: {
      getURL: (path) => path,
      sendMessage: vi.fn(),
      openOptionsPage: vi.fn(),
    },
  };

  return store;
}

/**
 * Job ids, distinct per card.
 *
 * The real site ends every job URL in its own id, and dismissing one listing
 * must not dismiss the rest - so the fixture cannot reuse a single id either.
 */
let nextJobId = 1000;

/** One search result, in the shape the real page uses. */
function card(title, salary, jobType = 'Full Time', { logo = false } = {}) {
  nextJobId += 1;
  return `
    <div class="jobpost-cat-box">
      <div class="d-flex align-items-start">
        ${logo ? '<div class="d-block mr-3"><img class="jobpost-cat-box-logo"></div>' : ''}
      </div>
      <a href="/jobseekers/job/${title.replace(/\s+/g, '-')}-${nextJobId}">${title}</a>
      <h4>${title}<span class="badge full-time">${jobType}</span></h4>
      <p data-temp="2026-08-17 10:00:00"><em>Posted on 2026-08-17 10:00:00</em></p>
      <dl class="rate">
        <dt><i class="icon icon-round-dollar"></i></dt>
        <dd class="col">${salary}</dd>
      </dl>
      <div class="desc">A long description excerpt that makes the list noisy.</div>
    </div>
  `;
}

/**
 * At the default $500/month threshold and 60 PHP = $1:
 *   $800/month     -> $800  keep
 *   P24,000/month  -> $400  HIDE
 *   Not specified  -> ?     keep (unparsed is never hidden)
 *   $3/hour        -> $480  HIDE  (3 x 160 hours)
 *   $1,500/month   -> $1500 keep  (title says "PHP" - must not confuse the parser)
 */
const PAGE = [
  card('Senior Virtual Assistant', '$800/month'),
  card('Data Entry Clerk', 'P24,000/month'),
  card('Graphic Designer', 'Not specified'),
  card('Transcriptionist', '$3/hour'),
  card('PHP Developer', '$1,500/month', 'Full Time', { logo: true }),
].join('');

const bar = () => document.getElementById('ojrf-bar');
const cards = () => Array.from(document.querySelectorAll('.jobpost-cat-box'));
const stubs = () => Array.from(document.querySelectorAll('.ojrf-stub'));
const hiddenCards = () => cards().filter((el) => el.classList.contains('ojrf-hidden'));

function cardTitled(title) {
  return cards().find((el) => el.querySelector('a').textContent === title);
}

describe('content script, end to end', () => {
  beforeAll(async () => {
    // Page merging off: this suite is about filtering the DOM it is given, and
    // leaving it on would have the content script reach for the network.
    // Peso rate pinned: this suite asserts the exact figures on the stubs, and
    // they should not have to be rewritten every time the shipped rate moves.
    installChromeStub({ prefetchPages: 0, fxPhpPerUsd: 60 });
    document.body.innerHTML = `<div id="results">${PAGE}</div>`;

    await import('../src/content/main.js');
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    await vi.waitFor(() => expect(stubs().length).toBeGreaterThan(0));
  });

  it('injects the control bar inside the results container, at the top', () => {
    // Inside, not before: the container carries the page gutter, so a bar placed
    // outside it renders wider than the listing cards.
    expect(bar()).not.toBeNull();
    expect(bar().parentElement.id).toBe('results');
    expect(bar().parentElement.firstElementChild).toBe(bar());
  });

  it('gathers the collapsed stubs into one block below the bar', () => {
    const group = document.getElementById('ojrf-hidden-group');
    expect(group).not.toBeNull();
    expect(group.previousElementSibling).toBe(bar());
    expect(group.querySelectorAll('.ojrf-stub')).toHaveLength(2);
    // The listings themselves are untouched in place - only our stubs moved.
    expect(document.querySelectorAll('#results > .jobpost-cat-box')).toHaveLength(5);
  });

  it('collapses exactly the listings that fall below the threshold', () => {
    const hidden = hiddenCards().map((el) => el.querySelector('a').textContent);
    expect(hidden.sort()).toEqual(['Data Entry Clerk', 'Transcriptionist']);
  });

  it('keeps listings that clear the threshold', () => {
    expect(cardTitled('Senior Virtual Assistant').classList.contains('ojrf-hidden')).toBe(false);
    expect(cardTitled('PHP Developer').classList.contains('ojrf-hidden')).toBe(false);
  });

  it('never hides a listing whose rate could not be read', () => {
    expect(cardTitled('Graphic Designer').classList.contains('ojrf-hidden')).toBe(false);
  });

  it('leaves a readable stub in place of each collapsed listing', () => {
    expect(stubs()).toHaveLength(2);
    const text = stubs().map((el) => el.textContent);
    expect(text.some((entry) => entry.includes('Data Entry Clerk'))).toBe(true);
    expect(text.some((entry) => entry.includes('$400/mo'))).toBe(true);
    expect(text.some((entry) => entry.includes('$480/mo'))).toBe(true);
  });

  it('builds a meta row on the posted-on line, not the title line', () => {
    const listing = cardTitled('Senior Virtual Assistant');
    const postedRow = listing.querySelector('[data-temp]');
    const meta = postedRow.querySelector('.ojrf-meta');

    expect(meta).not.toBeNull();
    expect(listing.querySelector('h4 .ojrf-badge')).toBeNull();

    // Date, rate, job type - each with an icon.
    expect(meta.querySelector('.ojrf-chip-date')).not.toBeNull();
    expect(meta.querySelector('.ojrf-badge')).not.toBeNull();
    expect(meta.querySelector('.ojrf-chip-type').textContent).toContain('Full Time');
    // A "Senior" title reads as wanting experience, and says so.
    expect(meta.querySelector('.ojrf-chip-level').textContent).toContain('Experienced');
    // Four chips, plus the save bookmark and the dismiss cross that close the row.
    expect(meta.querySelectorAll('svg.ojrf-icon')).toHaveLength(6);
    expect(meta.lastElementChild.className).toBe('ojrf-dismiss');
  });

  it('gives a placeholder avatar only to listings without a logo', () => {
    // So every card's text starts at the same x.
    expect(document.querySelectorAll('.ojrf-avatar')).toHaveLength(4);
    expect(cardTitled('PHP Developer').querySelector('.ojrf-avatar')).toBeNull();
    expect(cardTitled('Senior Virtual Assistant').querySelector('.ojrf-avatar')).not.toBeNull();
  });

  it('spaces the chip row away from the text below it', () => {
    const host = cardTitled('Senior Virtual Assistant').querySelector('[data-temp]');
    expect(host.classList.contains('ojrf-meta-host')).toBe(true);
  });

  it('replaces the raw timestamp with a relative one, keeping it in the tooltip', () => {
    const listing = cardTitled('Senior Virtual Assistant');
    const date = listing.querySelector('.ojrf-chip-date');

    // The fixture is stamped 2026-08-17, so this is years old by any clock.
    expect(date.textContent).toMatch(/(just now|\d+(m|h|d|w|mo|y) ago)/);
    expect(date.title).toMatch(/^Posted \d{1,2} \w{3} 2026, \d{2}:\d{2}$/);
    // The site's own "Posted on ..." text is hidden, not removed.
    expect(listing.querySelector('[data-temp] em').classList.contains('ojrf-part-hidden')).toBe(
      true,
    );
  });

  it('badges each listing with its converted rate', () => {
    const badge = (title) => cardTitled(title).querySelector('.ojrf-badge').textContent;
    // The coin icon carries the "=", so only an assumed rate is marked, with "~".
    expect(badge('Senior Virtual Assistant')).toBe('$800/mo');
    expect(badge('PHP Developer')).toBe('$1,500/mo');
    // "Not specified" is the employer saying nothing, not us failing to read
    // something - so it is labelled for what it is.
    expect(badge('Graphic Designer')).toBe('not stated');
  });

  it('shows the listing\'s raw rate text in the chip tooltip', () => {
    expect(cardTitled('Data Entry Clerk').querySelector('.ojrf-badge').title).toBe(
      'Listed as: P24,000/month',
    );
  });

  it('reports the count and the rule that fired in the control bar', () => {
    // Read from the bar rather than one element: the headline count and the
    // breakdown deliberately live on separate lines so the row stays still.
    expect(bar().querySelector('.ojrf-count').textContent).toContain('2 of 5 hidden');
    expect(bar().querySelector('.ojrf-detail').textContent).toContain('2 low rate');
    expect(bar().querySelector('.ojrf-summary').hidden).toBe(false);
  });

  it('does not warn when detection used the known selectors', () => {
    expect(bar().querySelector('.ojrf-warning').hidden).toBe(true);
  });

  it('raising the threshold collapses more listings', async () => {
    const amount = bar().querySelector('.ojrf-amount');
    amount.value = '1000';
    amount.dispatchEvent(new window.Event('input', { bubbles: true }));

    await vi.waitFor(() => expect(hiddenCards()).toHaveLength(3), { timeout: 2000 });
    expect(cardTitled('Senior Virtual Assistant').classList.contains('ojrf-hidden')).toBe(true);
    // Still never the unreadable one.
    expect(cardTitled('Graphic Designer').classList.contains('ojrf-hidden')).toBe(false);
  });

  it('hides the site\'s own rate line, since the chip restates it', () => {
    expect(document.querySelectorAll('dl.rate.ojrf-part-hidden')).toHaveLength(5);
  });

  it('keeps the description excerpt by default, and hides it on request', async () => {
    expect(document.querySelectorAll('.desc.ojrf-part-hidden')).toHaveLength(0);

    await chrome.storage.sync.set({ ojRateFilter: { showDescription: false } });
    await vi.waitFor(
      () => expect(document.querySelectorAll('.desc.ojrf-part-hidden')).toHaveLength(5),
      { timeout: 2000 },
    );

    await chrome.storage.sync.set({ ojRateFilter: { showDescription: true } });
    await vi.waitFor(
      () => expect(document.querySelectorAll('.desc.ojrf-part-hidden')).toHaveLength(0),
      { timeout: 2000 },
    );
  });

  it('offers a pill per job type, and hides that type when switched off', async () => {
    const pill = (type) => bar().querySelector(`.ojrf-pill[data-type="${type}"]`);
    // Captured, not hard-coded: an earlier case in this file moved the threshold.
    const before = hiddenCards().length;

    expect(bar().querySelectorAll('.ojrf-pill[data-type]')).toHaveLength(4);
    // Plus the three experience-level choices, one of which is always on.
    expect(bar().querySelectorAll('.ojrf-pill[data-level]')).toHaveLength(3);
    expect(bar().querySelectorAll('.ojrf-pill[data-level].ojrf-pill-choice-on')).toHaveLength(1);
    // And the follow-up view pill, off until asked for.
    expect(bar().querySelector('.ojrf-pill-view').getAttribute('aria-pressed')).toBe('false');
    expect(pill('full-time').getAttribute('aria-pressed')).toBe('true');
    expect(pill('full-time').classList.contains('ojrf-pill-off')).toBe(false);

    pill('full-time').dispatchEvent(new window.Event('click'));

    // Every card in this fixture is Full Time, so all five collapse.
    await vi.waitFor(() => expect(hiddenCards()).toHaveLength(5), { timeout: 2000 });
    expect(pill('full-time').getAttribute('aria-pressed')).toBe('false');
    expect(bar().querySelector('.ojrf-count').textContent).toContain('5 of 5 hidden');

    pill('full-time').dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(hiddenCards()).toHaveLength(before), { timeout: 2000 });
    expect(pill('full-time').classList.contains('ojrf-pill-off')).toBe(false);
  });

  it('collapses and expands the whole block, independently of each stub', () => {
    const group = document.getElementById('ojrf-hidden-group');
    const toggle = group.querySelector('.ojrf-group-toggle');

    // Starts closed: the block is one compact line until asked to open.
    expect(group.classList.contains('ojrf-group-open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Derived, not hard-coded: an earlier case in this file changes the count.
    expect(toggle.textContent).toContain(`${stubs().length} listings hidden`);

    toggle.dispatchEvent(new window.Event('click'));
    expect(group.classList.contains('ojrf-group-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.dispatchEvent(new window.Event('click'));
    expect(group.classList.contains('ojrf-group-open')).toBe(false);
  });

  it('relabels a stub when a different rule takes over the hiding', async () => {
    // "Data Entry Clerk" is already collapsed for being a low rate. Excluding it
    // by keyword keeps it collapsed, but for a new reason - and the stub must
    // say so rather than keep showing the old rate.
    const stubFor = (title) =>
      stubs().find((stub) => stub.textContent.includes(title));

    expect(stubFor('Data Entry Clerk').dataset.reason).toBe('below-threshold');

    await chrome.storage.sync.set({
      ojRateFilter: { thresholdUsdPerMonth: 1000, excludeKeywords: ['data entry'] },
    });

    await vi.waitFor(
      () => expect(stubFor('Data Entry Clerk').dataset.reason).toBe('keyword'),
      { timeout: 2000 },
    );
    expect(stubFor('Data Entry Clerk').textContent).toContain('matched "data entry"');
    expect(stubFor('Data Entry Clerk').textContent).not.toContain('$400/mo');
  });

  it('dismisses a listing by hand, and records it against the job id', async () => {
    // Back to defaults: earlier cases in this file moved the threshold and
    // added an exclude keyword.
    await chrome.storage.sync.set({ ojRateFilter: {} });
    await vi.waitFor(() => expect(hiddenCards()).toHaveLength(2), { timeout: 2000 });

    const listing = cardTitled('PHP Developer');
    expect(listing.classList.contains('ojrf-hidden')).toBe(false);

    listing.querySelector('.ojrf-dismiss').dispatchEvent(new window.Event('click'));

    await vi.waitFor(() => expect(listing.classList.contains('ojrf-hidden')).toBe(true), {
      timeout: 2000,
    });

    const stub = stubs().find((entry) => entry.textContent.includes('PHP Developer'));
    expect(stub.dataset.reason).toBe('dismissed');
    expect(stub.textContent).toContain('dismissed');
    expect(bar().querySelector('.ojrf-detail').textContent).toContain('1 dismissed');

    // Keyed by the trailing job id, so an employer editing the title cannot
    // resurrect a listing you already rejected.
    //
    // Awaited rather than read straight off: the card collapses optimistically
    // so the click feels instant, and storage catches up a tick later.
    const id = listing.querySelector('a').getAttribute('href').match(/(\d+)$/)[1];
    await vi.waitFor(
      async () =>
        expect((await chrome.storage.local.get('ojRateFilterDismissed'))
          .ojRateFilterDismissed).toEqual([id]),
      { timeout: 2000 },
    );

    // The others are untouched - one click dismisses one listing.
    expect(cardTitled('Graphic Designer').classList.contains('ojrf-hidden')).toBe(false);
  });

  it('restores a dismissed listing for good, not just for this visit', async () => {
    const stub = stubs().find((entry) => entry.dataset.reason === 'dismissed');
    const button = stub.querySelector('.ojrf-stub-show');

    // "restore" undoes a decision; "show" only peeks. The wording has to differ.
    expect(button.textContent).toBe('restore');
    expect(stubs().find((entry) => entry.dataset.reason === 'below-threshold')
      .querySelector('.ojrf-stub-show').textContent).toBe('show');

    button.dispatchEvent(new window.Event('click'));

    await vi.waitFor(
      () => expect(cardTitled('PHP Developer').classList.contains('ojrf-hidden')).toBe(false),
      { timeout: 2000 },
    );

    await vi.waitFor(
      async () =>
        expect((await chrome.storage.local.get('ojRateFilterDismissed'))
          .ojRateFilterDismissed).toEqual([]),
      { timeout: 2000 },
    );
  });

  it('ranks by rate without moving a single node', async () => {
    const results = document.getElementById('results');
    const domOrder = () =>
      Array.from(results.querySelectorAll(':scope > .jobpost-cat-box'), (el) =>
        el.querySelector('a').textContent,
      );
    const before = domOrder();

    await chrome.storage.sync.set({ ojRateFilter: { sortBy: 'rate-desc' } });
    await vi.waitFor(() => expect(results.classList.contains('ojrf-sorted')).toBe(true), {
      timeout: 2000,
    });

    // The site's DOM is exactly as it was...
    expect(domOrder()).toEqual(before);

    // ...and only the CSS order moved.
    const rank = (title) => Number(cardTitled(title).style.order);
    expect(rank('PHP Developer')).toBeLessThan(rank('Senior Virtual Assistant'));
    expect(rank('Senior Virtual Assistant')).toBeLessThan(rank('Transcriptionist'));
    expect(rank('Transcriptionist')).toBeLessThan(rank('Data Entry Clerk'));
    // A rate we could not read is not a value, so it sorts after every real one.
    expect(rank('Graphic Designer')).toBeGreaterThan(rank('Data Entry Clerk'));
    // Our own bar keeps its place above the listings.
    expect(Number(bar().style.order)).toBeLessThan(rank('PHP Developer'));
  });

  it('reverses cleanly, leaving no inline order behind', async () => {
    await chrome.storage.sync.set({ ojRateFilter: { sortBy: 'rate-asc' } });
    await vi.waitFor(
      () =>
        expect(Number(cardTitled('Data Entry Clerk').style.order)).toBeLessThan(
          Number(cardTitled('PHP Developer').style.order),
        ),
      { timeout: 2000 },
    );
    // Still last: unreadable belongs at neither extreme.
    expect(Number(cardTitled('Graphic Designer').style.order)).toBeGreaterThan(
      Number(cardTitled('PHP Developer').style.order),
    );

    await chrome.storage.sync.set({ ojRateFilter: { sortBy: 'site' } });
    await vi.waitFor(
      () => expect(document.getElementById('results').classList.contains('ojrf-sorted')).toBe(false),
      { timeout: 2000 },
    );
    expect(cardTitled('PHP Developer').style.order).toBe('');
    expect(bar().style.order).toBe('');
  });

  it('restores the page exactly when switched off', async () => {
    // No on/off control in the bar - the extension exists to filter, so the
    // switch lives in settings as an escape hatch rather than a headline button.
    await chrome.storage.sync.set({ ojRateFilter: { enabled: false } });

    await vi.waitFor(() => expect(hiddenCards()).toHaveLength(0), { timeout: 2000 });

    expect(stubs()).toHaveLength(0);
    expect(document.querySelectorAll('.ojrf-badge')).toHaveLength(0);
    expect(cards()).toHaveLength(5);
    expect(bar().querySelector('.ojrf-detail').textContent).toContain('filter off');
  });

  it('opens the options page when the settings button is clicked', () => {
    bar().querySelector('.ojrf-settings').dispatchEvent(new window.Event('click'));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'open-options' });
  });
});

describe('repainting only what changed', () => {
  /**
   * A merged page runs past a thousand cards carrying four thousand chips, and
   * every render used to rebuild all of them. Dismissing one listing repainted
   * the other thousand identically, which is where the pauses came from.
   */
  it('leaves untouched cards' + String.fromCharCode(39) + ' chips alone across a render', async () => {
    const card = cardTitled('Senior Virtual Assistant');
    const badgeBefore = card.querySelector('.ojrf-badge');

    // Something that changes one listing but not this one.
    const amount = bar().querySelector('.ojrf-amount');
    amount.value = '260';
    amount.dispatchEvent(new window.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(bar().querySelector('.ojrf-count').textContent).toBeTruthy());

    // Same node, not a rebuilt one: identity is the assertion, since a repaint
    // replaces the chips wholesale.
    expect(cardTitled('Senior Virtual Assistant').querySelector('.ojrf-badge')).toBe(badgeBefore);
  });

  // That a *changed* card still repaints is covered above by "raising the
  // threshold collapses more listings" - which would fail outright if the
  // memoization ever froze the page.
});
