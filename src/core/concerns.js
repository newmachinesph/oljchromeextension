/**
 * Every reason to read a listing carefully, gathered into one place.
 *
 * The card used to carry a chip per warning - a phrase flag here, a staleness
 * note there, an arrow on the rate - and a reader had to notice each of them
 * separately. This folds them into a single list so the row can show one chip
 * that says "asks for money +2" and a tooltip that says the rest.
 *
 * Pure. It only arranges what other modules already decided: which phrases
 * matched, how long the role has been advertised, where the rate stands, and
 * what a job page said about the employer when you opened one. Nothing here
 * reads a page or decides to hide anything.
 */

/**
 * @typedef {object} Concern
 * @property {string} id
 * @property {string} label short, for the chip
 * @property {string} why one line, for the tooltip
 */

const WHY = {
  newEmployer:
    'The employer account was created recently, which a job page you opened showed.',
  censored:
    'Links and contact details were removed from a post by this employer, which the site does for accounts without a paid plan.',
  stale: 'This role has been advertised for a while; everyone who applied turned it down or left.',
  belowRate: 'Pays less than most listings asking for the same skills.',
};

/**
 * Arrange the concerns for one listing.
 *
 * Order is severity, fixed: phrase flags lead (they cost you money), then what
 * is known about the employer, then how long the role has been open, then how
 * the pay compares. The chip shows the first, so the first must be the one to
 * read before anything else.
 *
 * @param {object} [input]
 * @param {Array<{id: string, label: string, why: string}>} [input.flags] from findRedFlags
 * @param {string} [input.staleness] from describeStaleness, '' when not stale
 * @param {string|null} [input.standingTone] from standingTone: 'low' | 'high' | null
 * @param {{newAccount?: boolean|null, censored?: boolean|null}|null} [input.employerMemory]
 * @returns {Concern[]}
 */
export function gatherConcerns({
  flags = [],
  staleness = '',
  standingTone = null,
  employerMemory = null,
} = {}) {
  const list = [];

  for (const flag of flags ?? []) {
    list.push({ id: flag.id, label: flag.label, why: flag.why });
  }

  if (employerMemory?.newAccount) {
    list.push({ id: 'new-employer', label: 'new employer', why: WHY.newEmployer });
  }
  if (employerMemory?.censored) {
    list.push({ id: 'censored', label: 'censored post', why: WHY.censored });
  }

  if (staleness) {
    list.push({ id: 'stale', label: staleness, why: WHY.stale });
  }

  if (standingTone === 'low') {
    list.push({ id: 'below-rate', label: 'below going rate', why: WHY.belowRate });
  }

  return list;
}

/**
 * "asks for money +2" - the first concern, and how many more there are.
 *
 * A suffix rather than a bare count: "3 concerns" tells you nothing until you
 * hover, while the leading label is already the most important thing to know.
 */
export function describeConcerns(list) {
  const concerns = list ?? [];
  if (concerns.length === 0) return '';
  const rest = concerns.length - 1;
  return rest > 0 ? `${concerns[0].label} +${rest}` : concerns[0].label;
}

/** The full reasoning, one per line, for a tooltip or the modal. */
export function explainConcerns(list) {
  return (list ?? []).map((concern) => `${concern.label}: ${concern.why}`).join('\n');
}
