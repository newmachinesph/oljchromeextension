// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createControlBar } from '../src/content/control-bar.js';
import { DEFAULTS } from '../src/core/settings.js';

/**
 * The cloud shows the commonest skills first and hides the tail behind a
 * button, because a live page yields far more skills than a sidebar can hold.
 * Measured on onlinejobs.ph: 86 distinct skills across 78 loaded listings, of
 * which the first 28 fit - so the cut is the common case, not the edge one.
 */
const CLOUD_LIMIT = 28;

/** `count` skills, each rarer than the last, so the order is unambiguous. */
function skills(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `Skill ${index + 1}`,
    count: count - index,
  }));
}

let bar;

beforeEach(() => {
  document.body.innerHTML = '';
  bar = createControlBar({});
  document.body.appendChild(bar.element);
});

const chips = () => bar.element.querySelectorAll('.ojrf-cloud-chip');
const toggle = () => bar.element.querySelector('.ojrf-cloud-more');

function paint(skillList, overrides = {}) {
  bar.update({ ...DEFAULTS, ...overrides }, { skills: skillList });
}

describe('the skill cloud', () => {
  it('shows every skill when they all fit, with nothing to press', () => {
    paint(skills(10));

    expect(chips()).toHaveLength(10);
    expect(toggle()).toBeNull();
  });

  it('cuts the tail off and says how many there are in total', () => {
    paint(skills(40));

    expect(chips()).toHaveLength(CLOUD_LIMIT);
    expect(toggle().textContent).toBe('Show all 40');
  });

  it('shows the rest when asked, and offers the way back', () => {
    paint(skills(40));
    toggle().click();

    expect(chips()).toHaveLength(40);
    expect(toggle().textContent).toBe('Show fewer');

    toggle().click();
    expect(chips()).toHaveLength(CLOUD_LIMIT);
  });

  it('keeps the cloud open across a repaint, so a new listing cannot close it', () => {
    // The auto-refresh repaints every tick. Collapsing on each one would shut
    // the list under the cursor of anyone reading the tail.
    paint(skills(40));
    toggle().click();

    paint(skills(41));
    expect(chips()).toHaveLength(41);
  });

  it('drops the button once the tail is gone', () => {
    paint(skills(40));
    paint(skills(5));

    expect(chips()).toHaveLength(5);
    expect(toggle()).toBeNull();
  });
});
