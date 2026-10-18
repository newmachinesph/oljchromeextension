// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { showSkeletons, hideSkeletons } from '../src/content/skeleton.js';
import { findListings } from '../src/content/find-listings.js';

const container = () => document.getElementById('results');
const skeletons = () => document.querySelectorAll('.ojrf-skeleton');

beforeEach(() => {
  document.body.innerHTML = '<div id="results"></div>';
});

describe('showSkeletons', () => {
  it('fills the results area with placeholders', () => {
    expect(showSkeletons(container(), 4)).toBe(4);
    expect(skeletons()).toHaveLength(4);
  });

  it('renders the parts of a card', () => {
    showSkeletons(container(), 1);
    const card = skeletons()[0];

    expect(card.querySelector('.ojrf-sk-avatar')).not.toBeNull();
    expect(card.querySelector('.ojrf-sk-title')).not.toBeNull();
    expect(card.querySelectorAll('.ojrf-sk-chips span')).toHaveLength(3);
  });

  it('replaces any it already showed rather than stacking', () => {
    showSkeletons(container(), 5);
    showSkeletons(container(), 3);
    expect(skeletons()).toHaveLength(3);
  });

  it('is never mistaken for a listing', () => {
    // No job link and no card class, so the scanner passes them over.
    showSkeletons(container(), 5);
    expect(findListings(document).listings).toHaveLength(0);
  });

  it('is hidden from assistive technology', () => {
    showSkeletons(container(), 1);
    expect(skeletons()[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('does nothing without a container', () => {
    expect(showSkeletons(null, 4)).toBe(0);
    expect(skeletons()).toHaveLength(0);
  });
});

describe('hideSkeletons', () => {
  it('clears them all', () => {
    showSkeletons(container(), 5);
    hideSkeletons();
    expect(skeletons()).toHaveLength(0);
  });

  it('leaves the real listings alone', () => {
    container().innerHTML = '<div class="jobpost-cat-box">real</div>';
    showSkeletons(container(), 3);
    hideSkeletons();

    expect(container().querySelectorAll('.jobpost-cat-box')).toHaveLength(1);
  });

  it('is safe when none are showing', () => {
    expect(() => hideSkeletons()).not.toThrow();
  });
});
