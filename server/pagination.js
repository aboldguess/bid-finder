/**
 * @file pagination.js
 * @description Helper utilities shared by the tender and award scrapers for
 * handling paginated result sets. The helpers merge source specific overrides
 * with global defaults, identify suitable "next page" links using Cheerio and
 * enforce safety limits such as maximum page counts and loop detection.
 */
const config = require('./config');

/**
 * Normalise a selector list into a clean array of CSS selectors. Strings are
 * split on commas to make environment configuration ergonomic.
 *
 * @param {string|string[]} value - Raw selector configuration
 * @param {string[]} [fallback=[]] - Fallback list when no selectors are given
 * @returns {string[]} Sanitised selector array
 */
function normaliseSelectorList(value, fallback = []) {
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
 * Parse a value into a positive integer, returning the fallback when parsing
 * fails or the result is less than one.
 *
 * @param {number|string|undefined} value - Value provided by configuration
 * @param {number} fallback - Default to use when parsing fails
 * @returns {number} Positive integer suitable for pagination limits
 */
function parsePositiveInt(value, fallback) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num <= 0) {
    return fallback;
  }
  return num;
}

/**
 * Merge pagination settings defined globally in config.js with optional
 * per-source overrides. The result is a fully populated configuration object
 * that downstream scraping logic can rely on without needing to constantly
 * guard against missing values.
 *
 * @param {object} [source={}] - Source configuration containing optional overrides
 * @returns {{maxPages:number, navSelectors:string[], nextLinkSelectors:string[], pageNumberPattern:string, detectLoops:boolean}}
 */
function resolvePaginationConfig(source = {}) {
  const defaults = config.pagination || {};
  const overrides = source.pagination || {};

  const baseMaxPages = parsePositiveInt(defaults.maxPages, 25);
  const maxPages = parsePositiveInt(overrides.maxPages, baseMaxPages);

  const defaultNavSelectors = normaliseSelectorList(defaults.navSelectors);
  const defaultNextSelectors = normaliseSelectorList(defaults.nextLinkSelectors);

  const navSelectors = normaliseSelectorList(
    overrides.navSelectors,
    defaultNavSelectors
  );
  const nextLinkSelectors = normaliseSelectorList(
    overrides.nextLinkSelectors,
    defaultNextSelectors
  );

  const pageNumberPattern =
    typeof overrides.pageNumberPattern === 'string' && overrides.pageNumberPattern.trim()
      ? overrides.pageNumberPattern.trim()
      : typeof defaults.pageNumberPattern === 'string' && defaults.pageNumberPattern.trim()
      ? defaults.pageNumberPattern.trim()
      : '\\d+';

  const detectLoops =
    overrides.detectLoops !== undefined
      ? Boolean(overrides.detectLoops)
      : defaults.detectLoops !== undefined
      ? Boolean(defaults.detectLoops)
      : true;

  return {
    maxPages,
    navSelectors,
    nextLinkSelectors,
    pageNumberPattern,
    detectLoops
  };
}

/**
 * Convert a possibly relative pagination href into an absolute URL. The helper
 * gracefully handles placeholders such as "#" or "javascript:void(0)" by
 * returning null which signals the caller to skip the link.
 *
 * @param {string|undefined|null} rawHref - Raw href attribute from the DOM
 * @param {string} baseUrl - Base URL used to resolve relative links
 * @returns {string|null} Absolute URL or null when the href is unusable
 */
function resolveAbsoluteUrl(rawHref, baseUrl) {
  if (!rawHref) {
    return null;
  }
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed === '#' || trimmed.toLowerCase().startsWith('javascript')) {
    return null;
  }
  try {
    const normalised = trimmed.replace(/&amp;/gi, '&');
    return new URL(normalised, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Compile the configured page number regex, falling back to a simple digit
 * matcher whenever the pattern is invalid. Invalid patterns are logged so
 * administrators can diagnose misconfiguration quickly.
 *
 * @param {string} pattern - Regex pattern provided by configuration
 * @param {{info:Function}} [logger] - Optional logger for diagnostics
 * @returns {RegExp} Compiled regular expression
 */
function compilePageNumberRegex(pattern, logger) {
  try {
    return new RegExp(pattern, 'i');
  } catch (err) {
    if (logger && typeof logger.info === 'function') {
      logger.info(
        `Invalid pageNumberPattern "${pattern}" supplied; defaulting to /\\d+/`
      );
    }
    return /\d+/i;
  }
}

/**
 * Inspect the provided Cheerio document and identify the most suitable URL for
 * the next page of results. Preference is given to rel="next" links, anchors
 * whose text explicitly contains "Next" or arrow glyphs and finally numerical
 * links representing page numbers. URLs already visited are skipped to prevent
 * loops.
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance for the page
 * @param {string} baseUrl - Base URL used to resolve relative links
 * @param {object} paginationConfig - Output of resolvePaginationConfig()
 * @param {Set<string>} visitedUrls - URLs already requested during this run
 * @param {number} currentPage - One-based index of the current page
 * @param {{info:Function}} [logger] - Optional logger for diagnostics
 * @returns {string|null} Absolute URL for the next page or null when none exist
 */
function findNextPageUrl(
  $,
  baseUrl,
  paginationConfig,
  visitedUrls,
  currentPage,
  logger
) {
  const seen = visitedUrls || new Set();

  const firstMatching = selector => {
    if (!selector) {
      return null;
    }
    const nodes = $(selector).toArray();
    for (const node of nodes) {
      const href = resolveAbsoluteUrl($(node).attr('href'), baseUrl);
      if (href && !seen.has(href)) {
        return href;
      }
    }
    return null;
  };

  for (const selector of paginationConfig.nextLinkSelectors || []) {
    const candidate = firstMatching(selector);
    if (candidate) {
      return candidate;
    }
  }

  const navElements = [];
  for (const selector of paginationConfig.navSelectors || []) {
    if (!selector) {
      continue;
    }
    const matches = $(selector).toArray();
    if (matches.length) {
      navElements.push(...matches);
    }
  }

  if (navElements.length === 0) {
    return null;
  }

  const pageNumberRegex = compilePageNumberRegex(
    paginationConfig.pageNumberPattern,
    logger
  );

  let exactNextHref = null;
  let labelledNextHref = null;
  let smallestGreater = null;
  let fallbackHref = null;

  const considerAnchor = element => {
    const anchor = $(element);
    const href = resolveAbsoluteUrl(anchor.attr('href'), baseUrl);
    if (!href || seen.has(href)) {
      return;
    }

    if (!fallbackHref) {
      fallbackHref = href;
    }

    const text = anchor.text().replace(/\s+/g, ' ').trim();
    if (!text) {
      return;
    }

    const lower = text.toLowerCase();
    if (!labelledNextHref && (lower.includes('next') || /›|»|→/.test(text))) {
      labelledNextHref = href;
    }

    const match = text.match(pageNumberRegex);
    if (!match || match.length === 0) {
      return;
    }

    const pageNum = Number.parseInt(match[match.length - 1], 10);
    if (Number.isNaN(pageNum) || pageNum <= currentPage) {
      return;
    }

    if (pageNum === currentPage + 1 && !exactNextHref) {
      exactNextHref = href;
      return;
    }

    if (!smallestGreater || pageNum < smallestGreater.pageNum) {
      smallestGreater = { href, pageNum };
    }
  };

  for (const navElement of navElements) {
    if (navElement && navElement.name === 'a') {
      considerAnchor(navElement);
    }
    $(navElement)
      .find('a[href]')
      .each((_, anchorEl) => {
        considerAnchor(anchorEl);
      });
  }

  if (exactNextHref) {
    return exactNextHref;
  }
  if (labelledNextHref) {
    return labelledNextHref;
  }
  if (smallestGreater) {
    return smallestGreater.href;
  }
  return fallbackHref;
}

module.exports = {
  resolvePaginationConfig,
  findNextPageUrl
};
