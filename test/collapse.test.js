// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { collapse, configureGrouping, expand, isCollapsed } from '../src/content/collapse.js';
import { sanitize } from '../src/core/settings.js';

const HIDDEN_CLASS = 'ojrf-hidden';
const GROUP_ID = 'ojrf-hidden-group';

/** A listing the filter would act on, in a container of its own. */
function listing(title = 'A job') {
  const container = document.getElementById('results');
  const element = document.createElement('article');
  element.textContent = title;
  container.appendChild(element);
  return { element, titleText: title };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="results"></div>';
});

describe('hidden listings, not shown at all', () => {
  it('hides the listing and leaves no stub behind', () => {
    const container = document.getElementById('results');
    configureGrouping({ container, position: 'off' });

    const job = listing();
    collapse(job, '$200/mo', 'below-rate');

    expect(job.element.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(document.querySelector('.ojrf-stub')).toBeNull();
    expect(document.getElementById(GROUP_ID)).toBeNull();
  });

  it('still reports the listing as collapsed, though there is no stub', () => {
    configureGrouping({ container: document.getElementById('results'), position: 'off' });
    const job = listing();
    collapse(job, '$200/mo', 'below-rate');

    // The old implementation asked the stub registry, which is empty here.
    expect(isCollapsed(job)).toBe(true);
  });

  it('clears a stub left over from a previous setting', () => {
    const container = document.getElementById('results');
    const job = listing();

    configureGrouping({ container, position: 'inline' });
    collapse(job, '$200/mo', 'below-rate');
    expect(document.querySelector('.ojrf-stub')).not.toBeNull();

    // Switching to 'off' on a later pass must take the stub with it, rather
    // than stranding one that no longer belongs to any mode.
    configureGrouping({ container, position: 'off' });
    collapse(job, '$200/mo', 'below-rate');
    expect(document.querySelector('.ojrf-stub')).toBeNull();
    expect(job.element.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('removes the gathered block when switching away from it', () => {
    const container = document.getElementById('results');
    const job = listing();

    configureGrouping({ container, position: 'top' });
    collapse(job, '$200/mo', 'below-rate');
    expect(document.getElementById(GROUP_ID)).not.toBeNull();

    configureGrouping({ container, position: 'off' });
    expect(document.getElementById(GROUP_ID)).toBeNull();
  });

  it('restores the listing when the filter lets it back', () => {
    configureGrouping({ container: document.getElementById('results'), position: 'off' });
    const job = listing();
    collapse(job, '$200/mo', 'below-rate');
    expand(job);

    expect(job.element.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(isCollapsed(job)).toBe(false);
  });
});

describe('the other modes still behave', () => {
  it('leaves a stub in place of the listing when inline', () => {
    configureGrouping({ container: document.getElementById('results'), position: 'inline' });
    const job = listing();
    collapse(job, '$200/mo', 'below-rate');

    const stub = document.querySelector('.ojrf-stub');
    expect(stub).not.toBeNull();
    expect(stub.nextElementSibling).toBe(job.element);
    expect(isCollapsed(job)).toBe(true);
  });

  it('gathers stubs into one block when set to top', () => {
    const container = document.getElementById('results');
    configureGrouping({ container, position: 'top' });
    collapse(listing('One'), '$100/mo', 'below-rate');
    collapse(listing('Two'), '$150/mo', 'below-rate');

    const group = document.getElementById(GROUP_ID);
    expect(group).not.toBeNull();
    expect(group.querySelectorAll('.ojrf-stub')).toHaveLength(2);
  });
});

describe('the setting itself', () => {
  it('accepts every mode the picker offers', () => {
    for (const value of ['top', 'bottom', 'inline', 'off']) {
      expect(sanitize({ groupHiddenAt: value }).groupHiddenAt).toBe(value);
    }
  });

  it('falls back to the default for anything else', () => {
    expect(sanitize({ groupHiddenAt: 'sideways' }).groupHiddenAt).toBe('top');
    expect(sanitize({ groupHiddenAt: null }).groupHiddenAt).toBe('top');
    expect(sanitize({ groupHiddenAt: 7 }).groupHiddenAt).toBe('top');
  });
});
