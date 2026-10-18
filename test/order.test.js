// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyOrder, clearOrder } from '../src/content/order.js';

const results = () => document.getElementById('results');
const orderOf = (id) => document.getElementById(id).style.order;
const cardIds = () => Array.from(results().querySelectorAll('.card'), (el) => el.id);
const card = (id) => document.getElementById(id);
const rankOf = (id) => Number(orderOf(id));

beforeEach(() => {
  // A realistic container: our bar on top, cards in the middle, the site's
  // pagination underneath.
  document.body.innerHTML = `
    <div id="results">
      <div id="ojrf-bar"></div>
      <div id="count">Displaying 30 of 296</div>
      <div class="card" id="a"></div>
      <div class="card" id="b"></div>
      <div class="card" id="c"></div>
      <div id="pager"></div>
    </div>`;
});

describe('applyOrder', () => {
  it('reports how many listings it placed', () => {
    expect(applyOrder(results(), [card('c'), card('a'), card('b')])).toBe(3);
  });

  it('never moves a node - only the CSS order changes', () => {
    applyOrder(results(), [card('c'), card('b'), card('a')]);

    expect(cardIds()).toEqual(['a', 'b', 'c']);
    expect(rankOf('c')).toBeLessThan(rankOf('b'));
    expect(rankOf('b')).toBeLessThan(rankOf('a'));
  });

  it('makes the container a flex column, which is what makes order apply', () => {
    applyOrder(results(), [card('a')]);
    expect(results().classList.contains('ojrf-sorted')).toBe(true);
  });

  it('keeps what sat above the listings above them', () => {
    applyOrder(results(), [card('c'), card('b'), card('a')]);

    const highest = Math.max(rankOf('a'), rankOf('b'), rankOf('c'));
    expect(rankOf('ojrf-bar')).toBeLessThan(rankOf('count'));
    expect(rankOf('count')).toBeLessThan(highest);
  });

  it('keeps what sat below the listings below them', () => {
    applyOrder(results(), [card('c'), card('b'), card('a')]);

    const highest = Math.max(rankOf('a'), rankOf('b'), rankOf('c'));
    expect(rankOf('pager')).toBeGreaterThan(highest);
  });

  it('gives every child an explicit order, ranked or not', () => {
    // Otherwise an unranked listing falls back to source order and lands in the
    // middle of the ranking.
    applyOrder(results(), [card('b'), card('a')]);
    expect(orderOf('c')).not.toBe('');
  });

  it('re-ranking replaces the previous ordering rather than layering on it', () => {
    applyOrder(results(), [card('c'), card('b'), card('a')]);
    applyOrder(results(), [card('a'), card('b'), card('c')]);

    expect(rankOf('a')).toBeLessThan(rankOf('b'));
    expect(rankOf('b')).toBeLessThan(rankOf('c'));
  });

  it('does nothing without a container', () => {
    expect(applyOrder(null, [])).toBe(0);
  });
});

describe('clearOrder', () => {
  it('leaves nothing of ours behind', () => {
    applyOrder(results(), [card('c'), card('a'), card('b')]);
    clearOrder(results());

    expect(results().classList.contains('ojrf-sorted')).toBe(false);
    for (const child of results().children) expect(child.style.order).toBe('');
    // And the site's own order was never disturbed to begin with.
    expect(cardIds()).toEqual(['a', 'b', 'c']);
  });

  it('is safe on a container that was never sorted', () => {
    expect(() => clearOrder(results())).not.toThrow();
    expect(() => clearOrder(null)).not.toThrow();
  });
});
