// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyLayout, resetLayout, setSiteSearchHidden } from '../src/content/layout.js';
import { DEFAULTS, sanitize } from '../src/core/settings.js';

const root = () => document.documentElement;

beforeEach(() => {
  resetLayout();
});

describe('applyLayout', () => {
  it('marks the root and publishes the sidebar width', () => {
    applyLayout({ wide: true, sidebarWidth: 380 });

    expect(root().classList.contains('ojrf-wide')).toBe(true);
    expect(root().style.getPropertyValue('--ojrf-sidebar-width')).toBe('380px');
  });

  it('leaves the site layout alone when switched off', () => {
    applyLayout({ wide: false, sidebarWidth: 380 });

    expect(root().classList.contains('ojrf-wide')).toBe(false);
    expect(root().style.getPropertyValue('--ojrf-sidebar-width')).toBe('');
  });

  it('ignores a width that is not a number', () => {
    applyLayout({ wide: true, sidebarWidth: Number.NaN });
    expect(root().classList.contains('ojrf-wide')).toBe(true);
    // No property written, so the stylesheet fallback applies.
    expect(root().style.getPropertyValue('--ojrf-sidebar-width')).toBe('');
  });

  it('updates the width in place when it changes', () => {
    applyLayout({ wide: true, sidebarWidth: 300 });
    applyLayout({ wide: true, sidebarWidth: 460 });
    expect(root().style.getPropertyValue('--ojrf-sidebar-width')).toBe('460px');
  });
});

describe('setSiteSearchHidden', () => {
  beforeEach(() => {
    document.body.innerHTML = '<form id="myform" class="form-inline form-search"></form>';
  });

  const form = () => document.getElementById('myform');

  it('hides the site search bar rather than removing it', () => {
    setSiteSearchHidden(true);
    expect(form()).not.toBeNull();
    expect(form().classList.contains('ojrf-part-hidden')).toBe(true);
  });

  it('gives it back', () => {
    setSiteSearchHidden(true);
    setSiteSearchHidden(false);
    expect(form().classList.contains('ojrf-part-hidden')).toBe(false);
  });

  it('is restored by resetLayout', () => {
    setSiteSearchHidden(true);
    resetLayout();
    expect(form().classList.contains('ojrf-part-hidden')).toBe(false);
  });

  it('does nothing when the page has no search bar', () => {
    document.body.innerHTML = '';
    expect(() => setSiteSearchHidden(true)).not.toThrow();
  });
});

describe('resetLayout', () => {
  it('removes every trace, so the site gets its own layout back', () => {
    applyLayout({ wide: true, sidebarWidth: 380 });
    resetLayout();

    expect(root().classList.contains('ojrf-wide')).toBe(false);
    expect(root().style.getPropertyValue('--ojrf-sidebar-width')).toBe('');
  });

  it('is safe to call when nothing was applied', () => {
    expect(() => resetLayout()).not.toThrow();
  });
});

describe('defaults', () => {
  it('is on, with a sidebar wider than the site allots', () => {
    expect(DEFAULTS.wideLayout).toBe(true);
    expect(DEFAULTS.sidebarWidth).toBe(380);
  });

  it('hides the site search bar, since ours supersedes it', () => {
    expect(DEFAULTS.hideSiteSearch).toBe(true);
  });

  it('clamps a silly width', () => {
    expect(sanitize({ sidebarWidth: 5000 }).sidebarWidth).toBe(640);
    expect(sanitize({ sidebarWidth: 10 }).sidebarWidth).toBe(220);
  });
});

/**
 * Signed in, the site adds a second search form to the header. Taking the first
 * match hid the navbar's row and left the real search bar on screen.
 */
describe('the site search, signed in', () => {
  const loggedInPage = () => {
    document.body.innerHTML = `
      <header class="header-in">
        <nav class="navbar navbar-expand-lg">
          <div class="row">
            <form class="form-inline form-search form-search-header flex-fill">
              <input name="jobkeyword">
            </form>
          </div>
        </nav>
      </header>
      <section class="jobseeker-search">
        <div class="row no-gutters">
          <form id="myform" class="form-inline form-search"><input name="jobkeyword"></form>
        </div>
        <div class="results"><div class="jobpost-cat-box">a listing</div></div>
      </section>`;
  };

  const headerForm = () => document.querySelector('.form-search-header');
  const resultsForm = () => document.getElementById('myform');
  const hidden = (el) => Boolean(el.closest('.ojrf-part-hidden'));

  beforeEach(loggedInPage);

  it('hides the results search, not the header one', () => {
    setSiteSearchHidden(true, document);

    expect(hidden(resultsForm())).toBe(true);
    expect(hidden(headerForm())).toBe(false);
  });

  it('leaves the navbar alone', () => {
    // The bug: the header form's row was hidden, taking the navbar with it.
    setSiteSearchHidden(true, document);

    expect(document.querySelector('nav').closest('.ojrf-part-hidden')).toBeNull();
    expect(document.querySelector('header').classList.contains('ojrf-part-hidden')).toBe(false);
  });

  it('gives the results search back', () => {
    setSiteSearchHidden(true, document);
    setSiteSearchHidden(false, document);

    expect(document.querySelectorAll('.ojrf-part-hidden')).toHaveLength(0);
  });

  it('never hides a row that carries navigation, even as a last resort', () => {
    // Only the header form exists - there is nothing of ours to hide, and the
    // navbar must survive regardless.
    document.body.innerHTML = `
      <header><nav class="navbar"><div class="row">
        <form class="form-search"><input name="jobkeyword"></form>
      </div></nav></header>`;

    setSiteSearchHidden(true, document);
    expect(document.querySelectorAll('.ojrf-part-hidden')).toHaveLength(0);
  });

  it('still works signed out, where there is only one form', () => {
    document.body.innerHTML = `
      <section class="jobseeker-search">
        <div class="row"><form id="myform" class="form-search"><input></form></div>
      </section>`;

    setSiteSearchHidden(true, document);
    expect(hidden(document.getElementById('myform'))).toBe(true);
  });
});
