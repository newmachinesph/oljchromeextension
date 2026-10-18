import { ICONS } from '../core/icons.js';

/**
 * One icon, the same shapes the content scripts draw.
 *
 * The options page and the injected UI used to keep separate drawings of the
 * same idea - a bookmark here, a slightly different bookmark there - so a job
 * card and a board lane never quite matched. Both sides read core/icons.js now.
 *
 * The markup is Lucide's own path data from that module: literal strings in our
 * source, never anything a reader typed, so there is nothing here for an
 * injection to come from.
 *
 * `size` and `stroke` are props rather than fixed, because a 15px lane marker
 * and a 20px settings row want different weights of the same shape. An unknown
 * name renders nothing rather than throwing - a missing icon should be a gap,
 * not a blank page.
 */
export function Icon({ name, size = 16, stroke = 1.8, className = '', title = '' }) {
  const body = ICONS[name];
  if (!body) return null;

  const labelling = title
    ? { role: 'img', 'aria-label': title }
    : { 'aria-hidden': 'true', focusable: 'false' };

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className || undefined}
      {...labelling}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
