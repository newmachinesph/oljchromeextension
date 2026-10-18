// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  findCountLine,
  readSiteTotal,
  countText,
  updateResultCount,
  restoreResultCount,
  dockSummary,
  undockSummary,
} from '../src/content/result-count.js';
import { createControlBar } from '../src/content/control-bar.js';

/**
 * The live wording, whitespace and all - the site renders the number and the
 * word "jobs" on separate lines with a run of indentation between them.
 */
const ORIGINAL = 'Displaying 30 out of 299                  jobs';

beforeEach(() => {
  document.body.innerHTML = `
    <div class="results">
      <div class="row"><div class="col-8">
        <p class="fs-12">${ORIGINAL}</p>
      </div></div>
      <div class="jobpost-cat-box">a listing</div>
    </div>`;
});

const line = () => document.querySelector('.results p');

describe('findCountLine', () => {
  it('finds the count by its wording', () => {
    expect(findCountLine(document)).toBe(line());
  });

  it('is not fooled by another paragraph in the results', () => {
    document.body.innerHTML = '<div class="results"><p class="fs-12">Save this search</p></div>';
    expect(findCountLine(document)).toBeNull();
  });

  it('returns null on a page without one', () => {
    document.body.innerHTML = '<div class="results"></div>';
    expect(findCountLine(document)).toBeNull();
  });
});

describe('readSiteTotal', () => {
  it('reads the total the site claimed', () => {
    expect(readSiteTotal(ORIGINAL)).toBe(299);
  });

  it('copes with a thousands separator', () => {
    expect(readSiteTotal('Displaying 30 out of 1,240 jobs')).toBe(1240);
  });

  it('returns null for anything else', () => {
    expect(readSiteTotal('Save this search')).toBeNull();
    expect(readSiteTotal(null)).toBeNull();
  });
});

describe('countText', () => {
  it('states what is showing, what is loaded, and what the site claims', () => {
    expect(countText({ loaded: 307, hidden: 199, siteTotal: 299 })).toBe(
      'Showing 108 of 307 loaded · 299 on the site',
    );
  });

  it('drops the "showing" half when nothing is hidden', () => {
    expect(countText({ loaded: 307, hidden: 0, siteTotal: 299 })).toBe(
      '307 loaded · 299 on the site',
    );
  });

  it('omits the site total when the page never gave one', () => {
    expect(countText({ loaded: 30, hidden: 4, siteTotal: null })).toBe('Showing 26 of 30 loaded');
  });

  it('groups thousands, since a merged list runs long', () => {
    expect(countText({ loaded: 1500, hidden: 300, siteTotal: 2400 })).toBe(
      'Showing 1,200 of 1,500 loaded · 2,400 on the site',
    );
  });

  it('never reports a negative number of listings', () => {
    expect(countText({ loaded: 5, hidden: 9, siteTotal: null })).toBe('Showing 0 of 5 loaded');
  });
});

describe('updateResultCount', () => {
  it('replaces the stale count with the real one', () => {
    expect(updateResultCount({ loaded: 307, hidden: 199 }, document)).toBe(
      'Showing 108 of 307 loaded · 299 on the site',
    );
    expect(line().textContent).toBe('Showing 108 of 307 loaded · 299 on the site');
  });

  it('keeps the site total across repeated passes', () => {
    // The second pass can no longer read "out of 299" off the page, so the
    // original has to have been stashed rather than re-read.
    updateResultCount({ loaded: 307, hidden: 199 }, document);
    updateResultCount({ loaded: 307, hidden: 12 }, document);

    expect(line().textContent).toBe('Showing 295 of 307 loaded · 299 on the site');
  });

  it('never records its own text as the original', () => {
    updateResultCount({ loaded: 307, hidden: 199 }, document);
    updateResultCount({ loaded: 307, hidden: 199 }, document);

    restoreResultCount(document);
    expect(line().textContent).toBe('Displaying 30 out of 299 jobs');
  });

  it('does nothing on a page with no count line', () => {
    document.body.innerHTML = '<div class="results"></div>';
    expect(updateResultCount({ loaded: 30, hidden: 0 }, document)).toBeNull();
  });
});

describe('restoreResultCount', () => {
  it("gives the site's own wording back", () => {
    updateResultCount({ loaded: 307, hidden: 199 }, document);
    restoreResultCount(document);

    expect(line().textContent).toBe('Displaying 30 out of 299 jobs');
    expect(line().hasAttribute('data-ojrf-original-count')).toBe(false);
  });

  it('is safe when nothing was ever changed', () => {
    expect(() => restoreResultCount(document)).not.toThrow();
    expect(line().textContent).toBe(ORIGINAL);
  });
});

describe('dockSummary', () => {
  const summary = () => {
    const element = document.createElement('div');
    element.className = 'ojrf-summary';
    element.textContent = '4 low rate';
    return element;
  };

  it('puts the summary immediately after the count line', () => {
    const element = summary();
    expect(dockSummary(element, document)).toBe(true);

    expect(element.previousElementSibling).toBe(line());
    expect(line().classList.contains('ojrf-count-line')).toBe(true);
  });

  it('finds the line again after we have rewritten its wording', () => {
    updateResultCount({ loaded: 307, hidden: 199 }, document);
    expect(dockSummary(summary(), document)).toBe(true);
  });

  it('survives being called on every render', () => {
    const element = summary();
    dockSummary(element, document);
    dockSummary(element, document);

    expect(document.querySelectorAll('.ojrf-summary')).toHaveLength(1);
  });

  it('leaves the summary alone when rewriting the count', () => {
    // The line's text is replaced wholesale, so a summary inside it would go
    // with it. This is the assertion that keeps it a sibling.
    const element = summary();
    dockSummary(element, document);
    updateResultCount({ loaded: 307, hidden: 199 }, document);

    expect(element.isConnected).toBe(true);
    expect(element.textContent).toBe('4 low rate');
  });

  it('says so when there is no count line to dock against', () => {
    document.body.innerHTML = '<div class="results"></div>';
    expect(dockSummary(summary(), document)).toBe(false);
  });

  it('gives the line back its own class', () => {
    dockSummary(summary(), document);
    undockSummary(document);

    expect(line().classList.contains('ojrf-count-line')).toBe(false);
  });
});

describe('the control bar once its summary has been docked', () => {
  /**
   * A regression, and an expensive one: the bar used to look its status element
   * up through `bar.querySelector` on every call. Docking moves the summary out
   * of the bar, so that lookup started returning null and setStatus threw -
   * which killed the merge that was calling it, and the only visible symptom
   * was that page merging quietly stopped happening.
   */
  it('can still write a status', () => {
    const bar = createControlBar({ onChange() {}, onOpenOptions() {} });
    document.querySelector('.results').appendChild(bar.element);

    expect(dockSummary(bar.rows.summary, document)).toBe(true);
    expect(bar.element.contains(bar.rows.summary)).toBe(false);

    expect(() => bar.setStatus('+150 listings merged')).not.toThrow();
    expect(bar.rows.summary.textContent).toContain('+150 listings merged');
    expect(bar.rows.summary.hidden).toBe(false);
  });

  it('takes it back into the bar when the filter is switched off', () => {
    const bar = createControlBar({ onChange() {}, onOpenOptions() {} });
    document.querySelector('.results').appendChild(bar.element);
    dockSummary(bar.rows.summary, document);

    undockSummary(document);
    bar.reclaimSummary();

    expect(bar.element.contains(bar.rows.summary)).toBe(true);
    // Back in its own place, under the controls rather than dumped at the end.
    expect(bar.rows.summary.previousElementSibling.classList.contains('ojrf-row')).toBe(true);
    expect(() => bar.setStatus('')).not.toThrow();
  });
});
