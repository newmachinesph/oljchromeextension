/**
 * Starting points, shipped with the extension.
 *
 * The hard part of searching this site is not the filtering, it is the
 * vocabulary. Automation work is advertised as "n8n", "make.com", "GHL" and
 * "GoHighLevel" far more often than as "automation", so someone who types the
 * obvious word sees a fraction of what is there. A preset is mostly a list of
 * the words employers actually use.
 *
 * The numbers below are measured, not guessed. Across 180 live listings:
 *
 *   AI / automation / CRM vocabulary   27 listings   median $1,230/mo
 *   everything else                   153 listings   median   $800/mo
 *   CRM tooling specifically           10 listings   median $1,600/mo
 *
 * Each threshold sits near the median of its own cluster rather than at one
 * global figure, because "underpaid" means something different per niche - the
 * whole reason a single threshold is a blunt instrument.
 *
 * Shipped rather than shared. A preset that could travel between people would
 * have to carry custom parser rules to be worth much, and those are regular
 * expressions: importing a stranger's means running their regex over every
 * listing on your page. Curating a few here costs no server and no trust.
 *
 * Two of the thresholds are measured; the rest are starting points set near the
 * site median and marked as such. Saying which is which matters - a number
 * presented as evidence should be evidence.
 *
 * These will drift as the site's vocabulary does. They are ordinary data, meant
 * to be edited.
 */

/** Groups, in the order the picker shows them. */
export const PRESET_GROUPS = Object.freeze([
  'Tech & automation',
  'Creative',
  'Business & admin',
  'Finance & operations',
]);

/**
 * @typedef {object} Preset
 * @property {string} name shown in the palette and the options page
 * @property {string} hint one line on who it is for
 * @property {object} filters same shape as a saved search's filters
 */

/** @type {readonly Preset[]} */
export const PRESETS = Object.freeze([
  {
    name: 'AI & Automation',
    group: 'Tech & automation',
    level: 'senior',
    measured: true,
    hint: 'Pays about 54% above the site median, and is mostly advertised by tool name',
    filters: {
      thresholdUsdPerMonth: 1000,
      searchKeywords: [
        'AI automation',
        'automation specialist',
        'n8n',
        'make.com',
        'zapier',
        'GoHighLevel',
        'GHL',
        'workflow automation',
        'prompt engineer',
        'AI specialist',
        'API integration',
        'chatbot',
      ],
      excludeKeywords: [],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'Executive & Admin VA',
    group: 'Business & admin',
    level: 'beginner',
    measured: true,
    hint: 'The largest category on the site, and the one most padded with low offers',
    filters: {
      thresholdUsdPerMonth: 600,
      searchKeywords: [
        'executive assistant',
        'virtual assistant',
        'administrative assistant',
        'appointment setting',
        'calendar management',
        'inbox management',
        'data entry',
        'operations coordinator',
      ],
      // The two phrases that most often turn out to mean commission-only sales.
      excludeKeywords: ['commission only', 'unpaid'],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'Design & Video',
    group: 'Creative',
    level: 'mid',
    measured: false,
    hint: 'Creative work, where per-task pricing is common and worth watching for',
    filters: {
      thresholdUsdPerMonth: 700,
      searchKeywords: [
        'video editor',
        'graphic designer',
        'motion graphics',
        'premiere pro',
        'after effects',
        'canva',
        'photoshop',
        'thumbnail designer',
        'short form video',
      ],
      excludeKeywords: [],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'Development',
    group: 'Tech & automation',
    level: 'senior',
    measured: false,
    hint: 'Engineering roles, which carry the widest spread of any group here',
    filters: {
      thresholdUsdPerMonth: 1200,
      searchKeywords: [
        'developer',
        'full stack',
        'front end developer',
        'backend developer',
        'react',
        'node.js',
        'python developer',
        'laravel',
        'wordpress developer',
        'shopify developer',
      ],
      excludeKeywords: [],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'Writing & Content',
    group: 'Creative',
    level: 'mid',
    measured: false,
    hint: 'Where per-article pricing hides how little an hour actually pays',
    filters: {
      thresholdUsdPerMonth: 600,
      searchKeywords: [
        'content writer',
        'copywriter',
        'blog writer',
        'SEO writer',
        'technical writer',
        'ghostwriter',
        'social media content',
      ],
      excludeKeywords: ['per article', 'per word'],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'Sales & Marketing',
    group: 'Business & admin',
    level: 'mid',
    measured: false,
    hint: 'Excludes commission-only offers, which are most of what this term returns',
    filters: {
      thresholdUsdPerMonth: 700,
      searchKeywords: [
        'sales development',
        'lead generation',
        'appointment setter',
        'email marketing',
        'media buyer',
        'marketing manager',
        'SEO specialist',
      ],
      // The single most common way a "$3,000/mo" listing turns out to pay nothing.
      excludeKeywords: ['commission only', 'commission-based', 'unpaid'],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'Customer Support',
    group: 'Business & admin',
    level: 'beginner',
    measured: false,
    hint: 'Shift work, so the hourly reading matters more here than the monthly one',
    filters: {
      thresholdUsdPerMonth: 500,
      searchKeywords: [
        'customer support',
        'customer service',
        'technical support',
        'help desk',
        'chat support',
        'client success',
      ],
      excludeKeywords: [],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'First job: beginner-friendly',
    group: 'Business & admin',
    level: 'beginner',
    measured: false,
    hint: 'Only listings that say they welcome beginners or will train, at the default floor',
    filters: {
      thresholdUsdPerMonth: 500,
      searchKeywords: [
        'virtual assistant',
        'data entry',
        'admin assistant',
        'appointment setter',
        'chat support',
        'no experience',
      ],
      excludeKeywords: [],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
      experienceFilter: 'beginner',
    },
  },
  {
    name: 'Bookkeeping & Accounting',
    group: 'Finance & operations',
    level: 'mid',
    measured: false,
    hint: 'Certification is usually named outright, which makes the terms specific',
    filters: {
      thresholdUsdPerMonth: 700,
      searchKeywords: [
        'bookkeeper',
        'accountant',
        'accounts payable',
        'accounts receivable',
        'xero',
        'quickbooks',
        'payroll',
        'financial analyst',
      ],
      excludeKeywords: [],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'Data & Analytics',
    group: 'Tech & automation',
    level: 'mid',
    measured: false,
    hint: 'Named by tool more often than by role, the same as automation work',
    filters: {
      thresholdUsdPerMonth: 900,
      searchKeywords: [
        'data analyst',
        'data entry specialist',
        'power bi',
        'tableau',
        'sql',
        'google data studio',
        'looker studio',
        'data visualization',
      ],
      excludeKeywords: [],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'Social Media',
    group: 'Creative',
    level: 'beginner',
    measured: false,
    hint: 'Often bundled with unpaid "exposure" work, so the exclusions matter',
    filters: {
      thresholdUsdPerMonth: 550,
      searchKeywords: [
        'social media manager',
        'community manager',
        'content creator',
        'tiktok',
        'instagram manager',
        'youtube manager',
        'social media specialist',
      ],
      excludeKeywords: ['commission only', 'unpaid', 'exposure'],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'E-commerce Ops',
    group: 'Finance & operations',
    level: 'mid',
    measured: false,
    hint: 'Platform names are the search terms - the role titles vary wildly',
    filters: {
      thresholdUsdPerMonth: 700,
      searchKeywords: [
        'amazon fba',
        'shopify manager',
        'product listing',
        'ecommerce manager',
        'inventory management',
        'order fulfillment',
        'dropshipping',
      ],
      excludeKeywords: [],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
  {
    name: 'Recruiting & HR',
    group: 'Finance & operations',
    level: 'mid',
    measured: false,
    hint: 'Recruiters post about recruiting, so the terms need to be specific',
    filters: {
      thresholdUsdPerMonth: 700,
      searchKeywords: [
        'recruiter',
        'talent acquisition',
        'hr assistant',
        'sourcing specialist',
        'onboarding specialist',
        'hr generalist',
      ],
      excludeKeywords: ['commission only'],
      requiredSkills: [],
      hiddenJobTypes: [],
      maxAgeDays: 0,
    },
  },
]);

/** Look one up by name, loosely, so the palette can pass what the user typed. */
export function findPreset(name) {
  const wanted = String(name ?? '')
    .toLowerCase()
    .trim();
  return PRESETS.find((preset) => preset.name.toLowerCase() === wanted) ?? null;
}

/** Presets under each group heading, skipping groups with nothing in them. */
export function presetsByGroup() {
  return PRESET_GROUPS.map((group) => ({
    group,
    presets: PRESETS.filter((preset) => preset.group === group),
  })).filter((entry) => entry.presets.length > 0);
}
