// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { replacePagination, restorePagination } from '../src/content/pagination.js';

const loc = (pathname, search = '?jobkeyword=') => ({ pathname, search });

function render() {
  document.body.innerHTML = `
    <ul class="pagination">
      <li class="page-item active page-link"><a>1</a></li>
      <li class="page-item page-link"><a href="/jobseekers/jobsearch/30?jobkeyword=">2</a></li>
      <li class="page-item page-link"><a href="/jobseekers/jobsearch/60?jobkeyword=">3</a></li>
    </ul>
  `;
}

const pager = () => document.getElementById('ojrf-pager');
const links = () => [...pager().querySelectorAll('a')].map((a) => a.getAttribute('href'));

beforeEach(render);

describe('replacePagination', () => {
  it('hides the site pager rather than removing it', () => {
    replacePagination({ span: 180, total: 180, loc: loc('/jobseekers/jobsearch') });

    const site = document.querySelector('ul.pagination');
    expect(site).not.toBeNull();
    expect(site.classList.contains('ojrf-part-hidden')).toBe(true);
    expect(pager()).not.toBeNull();
  });

  it('steps by the whole merged span, not by 30', () => {
    // 5 extra pages loaded means the screen covers 180 listings.
    replacePagination({ span: 180, total: 180, loc: loc('/jobseekers/jobsearch') });
    expect(links()).toEqual(['/jobseekers/jobsearch/180?jobkeyword=']);
  });

  it('steps further when more pages are merged', () => {
    replacePagination({ span: 330, total: 330, loc: loc('/jobseekers/jobsearch') });
    expect(links()).toEqual(['/jobseekers/jobsearch/330?jobkeyword=']);
  });

  it('offers both directions once past the first screen', () => {
    replacePagination({ span: 180, total: 180, loc: loc('/jobseekers/jobsearch/180') });
    expect(links()).toEqual([
      '/jobseekers/jobsearch/0?jobkeyword=',
      '/jobseekers/jobsearch/360?jobkeyword=',
    ]);
  });

  it('never steps back past the beginning', () => {
    replacePagination({ span: 180, total: 180, loc: loc('/jobseekers/jobsearch/60') });
    expect(links()[0]).toBe('/jobseekers/jobsearch/0?jobkeyword=');
  });

  it('disables Previous on the first screen', () => {
    replacePagination({ span: 180, total: 180, loc: loc('/jobseekers/jobsearch') });
    const previous = pager().querySelector('.ojrf-pager-disabled');
    expect(previous.textContent).toContain('Previous');
    expect(previous.tagName).toBe('SPAN'); // not a link
  });

  it('keeps the search query on both buttons', () => {
    replacePagination({
      span: 60,
      total: 60,
      loc: loc('/jobseekers/jobsearch/60', '?jobkeyword=writer'),
    });
    expect(links().every((href) => href.endsWith('?jobkeyword=writer'))).toBe(true);
  });

  it('reports the range on screen', () => {
    replacePagination({ span: 180, total: 180, loc: loc('/jobseekers/jobsearch/180') });
    expect(pager().querySelector('.ojrf-pager-status').textContent).toBe('181–360');
  });

  it('does nothing when the page has no pager', () => {
    document.body.innerHTML = '<div></div>';
    expect(replacePagination({ span: 180, loc: loc('/jobseekers/jobsearch') })).toBeNull();
  });

  it('replaces rather than stacks when called again', () => {
    replacePagination({ span: 180, total: 180, loc: loc('/jobseekers/jobsearch') });
    replacePagination({ span: 180, total: 180, loc: loc('/jobseekers/jobsearch') });
    expect(document.querySelectorAll('#ojrf-pager')).toHaveLength(1);
  });
});

describe('restorePagination', () => {
  it('gives the site pager back', () => {
    replacePagination({ span: 180, total: 180, loc: loc('/jobseekers/jobsearch') });
    restorePagination();

    expect(pager()).toBeNull();
    expect(document.querySelector('ul.pagination').classList.contains('ojrf-part-hidden')).toBe(
      false,
    );
  });
});
