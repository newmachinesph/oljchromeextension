import { describe, it, expect } from 'vitest';
import { ICONS, ICON_NAMES, hasIcon, iconMarkup } from '../src/core/icons.js';
import { WIDGETS } from '../src/core/dock.js';

describe('the icon set', () => {
  it('has an icon for every widget in the dock', () => {
    // A widget whose icon name is missing draws an empty square in the dock,
    // which looks like a broken build rather than a missing asset.
    for (const widget of WIDGETS) {
      expect(hasIcon(widget.icon), `${widget.id} -> ${widget.icon}`).toBe(true);
    }
  });

  it('has one for every lane the board ships', () => {
    for (const lane of [
      'saved',
      'preparing',
      'applied',
      'replied',
      'interviewing',
      'offer',
      'hired',
      'rejected',
      'custom',
    ]) {
      expect(hasIcon(`lane-${lane}`), lane).toBe(true);
    }
  });

  it('holds drawings, not whole documents', () => {
    /*
     * The generator strips Lucide's <svg> wrapper, because the caller supplies
     * one with the size and stroke it wants. A nested <svg> would render at the
     * library's own 24px no matter what was asked for.
     */
    for (const [name, body] of Object.entries(ICONS)) {
      expect(body, name).not.toContain('<svg');
      expect(body, name).not.toContain('</svg>');
      expect(body.length, name).toBeGreaterThan(0);
    }
  });

  it('carries no hard-coded stroke width of its own', () => {
    // Everything takes the caller's weight; a baked stroke-width here is
    // exactly the drift this module exists to end.
    for (const [name, body] of Object.entries(ICONS)) {
      expect(body, name).not.toMatch(/stroke-width=/);
    }
  });

  it('names every icon uniquely', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});

describe('iconMarkup', () => {
  it('wraps the drawing at the size and weight asked for', () => {
    const svg = iconMarkup('clock', { size: 13, stroke: 1.9 });
    expect(svg).toContain('width="13"');
    expect(svg).toContain('height="13"');
    expect(svg).toContain('stroke-width="1.9"');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it('keeps the 24-unit grid whatever the pixel size', () => {
    // Scaling happens through width/height; changing the viewBox would crop.
    for (const size of [10, 16, 22, 40]) {
      expect(iconMarkup('board', { size })).toContain('viewBox="0 0 24 24"');
    }
  });

  it('is hidden from screen readers unless it is given a name', () => {
    // An icon beside its own label is decoration and should be skipped; an
    // icon that IS the label needs announcing.
    expect(iconMarkup('cross')).toContain('aria-hidden="true"');
    const labelled = iconMarkup('cross', { title: 'Dismiss' });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Dismiss"');
    expect(labelled).not.toContain('aria-hidden');
  });

  it('adds a class only when asked', () => {
    expect(iconMarkup('tag')).not.toContain('class=');
    expect(iconMarkup('tag', { className: 'ojrf-icon' })).toContain('class="ojrf-icon"');
  });

  it('returns nothing for a name we do not have', () => {
    // A gap in a toolbar, not a dead page on someone's job search.
    expect(iconMarkup('weather')).toBe('');
    expect(iconMarkup(null)).toBe('');
    expect(iconMarkup(undefined)).toBe('');
  });

  it('inherits colour from whatever it sits in', () => {
    expect(iconMarkup('bell')).toContain('stroke="currentColor"');
    expect(iconMarkup('bell')).toContain('fill="none"');
  });
});
