/**
 * Placeholder cards shown while results are being fetched.
 *
 * A search can take a few seconds - several pages across several keywords - and
 * without this the page just sits there looking finished. Skeletons say "more is
 * coming, and roughly this much".
 *
 * They are our own nodes, carrying neither a job link nor the site's card class,
 * so the scanner never mistakes one for a listing.
 */

const SKELETON_CLASS = 'ojrf-skeleton';
const DEFAULT_COUNT = 5;

function buildCard(doc) {
  const card = doc.createElement('div');
  card.className = SKELETON_CLASS;
  card.setAttribute('aria-hidden', 'true');

  card.innerHTML = `
    <div class="ojrf-sk-avatar"></div>
    <div class="ojrf-sk-body">
      <div class="ojrf-sk-line ojrf-sk-title"></div>
      <div class="ojrf-sk-chips"><span></span><span></span><span></span></div>
      <div class="ojrf-sk-line"></div>
      <div class="ojrf-sk-line ojrf-sk-short"></div>
    </div>
  `;

  return card;
}

/**
 * @param {Element|null} container where to append them
 * @returns {number} how many were shown
 */
export function showSkeletons(container, count = DEFAULT_COUNT, doc = document) {
  if (!container) return 0;

  hideSkeletons(doc);
  for (let index = 0; index < count; index += 1) {
    container.appendChild(buildCard(doc));
  }

  return count;
}

export function hideSkeletons(doc = document) {
  for (const card of doc.querySelectorAll(`.${SKELETON_CLASS}`)) card.remove();
}
