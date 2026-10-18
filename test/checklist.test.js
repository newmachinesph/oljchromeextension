import { describe, it, expect } from 'vitest';
import {
  parseChecklist,
  hasChecklist,
  toggleChecklistItem,
  checklistProgress,
} from '../src/core/checklist.js';

const NOTE = 'Prep:\n- [ ] send portfolio\n- [x] confirm rate\nnot a task\n- [ ] follow up';

describe('parseChecklist', () => {
  it('finds checklist lines with their note line index', () => {
    expect(parseChecklist(NOTE)).toEqual([
      { index: 1, checked: false, label: 'send portfolio' },
      { index: 2, checked: true, label: 'confirm rate' },
      { index: 4, checked: false, label: 'follow up' },
    ]);
  });
  it('returns nothing for plain text', () => {
    expect(parseChecklist('just a note')).toEqual([]);
    expect(hasChecklist('just a note')).toBe(false);
    expect(hasChecklist(NOTE)).toBe(true);
  });
});

describe('toggleChecklistItem', () => {
  it('flips one item and leaves the rest of the note intact', () => {
    const next = toggleChecklistItem(NOTE, 1);
    expect(next.split('\n')[1]).toBe('- [x] send portfolio');
    expect(next.split('\n')[2]).toBe('- [x] confirm rate');
    expect(next.split('\n')[3]).toBe('not a task');
  });
  it('unchecks a checked item', () => {
    expect(toggleChecklistItem(NOTE, 2).split('\n')[2]).toBe('- [ ] confirm rate');
  });
  it('is a no-op on a non-item line', () => {
    expect(toggleChecklistItem(NOTE, 3)).toBe(NOTE);
  });
});

describe('checklistProgress', () => {
  it('counts done over total', () => {
    expect(checklistProgress(NOTE)).toEqual({ done: 1, total: 3 });
  });
});
