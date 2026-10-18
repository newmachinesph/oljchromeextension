// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountSidebar, restoreSidebar } from '../src/content/sidebar.js';

function row(className) {
  const el = document.createElement('div');
  el.className = `ojrf-row ${className}`;
  el.textContent = className;
  return el;
}

function render({ withSidebar = true } = {}) {
  document.body.innerHTML = withSidebar
    ? `<div class="col-md-3">
         <div class="refine-search"><h4>Filter by skills:</h4></div>
       </div>
       <div id="ojrf-bar"></div>`
    : '<div id="ojrf-bar"></div>';
}

const panel = () => document.getElementById('ojrf-sidebar');
const sitePanel = () => document.querySelector('.refine-search');

beforeEach(() => render());

describe('mountSidebar', () => {
  it('takes the slot of the site panel, hiding rather than removing it', () => {
    expect(mountSidebar([row('ojrf-row-skills')])).toBe(true);

    expect(sitePanel()).not.toBeNull();
    expect(sitePanel().classList.contains('ojrf-part-hidden')).toBe(true);
    expect(panel()).not.toBeNull();
    expect(panel().nextElementSibling).toBe(sitePanel());
  });

  it('moves the rows it is given, in order', () => {
    const skills = row('ojrf-row-skills');
    const types = row('ojrf-row-pills');
    mountSidebar([skills, types]);

    expect([...panel().querySelectorAll('.ojrf-row')]).toEqual([skills, types]);
  });

  it('keeps the same elements, so their listeners survive the move', () => {
    const skills = row('ojrf-row-skills');
    let clicks = 0;
    skills.addEventListener('click', () => {
      clicks += 1;
    });

    mountSidebar([skills]);
    panel().querySelector('.ojrf-row-skills').dispatchEvent(new window.Event('click'));

    expect(clicks).toBe(1);
  });

  it('reports failure when the page has no sidebar, leaving rows alone', () => {
    render({ withSidebar: false });
    const skills = row('ojrf-row-skills');
    document.getElementById('ojrf-bar').appendChild(skills);

    expect(mountSidebar([skills])).toBe(false);
    expect(panel()).toBeNull();
    // Still in the bar, where it was built.
    expect(skills.parentElement.id).toBe('ojrf-bar');
  });

  it('tolerates a missing row', () => {
    expect(mountSidebar([null, row('ojrf-row-pills')])).toBe(true);
    expect(panel().querySelectorAll('.ojrf-row')).toHaveLength(1);
  });

  it('does not stack panels when called twice', () => {
    mountSidebar([row('ojrf-row-skills')]);
    mountSidebar([row('ojrf-row-pills')]);
    expect(document.querySelectorAll('#ojrf-sidebar')).toHaveLength(1);
  });
});

describe('restoreSidebar', () => {
  it('gives the site panel back and hands the rows over', () => {
    const skills = row('ojrf-row-skills');
    const types = row('ojrf-row-pills');
    mountSidebar([skills, types]);

    const returned = restoreSidebar();

    expect(returned).toEqual([skills, types]);
    expect(panel()).toBeNull();
    expect(sitePanel().classList.contains('ojrf-part-hidden')).toBe(false);
  });

  it('is safe when nothing was mounted', () => {
    expect(restoreSidebar()).toEqual([]);
  });
});
