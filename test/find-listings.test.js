// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  findListings,
  extractRateText,
  findResultsContainer,
} from '../src/content/find-listings.js';

/** Synthetic stand-in for the search results markup. */
function card({ title, salary, className = 'jobpost-cat-box' }) {
  return `
    <div class="${className}">
      <a href="/jobseekers/job/${title.replace(/\s+/g, '-')}-1">${title}</a>
      <div>Salary: ${salary}</div>
      <div>Hours per week: 40</div>
    </div>
  `;
}

function render(html) {
  document.body.innerHTML = `<div id="results">${html}</div>`;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findListings via known selectors', () => {
  it('finds every card and reads its salary', () => {
    render(
      card({ title: 'Virtual Assistant', salary: '$800/month' }) +
        card({ title: 'Data Entry', salary: 'P25,000/month' }) +
        card({ title: 'Designer', salary: 'Not specified' }),
    );

    const { source, listings, warning } = findListings(document);

    expect(source).toBe('selector');
    expect(listings).toHaveLength(3);
    expect(listings[0].title).toBe('Virtual Assistant');
    expect(listings[0].rateText).toBe('$800/month');
    expect(listings[1].rateText).toBe('P25,000/month');
    expect(listings[2].rateText).toBe('Not specified');
    expect(warning).toBeNull();
  });
});

describe('findListings fallback', () => {
  it('finds cards structurally when the class names are unrecognised', () => {
    render(
      card({ title: 'Writer', salary: '$700/month', className: 'brand-new-class' }) +
        card({ title: 'Editor', salary: '$900/month', className: 'brand-new-class' }),
    );

    const { source, listings } = findListings(document);

    expect(source).toBe('structure');
    expect(listings).toHaveLength(2);
    expect(listings.map((listing) => listing.rateText).sort()).toEqual([
      '$700/month',
      '$900/month',
    ]);
  });

  it('reports a warning and changes nothing when there are no listings', () => {
    document.body.innerHTML = '<div id="results"><p>No jobs matched.</p></div>';

    const { source, listings, warning } = findListings(document);

    expect(source).toBe('none');
    expect(listings).toHaveLength(0);
    expect(warning).toMatch(/no job listings found/i);
  });
});

describe('extractRateText', () => {
  it('stops at the next field label', () => {
    render(card({ title: 'VA', salary: '$800/month' }));
    const element = document.querySelector('.jobpost-cat-box');
    expect(extractRateText(element)).toBe('$800/month');
  });

  it('returns null when the card has no salary field', () => {
    render('<div class="jobpost-cat-box"><a href="/jobseekers/job/x-1">No salary here</a></div>');
    const element = document.querySelector('.jobpost-cat-box');
    expect(extractRateText(element)).toBeNull();
  });
});

describe('cards a keyword search returned', () => {
  it('carries the mark through as a fact, so the filter can trust the site', () => {
    render(
      '<div class="jobpost-cat-box" data-ojrf-search-hit="1">' +
        '<a href="/jobseekers/job/hit-1">Hit</a><div>Salary: $800/month</div></div>' +
        card({ title: 'Ordinary', salary: '$800/month' }),
    );

    const { listings } = findListings(document);
    expect(listings.map((entry) => entry.searchHit)).toEqual([true, false]);
  });
});

describe('findResultsContainer', () => {
  it('returns the element that holds every listing', () => {
    render(
      card({ title: 'A', salary: '$800/month' }) + card({ title: 'B', salary: '$900/month' }),
    );
    const { listings } = findListings(document);
    expect(findResultsContainer(listings).id).toBe('results');
  });

  it('returns null when there are no listings', () => {
    expect(findResultsContainer([])).toBeNull();
  });
});
