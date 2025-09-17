/**
 * @file config.js
 * @description Centralised configuration shared across the server, scrapers
 * and background jobs. Values are derived from environment variables where
 * available and fall back to sensible defaults for local development. The
 * module intentionally exposes scraper pagination settings so individual
 * sources can override behaviour without code changes.
 */
const path = require('path');

/**
 * Parse a comma-separated environment variable into an array of CSS selectors.
 * Empty values are discarded and the list is cloned to avoid accidental
 * mutation when the configuration is consumed elsewhere.
 *
 * @param {string|string[]} value - Value taken from the environment or config
 * @param {string[]} fallback - Default selectors when no value is provided
 * @returns {string[]} normalised selector list
 */
function parseSelectorList(value, fallback = []) {
  if (Array.isArray(value) && value.length > 0) {
    return value.map(selector => selector.trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map(selector => selector.trim())
      .filter(Boolean);
  }
  return [...fallback];
}

/**
 * Convert an environment string into a positive integer, falling back to a
 * default when parsing fails or the provided value is out of range.
 *
 * @param {string|number|undefined} value - User supplied value to parse
 * @param {number} fallback - Default integer to use when parsing fails
 * @returns {number} a positive integer suitable for pagination limits
 */
function parsePositiveInt(value, fallback) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num <= 0) {
    return fallback;
  }
  return num;
}

const DEFAULT_NAV_SELECTORS = [
  'nav[role="navigation"]',
  'nav.pagination',
  '.pagination',
  'ul.pagination',
  'ol.pagination',
  '.pager',
  '.paging'
];

const DEFAULT_NEXT_LINK_SELECTORS = [
  'a[rel="next"]',
  'link[rel="next"]',
  'a[aria-label*="next" i]',
  'a[title*="next" i]',
  'a.next',
  'li.next a',
  '.next a'
];

// Standard pagination configuration applied to every source unless overridden.
// Exposed so individual sources can tweak selector lists or page limits.
const defaultPagination = {
  maxPages: parsePositiveInt(process.env.PAGINATION_MAX_PAGES, 25),
  navSelectors: parseSelectorList(
    process.env.PAGINATION_NAV_SELECTORS,
    DEFAULT_NAV_SELECTORS
  ),
  nextLinkSelectors: parseSelectorList(
    process.env.PAGINATION_NEXT_SELECTORS,
    DEFAULT_NEXT_LINK_SELECTORS
  ),
  pageNumberPattern:
    (process.env.PAGINATION_PAGE_NUMBER_PATTERN || '\\d+').trim() || '\\d+',
  detectLoops: process.env.PAGINATION_DETECT_LOOPS === 'false' ? false : true
};

// Centralised configuration object used throughout the server code. Values can
// be overridden via environment variables for flexibility in different
// deployment environments.

// Default data source pointing at the UK government's Contracts Finder site.
const defaultSource = {
  label: 'Contracts Finder',
  // Contracts Finder exposes an RSS feed which is easier to scrape than the
  // JavaScript-heavy search page.
  url:
    process.env.SCRAPE_URL ||
    'https://www.contractsfinder.service.gov.uk/RSSFeed.aspx?type=Projects&Status=Open',
  base:
    process.env.SCRAPE_BASE ||
    'https://www.contractsfinder.service.gov.uk',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

// Other sources previously included here have been removed as they either no
// longer work or never provided reliable results. A small selection is kept to
// demonstrate multiple scraping strategies.
//
// Sources can optionally define a `selectors` object describing CSS selectors
// for the title, link, date and description fields. When provided the scraper
// delegates parsing to the generic CSS-driven parser, making it easy to add new
// HTML portals without shipping additional code.

const euSupplySource = {
  label: 'EU Supply UK',
  url:
    process.env.EUSUPPLY_URL ||
    'https://uk.eu-supply.com/ctm/supplier/publictenders?B=UK',
  base: process.env.EUSUPPLY_BASE || 'https://uk.eu-supply.com',
  parser: 'generic',
  selectors: {
    // Each row in the tender listing table contains a single opportunity.
    item: 'tr',
    title: 'a',
    link: { selector: 'a', attr: 'href' },
    date: ['time', 'td:nth-child(3)'],
    description: ['td.description', 'p']
  },
  pagination: { ...defaultPagination }
};

// Example Sell2Wales source used by the additional `sell2wales` parser.
const sell2walesSource = {
  label: 'Sell2Wales',
  // RSS feed provides server-rendered listings without needing scripting.
  url:
    process.env.SELL2WALES_URL ||
    'https://www.sell2wales.gov.wales/rss/authority',
  base: process.env.SELL2WALES_BASE || 'https://www.sell2wales.gov.wales',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

// Example UKRI opportunities source.
const ukriSource = {
  label: 'UKRI',
  // Opportunities feed published by UKRI.
  url: process.env.UKRI_URL || 'https://www.ukri.org/feed/',
  base: process.env.UKRI_BASE || 'https://www.ukri.org',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

// Additional procurement portals that expose RSS feeds. These are included as
// examples and may require adjusting the URLs depending on the organisation.
const pcsSource = {
  label: 'Public Contracts Scotland',
  url:
    process.env.PCS_URL ||
    'https://www.publiccontractsscotland.gov.uk/rss/rss.xml',
  base: process.env.PCS_BASE || 'https://www.publiccontractsscotland.gov.uk',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const etendersniSource = {
  label: 'eTenders NI',
  url:
    process.env.ETENDERSNI_URL ||
    'https://etendersni.gov.uk/epps/cft/list?ext_t=RSS',
  base: process.env.ETENDERSNI_BASE || 'https://etendersni.gov.uk',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const etendersIEsource = {
  label: 'eTenders Ireland',
  url:
    process.env.ETENDERSIE_URL ||
    'https://www.etenders.gov.ie/feeds/rss',
  base: process.env.ETENDERSIE_BASE || 'https://www.etenders.gov.ie',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const procontractSource = {
  label: 'ProContract',
  url:
    process.env.PROCONTRACT_URL ||
    'https://procontract.due-north.com/rss/rss.xml',
  base: process.env.PROCONTRACT_BASE || 'https://procontract.due-north.com',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const intendSource = {
  label: 'In-Tend',
  url: process.env.INTEND_URL || 'https://in-tendhost.co.uk/feed/',
  base: process.env.INTEND_BASE || 'https://in-tendhost.co.uk',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

// Sources providing information on awarded contracts. These mirror the
// structure of the tender sources above but point to award notices instead of
// current opportunities. URLs are illustrative and may need adjusting for real
// deployments.
const defaultAwardSource = {
  label: 'Contracts Finder Awards',
  url:
    process.env.AWARD_URL ||
    'https://www.contractsfinder.service.gov.uk/RSSFeed.aspx?type=Projects&Status=Awarded',
  base:
    process.env.AWARD_BASE ||
    'https://www.contractsfinder.service.gov.uk',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const euSupplyAwardSource = {
  label: 'EU Supply Awards',
  url:
    process.env.EUSUPPLY_AWARD_URL ||
    'https://uk.eu-supply.com/ctm/award/publiccontracts?B=UK',
  base: process.env.EUSUPPLY_AWARD_BASE || 'https://uk.eu-supply.com',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const sell2walesAwardSource = {
  label: 'Sell2Wales Awards',
  url:
    process.env.SELL2WALES_AWARD_URL ||
    'https://www.sell2wales.gov.wales/rss/award',
  base: process.env.SELL2WALES_AWARD_BASE || 'https://www.sell2wales.gov.wales',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const ukriAwardSource = {
  label: 'UKRI Awards',
  url: process.env.UKRI_AWARD_URL || 'https://www.ukri.org/awards/feed/',
  base: process.env.UKRI_AWARD_BASE || 'https://www.ukri.org',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const pcsAwardSource = {
  label: 'Scotland Awards',
  url:
    process.env.PCS_AWARD_URL ||
    'https://www.publiccontractsscotland.gov.uk/rss/award.xml',
  base:
    process.env.PCS_AWARD_BASE || 'https://www.publiccontractsscotland.gov.uk',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const etendersniAwardSource = {
  label: 'eTenders NI Awards',
  url:
    process.env.ETENDERSNI_AWARD_URL ||
    'https://etendersni.gov.uk/epps/cft/listAward?ext_t=RSS',
  base: process.env.ETENDERSNI_AWARD_BASE || 'https://etendersni.gov.uk',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const etendersieAwardSource = {
  label: 'eTenders IE Awards',
  url:
    process.env.ETENDERSIE_AWARD_URL ||
    'https://www.etenders.gov.ie/feeds/award',
  base: process.env.ETENDERSIE_AWARD_BASE || 'https://www.etenders.gov.ie',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const procontractAwardSource = {
  label: 'ProContract Awards',
  url:
    process.env.PROCONTRACT_AWARD_URL ||
    'https://procontract.due-north.com/rss/award.xml',
  base: process.env.PROCONTRACT_AWARD_BASE || 'https://procontract.due-north.com',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const intendAwardSource = {
  label: 'In-Tend Awards',
  url:
    process.env.INTEND_AWARD_URL || 'https://in-tendhost.co.uk/awards/feed/',
  base: process.env.INTEND_AWARD_BASE || 'https://in-tendhost.co.uk',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

const tedAwardSource = {
  label: 'TED Europa',
  url: process.env.TED_AWARD_URL || 'https://ted.europa.eu/udl?uri=TED/rss/awards',
  base: process.env.TED_AWARD_BASE || 'https://ted.europa.eu',
  parser: 'rss',
  pagination: { ...defaultPagination }
};

// Default tagging rules used when none are supplied via the TAG_RULES
// environment variable. Each tag is associated with a list of keywords that,
// when present in a tender's title or description, cause the tag to be applied.
const defaultTagRules = {
  construction: ['construction', 'building', 'infrastructure'],
  it: ['software', 'hardware', 'it', 'digital'],
  healthcare: ['health', 'nhs', 'medical']
};

module.exports = {
  // Port the Express server listens on. Environment variables are parsed as
  // integers so "3001" is treated the same as 3001.
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  // Network interface to bind the HTTP server to. Using 0.0.0.0 allows access
  // from other machines on the network. The hostname is logged purely for
  // convenience.
  host: process.env.HOST || '0.0.0.0',

  // Directory containing frontend templates and static assets
  frontendDir: process.env.FRONTEND_DIR || path.join(__dirname, '../frontend'),

  // Location of the SQLite database file
  dbFile: process.env.DB_FILE || path.join(__dirname, '../tenders.db'),

  // Object containing all available scraping sources. Additional sources can be
  // added here or injected via environment variables.
  sources: {
    default: defaultSource,
    eusupply: euSupplySource,
    sell2wales: sell2walesSource,
    ukri: ukriSource,
    pcs: pcsSource,
    etendersni: etendersniSource,
    etendersie: etendersIEsource,
    procontract: procontractSource,
    intend: intendSource
  },

  // Awarded contract sources used by the dedicated awards scraper. At least ten
  // are provided out of the box.
  awardSources: {
    default: defaultAwardSource,
    eusupply: euSupplyAwardSource,
    sell2wales: sell2walesAwardSource,
    ukri: ukriAwardSource,
    pcs: pcsAwardSource,
    etendersni: etendersniAwardSource,
    etendersie: etendersieAwardSource,
    procontract: procontractAwardSource,
    intend: intendAwardSource,
    ted: tedAwardSource
  },

  // Global pagination defaults used by the scraping helpers. Individual
  // sources can override specific properties via their `pagination` field.
  pagination: defaultPagination,

  // Legacy fields maintained for backwards compatibility. These map to the
  // default source so existing code and tests continue to work.
  scrapeUrl: defaultSource.url,
  scrapeBase: defaultSource.base,

  // Cron expression determining when the scraper runs automatically
  cronSchedule: process.env.CRON_SCHEDULE || '0 6 * * *',
  // Keyword rules for automatic tagging. The value can be overridden by
  // setting the TAG_RULES environment variable to a JSON string matching the
  // shape of `defaultTagRules` above.
  tagRules: (() => {
    if (process.env.TAG_RULES) {
      try {
        return JSON.parse(process.env.TAG_RULES);
      } catch {
        // Fall back to defaults if parsing fails.
      }
    }
    return defaultTagRules;
  })()
};

