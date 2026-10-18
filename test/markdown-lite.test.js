import { describe, it, expect } from 'vitest';
import { parseBlocks, splitBold, looksLikeMarkdown } from '../src/core/markdown-lite.js';

describe('splitBold', () => {
  it('splits **bold** into runs', () => {
    expect(splitBold('pay **$1,200** monthly')).toEqual([
      { text: 'pay ', bold: false },
      { text: '$1,200', bold: true },
      { text: ' monthly', bold: false },
    ]);
  });

  it('handles __bold__ too', () => {
    expect(splitBold('__Urgent__')).toEqual([{ text: 'Urgent', bold: true }]);
  });

  it('leaves an unmatched marker literal', () => {
    expect(splitBold('2**3 is eight')).toEqual([{ text: '2**3 is eight', bold: false }]);
  });

  it('returns the whole line when there is no bold', () => {
    expect(splitBold('plain text')).toEqual([{ text: 'plain text', bold: false }]);
  });
});

describe('parseBlocks', () => {
  it('reads an ATX heading and its level', () => {
    expect(parseBlocks('## Requirements')).toEqual([
      { type: 'heading', level: 2, text: 'Requirements' },
    ]);
  });

  it('groups consecutive bullets into one list', () => {
    const blocks = parseBlocks('- one\n- two\n- three');
    expect(blocks).toEqual([{ type: 'list', ordered: false, items: ['one', 'two', 'three'] }]);
  });

  it('keeps ordered and unordered lists apart', () => {
    const blocks = parseBlocks('- a\n1. b');
    expect(blocks).toEqual([
      { type: 'list', ordered: false, items: ['a'] },
      { type: 'list', ordered: true, items: ['b'] },
    ]);
  });

  it('joins wrapped lines into one paragraph', () => {
    expect(parseBlocks('we are\nlooking for')).toEqual([
      { type: 'para', text: 'we are looking for' },
    ]);
  });

  it('starts a new paragraph on a blank line', () => {
    expect(parseBlocks('first\n\nsecond')).toEqual([
      { type: 'para', text: 'first' },
      { type: 'para', text: 'second' },
    ]);
  });

  it('treats a bare "Requirements:" label as a heading', () => {
    expect(parseBlocks('Requirements:')).toEqual([
      { type: 'heading', level: 3, text: 'Requirements' },
    ]);
  });

  it('reads a horizontal rule rather than a bullet', () => {
    expect(parseBlocks('---')).toEqual([{ type: 'rule' }]);
  });

  it('ignores a heading marker with nothing after it', () => {
    expect(parseBlocks('###')).toEqual([{ type: 'para', text: '###' }]);
  });

  it('returns nothing for empty input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
  });

  it('keeps a bullet and the paragraph before it separate', () => {
    expect(parseBlocks('You must:\n- code')).toEqual([
      { type: 'heading', level: 3, text: 'You must' },
      { type: 'list', ordered: false, items: ['code'] },
    ]);
  });
});

describe('looksLikeMarkdown', () => {
  it('is true when there is a heading or a list', () => {
    expect(looksLikeMarkdown('## Role')).toBe(true);
    expect(looksLikeMarkdown('- one\n- two')).toBe(true);
  });

  it('is false for ordinary prose, so plain descriptions are left alone', () => {
    expect(looksLikeMarkdown('We are hiring a writer.\n\nApply within.')).toBe(false);
  });

  it('is false for empty input', () => {
    expect(looksLikeMarkdown('')).toBe(false);
  });
});
