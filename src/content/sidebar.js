/**
 * Relocating our skill cloud and job-type pills into the page's sidebar.
 *
 * The site's own "Filter by skills" panel lives there, and it is the one control
 * we cannot reasonably reuse: it is keyed by numeric skill IDs. Ours does the
 * same job by matching the labels already on each card, so it takes that slot -
 * a tall narrow column suits a long skill list far better than a scrolling strip
 * inside the control bar.
 *
 * The rows are *moved*, not rebuilt, so every listener built in control-bar.js
 * travels with them.
 */

const PANEL_ID = 'ojrf-sidebar';
const SITE_PANEL = '.refine-search';
const PART_HIDDEN = 'ojrf-part-hidden';

/**
 * @param {Element[]} rows row elements to move into the sidebar
 * @returns {boolean} whether the sidebar was found and used
 */
export function mountSidebar(rows, doc = document) {
  const sitePanel = doc.querySelector(SITE_PANEL);
  if (!sitePanel) return false;

  sitePanel.classList.add(PART_HIDDEN);

  let panel = doc.getElementById(PANEL_ID);
  if (!panel) {
    panel = doc.createElement('aside');
    panel.id = PANEL_ID;
    // Same styling scope as the bar, so the moved rows keep their appearance.
    panel.className = 'ojrf-ui';

    const heading = doc.createElement('div');
    heading.className = 'ojrf-sidebar-heading';
    heading.textContent = 'Filter';
    panel.appendChild(heading);

    sitePanel.parentElement?.insertBefore(panel, sitePanel);
  }

  for (const row of rows) {
    if (row) panel.appendChild(row);
  }

  return true;
}

/**
 * Give the site's panel back, returning our rows so the caller can put them
 * wherever it likes (in practice, back into the control bar).
 *
 * @returns {Element[]} the rows that were in the sidebar
 */
export function restoreSidebar(doc = document) {
  const panel = doc.getElementById(PANEL_ID);
  const rows = panel ? Array.from(panel.querySelectorAll('.ojrf-row')) : [];

  panel?.remove();
  doc.querySelector(SITE_PANEL)?.classList.remove(PART_HIDDEN);

  return rows;
}
