import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TAGS,
  DEFAULT_TAG_COLOR,
  defaultTagColor,
  tagColor,
} from '../src/core/tags-catalog.js';

describe('DEFAULT_TAGS', () => {
  it('are non-empty labels with hex colours', () => {
    expect(DEFAULT_TAGS.length).toBeGreaterThan(0);
    for (const t of DEFAULT_TAGS) {
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('defaultTagColor', () => {
  it('finds a built-in tag colour case-insensitively', () => {
    expect(defaultTagColor('High Priority')).toBe('#dc2626');
    expect(defaultTagColor('  high priority ')).toBe('#dc2626');
  });
  it('returns null for an unknown tag', () => {
    expect(defaultTagColor('Something Else')).toBeNull();
    expect(defaultTagColor('')).toBeNull();
  });
});

describe('tagColor', () => {
  it('prefers a saved colour, then the default, then the fallback', () => {
    const saved = new Map([['urgent', '#000000']]);
    expect(tagColor('Urgent', saved)).toBe('#000000');
    expect(tagColor('Day Shift', saved)).toBe('#d97706');
    expect(tagColor('My Own Tag', saved)).toBe(DEFAULT_TAG_COLOR);
  });
  it('works with no colours map', () => {
    expect(tagColor('Urgent')).toBe('#ea580c');
    expect(tagColor('Unknown')).toBe(DEFAULT_TAG_COLOR);
  });
});
