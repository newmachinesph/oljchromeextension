/**
 * Widening the page.
 *
 * The site caps the results area at Bootstrap's container width, which wastes
 * most of a wide screen - and our sidebar wants more room than the 25% column
 * the site allots it.
 *
 * Everything is done by toggling one class on <html> and one custom property.
 * The width rules themselves live in content.css under that class, so removing
 * it puts the site's own layout back exactly, with nothing to unwind.
 */

const WIDE_CLASS = 'ojrf-wide';
const WIDTH_VAR = '--ojrf-sidebar-width';
const PART_HIDDEN = 'ojrf-part-hidden';

/** The site's own search bar above the results. */
const SITE_SEARCH = 'form.form-search, form#myform';

/** Page furniture that is never ours to hide, whatever it happens to contain. */
const SITE_CHROME = 'nav, header, .navbar';

/**
 * The search form belonging to the results, which is not always the first one.
 *
 * Signed out there is exactly one. Signed in the site adds a second search form
 * to the header, earlier in the document - so taking the first match hid the
 * navbar's row and left the real search bar on screen. Both symptoms, one
 * mistake.
 */
function findResultsSearch(doc) {
  const forms = Array.from(doc.querySelectorAll(SITE_SEARCH)).filter(
    (form) => !form.closest(SITE_CHROME),
  );

  return forms.find((form) => form.closest('.jobseeker-search')) ?? forms[0] ?? null;
}

/**
 * Hide or restore the site's search bar.
 *
 * Ours holds several terms at once and searches them together, so theirs is a
 * narrower version of a control we already provide. Hidden by class, never
 * removed, so switching this off gives it straight back.
 */
export function setSiteSearchHidden(hidden, doc = document) {
  const form = findResultsSearch(doc);
  if (!form) return;

  // Hide the row wrapping the form rather than the form alone: the wrapper keeps
  // its own height and leaves a band of empty space at the top of the page.
  //
  // Only when that row holds nothing else worth keeping - checked rather than
  // assumed, because a row that also carries navigation is not ours to remove.
  const row = form.closest('.row');
  const target = row && !row.querySelector(SITE_CHROME) ? row : form;

  target.classList.toggle(PART_HIDDEN, Boolean(hidden));
}

export function applyLayout({ wide, sidebarWidth }, doc = document) {
  const root = doc.documentElement;

  root.classList.toggle(WIDE_CLASS, Boolean(wide));

  if (wide && Number.isFinite(sidebarWidth)) {
    root.style.setProperty(WIDTH_VAR, `${sidebarWidth}px`);
  } else {
    root.style.removeProperty(WIDTH_VAR);
  }
}

export function resetLayout(doc = document) {
  const root = doc.documentElement;
  root.classList.remove(WIDE_CLASS);
  root.style.removeProperty(WIDTH_VAR);
  setSiteSearchHidden(false, doc);
}
