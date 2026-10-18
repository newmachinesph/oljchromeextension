/**
 * Whether a key press belongs to something the reader is typing into.
 *
 * Shared by the palette (a bare "/" opens it) and keyboard triage (j, k, d…),
 * both of which must stay silent while the reader is in a field - including
 * the site's own search box and our term input.
 */
export function isTyping(target) {
  const tag = target?.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target?.isContentEditable)
  );
}
