/**
 * A local, deterministic skill match between your skills and a job post.
 *
 * Not the AI "job fit" - that reasons about the whole post and costs a credit.
 * This just checks which of your listed skills the post actually mentions, so
 * you can see "4 of your 7 skills" at a glance before deciding to read more. No
 * model, no network: plain word matching over text you are already looking at.
 */

/** A skill "appears" when its whole word/phrase is in the text, case-insensitively. */
function mentions(haystack, skill) {
  const esc = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Bounded by non-alphanumerics so "react" does not match "reactor", but
  // multi-word skills ("google workspace") still match as written.
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(haystack);
}

/**
 * Which of `skills` the `text` mentions, and which it does not.
 *
 * @param {string} text the job post (title + description)
 * @param {string[]} skills your skills
 * @returns {{matched: string[], missing: string[], total: number, score: number|null}}
 *   score is matched/total in 0..1, or null when you have listed no skills.
 */
export function matchSkills(text, skills) {
  const hay = String(text ?? '').toLowerCase();
  const list = Array.isArray(skills) ? skills.map((s) => String(s ?? '').trim()).filter(Boolean) : [];
  const seen = new Set();
  const matched = [];
  const missing = [];
  for (const skill of list) {
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (mentions(hay, key)) matched.push(skill);
    else missing.push(skill);
  }
  const total = matched.length + missing.length;
  return { matched, missing, total, score: total ? matched.length / total : null };
}
