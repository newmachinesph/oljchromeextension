// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  highlightTerms,
  applyHighlights,
  clearHighlights,
} from '../src/content/highlight.js';

/** jsdom has no CSS Custom Highlight API, so stand one in. */
function installHighlights() {
  const store = new Map();
  globalThis.CSS = { highlights: store };
  globalThis.Highlight = class {
    constructor(...ranges) {
      this.ranges = ranges;
    }
  };
  return store;
}

beforeEach(() => {
  delete globalThis.CSS;
  delete globalThis.Highlight;
  document.body.innerHTML = '';
});

describe('highlightTerms', () => {
  it('gathers terms from several lists, longest first', () => {
    // Longest first so "virtual assistant" wins over "assistant" rather than
    // the phrase being painted as two adjacent pieces.
    const terms = highlightTerms(['assistant', 'virtual assistant'], ['React']);
    expect(terms[0]).toBe('virtual assistant');
    expect(terms).toContain('react');
  });

  it('drops terms too short to be worth marking', () => {
    expect(highlightTerms(['a', 'in', ''])).toEqual(['in']);
  });

  it('says nothing about nothing', () => {
    expect(highlightTerms(null, undefined, [])).toEqual([]);
  });
});

describe('applyHighlights', () => {
  const block = (html) => {
    document.body.innerHTML = `<div class="desc">${html}</div>`;
    return document.querySelector('.desc');
  };

  it('marks every occurrence', () => {
    const store = installHighlights();
    const count = applyHighlights([block('React and more React work')], ['react'], document);

    expect(count).toBe(2);
    expect(store.get('ojrf-term').ranges).toHaveLength(2);
  });

  it('changes nothing in the page', () => {
    // The whole reason for using the highlight API rather than <mark>.
    installHighlights();
    const el = block('React developer wanted');
    const before = el.innerHTML;

    applyHighlights([el], ['react'], document);
    expect(el.innerHTML).toBe(before);
    expect(el.querySelectorAll('*')).toHaveLength(0);
  });

  it('does not paint a shorter term inside a longer one', () => {
    const store = installHighlights();
    applyHighlights([block('a virtual assistant role')], highlightTerms(['virtual assistant', 'assistant']), document);

    expect(store.get('ojrf-term').ranges).toHaveLength(1);
  });

  it('leaves our own chips alone', () => {
    // Marking the word inside our own badge would be highlighting our output.
    const store = installHighlights();
    const el = block('<span class="ojrf-chip">react</span> and react');

    applyHighlights([el], ['react'], document);
    expect(store.get('ojrf-term').ranges).toHaveLength(1);
  });

  it('clears rather than painting nothing when there are no matches', () => {
    const store = installHighlights();
    store.set('ojrf-term', 'stale');

    expect(applyHighlights([block('nothing here')], ['react'], document)).toBe(0);
    expect(store.has('ojrf-term')).toBe(false);
  });

  it('does nothing at all where the browser lacks the API', () => {
    // Purely decorative, so absence should be silent rather than fatal.
    expect(() => applyHighlights([block('react')], ['react'], document)).not.toThrow();
    expect(applyHighlights([block('react')], ['react'], document)).toBe(0);
  });

  it('copes with an empty list of blocks or terms', () => {
    installHighlights();
    expect(applyHighlights([], ['react'], document)).toBe(0);
    expect(applyHighlights([block('react')], [], document)).toBe(0);
  });
});

describe('clearHighlights', () => {
  it('removes only ours', () => {
    const store = installHighlights();
    store.set('someone-else', 'theirs');
    applyHighlights([document.body], ['body'], document);

    clearHighlights();
    expect(store.has('ojrf-term')).toBe(false);
    expect(store.get('someone-else')).toBe('theirs');
  });

  it('is safe when the API is missing', () => {
    expect(() => clearHighlights()).not.toThrow();
  });
});
