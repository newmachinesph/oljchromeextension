/**
 * Whether a listing is for someone starting out.
 *
 * A first-time applicant on this site has one question the filters above do
 * not answer: "could I actually get this?" Posters say so in the text - "no
 * experience needed", "we will train" - and they say the opposite just as
 * plainly - "3+ years", "send portfolio". Both are worth reading off the card.
 *
 * Three verdicts, not two. Most listings say neither, and for those the honest
 * answer is nothing: no chip, no filter effect. A listing is never judged
 * experienced by the absence of a welcome.
 *
 * Precedence is fixed: a requirement beats an invitation. Posters routinely
 * write "2 years experience, willing to learn" and mean the two years.
 *
 * Pure, and conservative in the same way red-flags.js is: each pattern is a
 * specific phrase. "Experience" alone is not a requirement; "2 years
 * experience" is. Seniority words ("senior", "manager") count only in the
 * title, because a body saying "report to the senior manager" is not about you.
 */

export const LEVELS = Object.freeze({
  BEGINNER: 'beginner',
  EXPERIENCED: 'experienced',
  UNCLEAR: 'unclear',
});

/** The three filter settings, in the order the pills show them. */
export const EXPERIENCE_FILTERS = Object.freeze([
  { value: 'all', label: 'Any level' },
  { value: 'beginner', label: 'Beginner-friendly' },
  { value: 'not-experienced', label: 'Hide experienced-only' },
]);

/**
 * @typedef {object} Phrase
 * @property {string} id
 * @property {string} label what the chip tooltip says matched
 * @property {RegExp} pattern
 * @property {boolean} [titleOnly] matched against the title alone
 */

/** @type {readonly Phrase[]} */
export const BEGINNER_PHRASES = Object.freeze([
  {
    id: 'no-experience',
    label: 'no experience needed',
    pattern:
      /\bno\s+(?:prior\s+|previous\s+)?experience\s+(?:needed|required|necessary|is\s+required|is\s+needed)\b|\bexperience\s+(?:is\s+)?not\s+(?:required|needed|necessary)\b|\bwithout\s+(?:any\s+)?experience\b/i,
  },
  {
    id: 'will-train',
    label: 'training provided',
    pattern:
      /\b(?:we\s+will|we'll|will)\s+(?:train|teach)\b|\btraining\s+(?:is\s+)?(?:provided|included|available)\b|\bpaid\s+training\b|\bwe\s+(?:provide|offer)\s+training\b|\bwe\s+(?:will\s+)?teach\s+you\b/i,
  },
  {
    id: 'newbies',
    label: 'newbies welcome',
    pattern:
      /\b(?:newbies?|beginners?|new\s*bies?|freshers?)\s+(?:are\s+)?(?:welcome|encouraged|ok|accepted)\b|\bopen\s+to\s+(?:newbies|beginners|freshers)\b|\bbeginner[-\s]?friendly\b/i,
  },
  {
    id: 'fresh-grad',
    label: 'fresh graduates welcome',
    pattern: /\bfresh\s+grad(?:uate)?s?\b/i,
  },
  {
    id: 'entry-level',
    label: 'entry level',
    pattern: /\bentry[-\s]?level\b/i,
  },
  {
    id: 'willing-to-learn',
    label: 'willing to learn is enough',
    pattern: /\bwilling(?:ness)?\s+to\s+learn\b/i,
  },
]);

/**
 * Roles that are entry-level by nature, matched on the title. A "Data Entry"
 * posting that says nothing about experience is still a beginner's job.
 */
export const ENTRY_ROLE_PHRASES = Object.freeze([
  {
    id: 'entry-role',
    label: 'an entry-level kind of role',
    titleOnly: true,
    pattern:
      /\b(?:data\s+entry|lead\s+gen(?:eration)?|appointment\s+sett(?:er|ing)|transcription(?:ist)?|chat\s+support|email\s+support|general\s+(?:virtual\s+)?assistant|general\s+va)\b/i,
  },
]);

/** @type {readonly Phrase[]} */
export const EXPERIENCED_PHRASES = Object.freeze([
  {
    id: 'years-required',
    label: 'years of experience required',
    // Three shapes: "2 years experience", "experience of 3 years", and
    // "at least 2 years". The captured number is checked afterwards so "0
    // years" never counts. The year word must be followed by an experience
    // word within a few tokens, so "2 years contract" does not match.
    pattern:
      /\b(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)(?:\s+of)?(?:\s+\w+){0,3}?\s+(?:experience|exp)\b|\bexperience[^.]{0,20}?\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b|\b(?:at\s+least|minimum(?:\s+of)?|min\.?)\s+(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i,
  },
  {
    id: 'experienced-only',
    label: 'experienced only',
    pattern:
      /\bexperienced\s+(?:only|applicants?\s+only|candidates?\s+only)\b|\bnot\s+for\s+(?:beginners|newbies|freshers)\b|\bno\s+(?:beginners|newbies)\b|\bmust\s+(?:be|have)\s+(?:an?\s+)?experienced\b|\bproven\s+(?:track\s+record|experience)\b/i,
  },
  {
    id: 'portfolio',
    label: 'asks for a portfolio or case studies',
    pattern:
      /\b(?:send|submit|share|include|attach|provide|show)\b[^.]{0,30}\b(?:portfolio|case\s+stud(?:y|ies)|work\s+samples?)\b|\bportfolio\s+(?:is\s+)?(?:required|needed|a\s+must)\b/i,
  },
  {
    id: 'certified',
    label: 'certification mentioned',
    pattern: /\b(?:certified|certification)\b/i,
  },
  {
    id: 'senior-title',
    label: 'a senior title',
    titleOnly: true,
    // "Specialist" is deliberately absent: on this site it names ordinary
    // roles ("Data Entry Specialist") far more often than senior ones.
    pattern: /\b(?:senior|sr\.?|lead|head|manager|director|expert)\b/i,
  },
]);

function text(value) {
  return typeof value === 'string' ? value : '';
}

function matchPhrase(phrase, title, body) {
  const haystack = phrase.titleOnly ? title : `${title}\n${body}`;
  if (haystack.length === 0) return false;

  const found = phrase.pattern.exec(haystack);
  if (!found) return false;

  // The years rule captures the number in one of three groups; a zero is a
  // way of saying no experience is needed, not a requirement.
  if (phrase.id === 'years-required') {
    const years = Number(found[1] ?? found[2] ?? found[3]);
    return Number.isFinite(years) && years >= 1;
  }
  return true;
}

function matchAll(phrases, title, body) {
  return phrases
    .filter((phrase) => matchPhrase(phrase, title, body))
    .map((phrase) => ({ id: phrase.id, label: phrase.label }));
}

/**
 * Judge one listing.
 *
 * @param {string} title
 * @param {string} body the card's text or the full description
 * @returns {{level: string, matched: Array<{id: string, label: string}>, why: string}}
 */
export function judgeExperience(title, body) {
  const t = text(title);
  const b = text(body);

  const experienced = matchAll(EXPERIENCED_PHRASES, t, b);
  if (experienced.length > 0) {
    return {
      level: LEVELS.EXPERIENCED,
      matched: experienced,
      why: experienced.map((m) => m.label).join(' · '),
    };
  }

  const beginner = [...matchAll(BEGINNER_PHRASES, t, b), ...matchAll(ENTRY_ROLE_PHRASES, t, b)];
  if (beginner.length > 0) {
    return {
      level: LEVELS.BEGINNER,
      matched: beginner,
      why: beginner.map((m) => m.label).join(' · '),
    };
  }

  return { level: LEVELS.UNCLEAR, matched: [], why: '' };
}

/** The chip text. Unclear says nothing, on purpose. */
export function describeLevel(level) {
  if (level === LEVELS.BEGINNER) return 'Beginner-friendly';
  if (level === LEVELS.EXPERIENCED) return 'Experienced';
  return '';
}

/**
 * Whether a listing at this level survives the filter setting.
 *
 * "beginner" is strict - unclear is hidden too, because someone who asked for
 * beginner-friendly jobs asked for the ones that say so. "not-experienced" is
 * lenient - only the ones that state a requirement go.
 */
export function passesExperienceFilter(level, filter) {
  if (filter === 'beginner') return level === LEVELS.BEGINNER;
  if (filter === 'not-experienced') return level !== LEVELS.EXPERIENCED;
  return true;
}

export function isExperienceFilter(value) {
  return EXPERIENCE_FILTERS.some((entry) => entry.value === value);
}
