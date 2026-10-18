// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPresetPicker } from '../src/content/preset-picker.js';
import { sanitizeUserPreset, MY_PRESETS_GROUP } from '../src/core/user-presets.js';

/**
 * The picker is the whole preset surface on the page: browse, filter by level,
 * copy, edit, create, hide, delete. None of it is covered anywhere else, and it
 * is all injected DOM, so these drive the real markup through real clicks.
 */

const NOW = 1_700_000_000_000;

/**
 * A fresh document per test.
 *
 * createPresetPicker registers a keydown listener on the document it is given,
 * and there is no way to take it back. Sharing one document let a picker from
 * an earlier test answer this test's Escape and close the dialog before the
 * picker under test ever saw the key. A new document each time also exercises
 * the doc injection, which is the reason it is a parameter at all.
 */
let doc;

function mount(over = {}) {
  const hooks = {
    onApply: vi.fn(),
    onSaveCurrent: vi.fn(),
    getUserPresets: () => [],
    getHiddenPresets: () => [],
    onSavePreset: vi.fn(async () => []),
    onDeletePreset: vi.fn(async () => []),
    onToggleHidden: vi.fn(async () => []),
    ...over,
  };
  return { picker: createPresetPicker(hooks, doc), hooks };
}

const $ = (sel) => doc.querySelector(sel);
const $$ = (sel) => Array.from(doc.querySelectorAll(sel));
const textOf = (sel) => $$(sel).map((el) => el.textContent.trim());

const pressEscape = () =>
  doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

beforeEach(() => {
  doc = document.implementation.createHTMLDocument('picker');
});

describe('opening and closing', () => {
  it('builds the dialog once and reuses it', () => {
    const { picker } = mount();

    picker.open();
    const first = $('#ojrf-presets');
    picker.close();
    picker.open();

    expect($$('#ojrf-presets')).toHaveLength(1);
    expect($('#ojrf-presets')).toBe(first);
  });

  it('is a real dialog, and hidden once closed', () => {
    const { picker } = mount();
    picker.open();

    const root = $('#ojrf-presets');
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.hidden).toBe(false);

    picker.close();
    expect(root.hidden).toBe(true);
  });

  it('closes on Escape', () => {
    const { picker } = mount();
    picker.open();

    pressEscape();
    expect($('#ojrf-presets').hidden).toBe(true);
  });

  it('toggles', () => {
    const { picker } = mount();
    picker.toggle();
    expect($('#ojrf-presets').hidden).toBe(false);
    picker.toggle();
    expect($('#ojrf-presets').hidden).toBe(true);
  });
});

describe('the menu bar', () => {
  it('offers every level band', () => {
    const { picker } = mount();
    picker.open();

    expect(textOf('.ojrf-presets-menu .ojrf-preset-level')).toEqual([
      'Any level',
      'Beginner',
      'Mid',
      'Senior',
    ]);
  });

  it('offers a way to write a new one', () => {
    const { picker } = mount();
    picker.open();
    expect($('.ojrf-presets-new')).not.toBeNull();
  });

  it('narrows the list to a band, dropping empty headings', () => {
    const { picker } = mount();
    picker.open();

    const before = $$('.ojrf-preset-card').length;
    $$('.ojrf-presets-menu .ojrf-preset-level').find((b) => b.textContent === 'Beginner').click();

    expect($$('.ojrf-preset-card').length).toBeLessThan(before);
    for (const list of $$('.ojrf-preset-grid')) {
      expect(list.children.length).toBeGreaterThan(0);
    }
  });
});

describe('your own presets', () => {
  it('leads with My presets once you own one', () => {
    const mine = sanitizeUserPreset({ name: 'Mine', filters: {} }, NOW);
    const { picker } = mount({ getUserPresets: () => [mine] });
    picker.open();

    expect(textOf('.ojrf-preset-group')[0]).toBe(MY_PRESETS_GROUP);
  });

  it('omits My presets entirely on a fresh install', () => {
    const { picker } = mount();
    picker.open();
    expect(textOf('.ojrf-preset-group')).not.toContain(MY_PRESETS_GROUP);
  });

  it('only offers delete on presets you own', () => {
    const mine = sanitizeUserPreset({ name: 'Mine', filters: {} }, NOW);
    const { picker } = mount({ getUserPresets: () => [mine] });
    picker.open();

    $('.ojrf-preset-kebab').click();
    expect(textOf('.ojrf-preset-menu:not([hidden]) .ojrf-preset-menu-item')).toEqual([
      'Edit',
      'Copy',
      'Hide',
      'Delete',
    ]);
  });

  it('offers no delete on a shipped preset', () => {
    const { picker } = mount();
    picker.open();

    $('.ojrf-preset-kebab').click();
    expect(textOf('.ojrf-preset-menu:not([hidden]) .ojrf-preset-menu-item')).toEqual([
      'Edit',
      'Copy',
      'Hide',
    ]);
  });
});

describe('the kebab menu', () => {
  it('opens one menu at a time', () => {
    const { picker } = mount();
    picker.open();

    const kebabs = $$('.ojrf-preset-kebab');
    kebabs[0].click();
    kebabs[1].click();

    expect($$('.ojrf-preset-menu:not([hidden])')).toHaveLength(1);
  });

  it('closes on a click elsewhere in the dialog', () => {
    const { picker } = mount();
    picker.open();

    $('.ojrf-preset-kebab').click();
    expect($$('.ojrf-preset-menu:not([hidden])')).toHaveLength(1);

    $('.ojrf-presets-body').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect($$('.ojrf-preset-menu:not([hidden])')).toHaveLength(0);
  });

  it('backs out of the menu on Escape before closing the dialog', () => {
    const { picker } = mount();
    picker.open();

    $('.ojrf-preset-kebab').click();
    pressEscape();

    expect($$('.ojrf-preset-menu:not([hidden])')).toHaveLength(0);
    expect($('#ojrf-presets').hidden).toBe(false);
  });
});

describe('applying', () => {
  it('hands the preset back and closes', () => {
    const { picker, hooks } = mount();
    picker.open();

    $('.ojrf-preset-apply').click();

    expect(hooks.onApply).toHaveBeenCalledTimes(1);
    expect(hooks.onApply.mock.calls[0][0]).toHaveProperty('filters');
    expect($('#ojrf-presets').hidden).toBe(true);
  });

  it('offers to save your current filters first', () => {
    const { picker, hooks } = mount();
    picker.open();

    $('.ojrf-presets-save').click();
    expect(hooks.onSaveCurrent).toHaveBeenCalled();
  });
});

describe('hiding', () => {
  it('asks the store to hide by name', () => {
    const { picker, hooks } = mount();
    picker.open();

    const name = $('.ojrf-preset-name').childNodes[0].textContent.trim();
    $('.ojrf-preset-kebab').click();
    $$('.ojrf-preset-menu-item').find((b) => b.textContent === 'Hide').click();

    expect(hooks.onToggleHidden).toHaveBeenCalledWith(name);
  });

  it('drops a hidden preset from the list and offers to reveal it', () => {
    const mine = sanitizeUserPreset({ name: 'Mine', filters: {} }, NOW);
    const { picker } = mount({
      getUserPresets: () => [mine],
      getHiddenPresets: () => ['Mine'],
    });
    picker.open();

    expect(textOf('.ojrf-preset-group')).not.toContain(MY_PRESETS_GROUP);
    expect(textOf('.ojrf-presets-menu .ojrf-preset-level')).toContain('Show 1 hidden');
  });

  it('reveals hidden presets when asked, and says so', () => {
    const mine = sanitizeUserPreset({ name: 'Mine', filters: {} }, NOW);
    const { picker } = mount({
      getUserPresets: () => [mine],
      getHiddenPresets: () => ['Mine'],
    });
    picker.open();

    $$('.ojrf-presets-menu .ojrf-preset-level')
      .find((b) => /Show 1 hidden/.test(b.textContent))
      .click();

    expect(textOf('.ojrf-preset-group')).toContain(MY_PRESETS_GROUP);
    expect(textOf('.ojrf-presets-menu .ojrf-preset-level')).toContain('Hiding 1');
  });

  it('offers no reveal toggle when nothing is hidden', () => {
    const { picker } = mount();
    picker.open();
    expect(textOf('.ojrf-presets-menu .ojrf-preset-level').join(' ')).not.toMatch(/hidden/i);
  });
});

describe('the editor', () => {
  const openNew = () => {
    $('.ojrf-presets-new').click();
    return $('.ojrf-preset-editor');
  };

  it('opens a blank preset from the menu bar, replacing the grid', () => {
    const { picker } = mount();
    picker.open();

    expect(openNew()).not.toBeNull();
    expect($$('.ojrf-preset-card')).toHaveLength(0);
  });

  it('marks the name as the one thing it cannot do without', () => {
    const { picker } = mount();
    picker.open();
    openNew();

    expect($('.ojrf-preset-req')).not.toBeNull();
  });

  it('refuses to save without a name', () => {
    const { picker } = mount();
    picker.open();
    openNew();

    const name = $('.ojrf-preset-input');
    name.value = '   ';
    name.dispatchEvent(new Event('input', { bubbles: true }));

    expect($$('.ojrf-preset-editor .ojrf-preset-apply')[0].disabled).toBe(true);
  });

  it('saves what was typed, parsing the comma lists', async () => {
    const { picker, hooks } = mount();
    picker.open();
    openNew();

    const [name, hint, floor, terms, exclude] = $$('.ojrf-preset-input');
    name.value = 'My search';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    hint.value = 'what it is for';
    floor.value = '850';
    terms.value = 'n8n, make.com , zapier';
    exclude.value = 'commission only';

    $$('.ojrf-preset-editor .ojrf-preset-apply')[0].click();
    await Promise.resolve();

    expect(hooks.onSavePreset).toHaveBeenCalledTimes(1);
    const saved = hooks.onSavePreset.mock.calls[0][0];
    expect(saved.name).toBe('My search');
    expect(saved.hint).toBe('what it is for');
    expect(saved.filters.thresholdUsdPerMonth).toBe(850);
    expect(saved.filters.searchKeywords).toEqual(['n8n', 'make.com', 'zapier']);
    expect(saved.filters.excludeKeywords).toEqual(['commission only']);
  });

  it('records the level you picked', async () => {
    const { picker, hooks } = mount();
    picker.open();
    openNew();

    $$('.ojrf-preset-editor .ojrf-preset-level').find((b) => b.textContent === 'Mid').click();
    $$('.ojrf-preset-editor .ojrf-preset-apply')[0].click();
    await Promise.resolve();

    expect(hooks.onSavePreset.mock.calls[0][0].level).toBe('mid');
  });

  it('cancels back to the grid without saving', () => {
    const { picker, hooks } = mount();
    picker.open();
    openNew();

    $$('.ojrf-preset-editor .ojrf-preset-minor').find((b) => b.textContent === 'Cancel').click();

    expect($('.ojrf-preset-editor')).toBeNull();
    expect($$('.ojrf-preset-card').length).toBeGreaterThan(0);
    expect(hooks.onSavePreset).not.toHaveBeenCalled();
  });

  it('Escape leaves the editor but keeps the dialog open', () => {
    const { picker } = mount();
    picker.open();
    openNew();

    pressEscape();

    expect($('.ojrf-preset-editor')).toBeNull();
    expect($('#ojrf-presets').hidden).toBe(false);
  });

  it('copies a shipped preset into one of yours, named clear of it', () => {
    const { picker } = mount();
    picker.open();

    const original = $('.ojrf-preset-name').childNodes[0].textContent.trim();
    $('.ojrf-preset-kebab').click();
    $$('.ojrf-preset-menu-item').find((b) => b.textContent === 'Copy').click();

    expect($('.ojrf-preset-input').value).toBe(`${original} (copy)`);
    // Named by the copy itself; only an override is titled "Editing ...".
    expect($('.ojrf-preset-editor-title').textContent).toBe(`${original} (copy)`);
    expect($('.ojrf-preset-editor-note')).toBeNull();
  });

  it('edits a shipped preset as an override, and says it can be reverted', () => {
    const { picker } = mount();
    picker.open();

    const original = $('.ojrf-preset-name').childNodes[0].textContent.trim();
    $('.ojrf-preset-kebab').click();
    $$('.ojrf-preset-menu-item').find((b) => b.textContent === 'Edit').click();

    expect($('.ojrf-preset-editor-title').textContent).toContain(original);
    expect($('.ojrf-preset-editor-note').textContent).toMatch(/revert/i);
  });

  it('reopens the picker on the grid, never on a stale form', () => {
    const { picker } = mount();
    picker.open();
    openNew();
    picker.close();
    picker.open();

    expect($('.ojrf-preset-editor')).toBeNull();
  });
});
