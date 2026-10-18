// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextIndex, KEY_BINDINGS, describeBindings } from '../src/core/key-nav.js';
import { isTyping } from '../src/content/typing.js';
import { createKeyboardTriage } from '../src/content/keys.js';

describe('nextIndex', () => {
  it('wraps both ways and is -1 on an empty list', () => {
    expect(nextIndex(0, -1, 1)).toBe(-1);
    expect(nextIndex(3, -1, 1)).toBe(0);
    expect(nextIndex(3, -1, -1)).toBe(2);
    expect(nextIndex(3, 2, 1)).toBe(0);
    expect(nextIndex(3, 0, -1)).toBe(2);
    expect(nextIndex(3, 1, 1)).toBe(2);
  });

  it('clamps a stale index back into range', () => {
    expect(nextIndex(2, 7, 1)).toBe(0);
    expect(nextIndex(2, 7, 0)).toBe(1);
  });
});

describe('KEY_BINDINGS', () => {
  it('names every key once and explains it', () => {
    const keys = KEY_BINDINGS.flatMap((b) => b.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const binding of KEY_BINDINGS) expect(binding.does.length).toBeGreaterThan(3);
    expect(describeBindings()).toContain('j / k');
  });
});

describe('isTyping', () => {
  it('is true in fields and editable nodes, false elsewhere', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTyping(document.createElement(tag))).toBe(true);
    }
    const div = document.createElement('div');
    expect(isTyping(div)).toBe(false);
    div.contentEditable = 'true';
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTyping(div)).toBe(true);
    expect(isTyping(null)).toBe(false);
  });
});

describe('createKeyboardTriage', () => {
  let cards;
  let records;
  let actions;
  let triage;

  function press(key, target = document.body) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  afterEach(() => {
    triage?.destroy();
    triage = null;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    cards = ['a', 'b', 'c'].map((name) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.textContent = name;
      card.scrollIntoView = vi.fn();
      document.body.appendChild(card);
      return card;
    });
    cards[1].classList.add('ojrf-hidden');
    records = cards.map((element, index) => ({ element, title: `Job ${index}`, href: `/jobseekers/job/${index}` }));

    actions = { open: vi.fn(), dismiss: vi.fn(), apply: vi.fn(), note: vi.fn(), block: vi.fn(), help: vi.fn() };
    triage = createKeyboardTriage({
      doc: document,
      visibleRecords: () => records.filter((r) => !r.element.classList.contains('ojrf-hidden')),
      isBlocked: () => false,
      actions,
    });
  });

  it('moves focus with j and k, skipping hidden cards and wrapping', () => {
    press('j');
    expect(cards[0].classList.contains('ojrf-focused')).toBe(true);
    expect(cards[0].scrollIntoView).toHaveBeenCalled();

    press('j');
    expect(cards[0].classList.contains('ojrf-focused')).toBe(false);
    expect(cards[1].classList.contains('ojrf-focused')).toBe(false);
    expect(cards[2].classList.contains('ojrf-focused')).toBe(true);

    press('j');
    expect(cards[0].classList.contains('ojrf-focused')).toBe(true);

    press('k');
    expect(cards[2].classList.contains('ojrf-focused')).toBe(true);
  });

  it('acts on the focused record', () => {
    press('j');
    press('d');
    expect(actions.dismiss).toHaveBeenCalledWith(records[0]);
    press('Enter');
    press('o');
    expect(actions.open).toHaveBeenCalledTimes(2);
    press('a');
    expect(actions.apply).toHaveBeenCalledWith(records[0]);
    press('n');
    press('b');
    expect(actions.note).toHaveBeenCalledWith(records[0]);
    expect(actions.block).toHaveBeenCalledWith(records[0]);
    press('?');
    expect(actions.help).toHaveBeenCalled();
  });

  it('does nothing on an action key before anything is focused', () => {
    press('d');
    press('Enter');
    expect(actions.dismiss).not.toHaveBeenCalled();
    expect(actions.open).not.toHaveBeenCalled();
  });

  it('never fires while typing, with a modifier, or while blocked', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('j', input);
    expect(document.querySelector('.ojrf-focused')).toBeNull();

    const ctrl = new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true });
    document.body.dispatchEvent(ctrl);
    expect(document.querySelector('.ojrf-focused')).toBeNull();

    triage.destroy();
    triage = createKeyboardTriage({
      doc: document,
      visibleRecords: () => records,
      isBlocked: () => true,
      actions,
    });
    press('j');
    expect(document.querySelector('.ojrf-focused')).toBeNull();
  });

  it('moves focus on when the focused card is hidden by a render', () => {
    press('j');
    cards[0].classList.add('ojrf-hidden');
    triage.refresh();
    expect(cards[0].classList.contains('ojrf-focused')).toBe(false);
    expect(cards[2].classList.contains('ojrf-focused')).toBe(true);
  });

  it('clears the ring when nothing is left', () => {
    press('j');
    for (const card of cards) card.classList.add('ojrf-hidden');
    triage.refresh();
    expect(document.querySelector('.ojrf-focused')).toBeNull();
  });

  it('stops listening when destroyed', () => {
    triage.destroy();
    press('j');
    expect(document.querySelector('.ojrf-focused')).toBeNull();
  });
});
