/**
 * The starter tags every job can be labelled with, and how a tag gets its colour.
 *
 * Tags are free-form - you can type anything - but a short list of sensible
 * defaults means you can label a job in one click instead of retyping "Day
 * Shift" for the hundredth time. Each default carries a colour so the board
 * reads at a glance; a tag you invent gets a neutral colour until you pick one.
 *
 * Pure data + helpers, no storage. The colours you save live in `tag-colors.js`.
 */

/** A tag with no colour of its own falls back to this neutral slate. */
export const DEFAULT_TAG_COLOR = '#94a3b8';

/** The tags offered for one-click selection, each with a starting colour. */
export const DEFAULT_TAGS = Object.freeze([
  { label: 'High Priority', color: '#dc2626' },
  { label: 'Urgent', color: '#ea580c' },
  { label: 'Day Shift', color: '#d97706' },
  { label: 'Night Shift', color: '#4f46e5' },
  { label: 'Long-term', color: '#16a34a' },
  { label: 'Dream Job', color: '#9333ea' },
  { label: 'Follow up', color: '#0d9488' },
  { label: 'Maybe', color: '#64748b' },
]);

const DEFAULT_MAP = new Map(DEFAULT_TAGS.map((t) => [t.label.toLowerCase(), t.color]));

/** The built-in colour for a tag, or null if it is not one of the defaults. */
export function defaultTagColor(tag) {
  return DEFAULT_MAP.get(String(tag ?? '').trim().toLowerCase()) ?? null;
}

/**
 * The colour a tag should render in: a colour you saved wins, then the default
 * for a built-in tag, then the neutral fallback. `colors` is the map from
 * `tag-colors.js` (keyed by the lower-cased tag).
 */
export function tagColor(tag, colors) {
  const lower = String(tag ?? '').trim().toLowerCase();
  const stored = colors && typeof colors.get === 'function' ? colors.get(lower) : undefined;
  return stored || defaultTagColor(tag) || DEFAULT_TAG_COLOR;
}

/**
 * A tinted chip style from a tag's colour: a light fill, readable ink, and a
 * soft edge. Shared by the board, the Saved tab and the job modal so every tag
 * chip looks the same wherever it shows.
 */
export function tagChipStyle(color) {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 16%, #ffffff)`,
    color: `color-mix(in srgb, ${color} 72%, #000000)`,
    borderColor: `color-mix(in srgb, ${color} 32%, #ffffff)`,
  };
}
