/*
 * File: server/htmlParser.js
 * Purpose: Parse tender listings from different procurement portals.
 *
 * Structure:
 *   - clean: normalises text by stripping tags and whitespace.
 *   - parseGeneric
 *   - parseContractsFinder
 *   - parseSell2Wales
 *   - parseUkri
 *   - parseEuSupply
 *   - parseRss
 *   - detectParserFromContentType / detectParserFromMarkup
 *   - inferParserForSource (auto-detect helper)
 *   - parseTenders (exported dispatcher)
 *
 * The parsers rely on Cheerio selectors rather than regex for reliability.
 * Each function returns an array of tender objects with common fields.
 */
const cheerio = require('cheerio');
const { fetchText } = require('./httpClient');
const logger = require('./logger');

/**
 * Identifier used when no parser is specified. Exposed so the UI can present
 * a consistent default option and server code can reference a single source of
 * truth instead of repeating string literals.
 */
const DEFAULT_PARSER_KEY = 'contractsFinder';

/**
 * Catalogue describing the built-in parsers. The admin and scraper UIs use the
 * metadata to present human-friendly dropdowns and the help page renders the
 * descriptions so operators can choose the correct parser for each source.
 */
const PARSER_CATALOGUE = Object.freeze(
  [
    {
      key: DEFAULT_PARSER_KEY,
      label: 'Contracts Finder (HTML)',
      description:
        'Purpose-built for the Contracts Finder HTML listings when an RSS feed is unavailable. '
        + 'Use this when scraping the Contracts Finder search results pages directly.'
    },
    {
      key: 'rss',
      label: 'RSS / Atom feed',
      description:
        'Generic RSS and Atom parser that reads standard feed elements. Choose this whenever '
        + 'a source exposes a valid RSS or Atom feed of opportunities.'
    },
    {
      key: 'generic',
      label: 'Generic (CSS selectors)',
      description:
        'Uses custom CSS selectors configured for the source to extract fields. '
        + 'Select only when advanced selectors have been defined for the feed.'
    },
    {
      key: 'eusupply',
      label: 'EU Supply',
      description:
        'Handles the unique markup produced by EU Supply portals such as uk.eu-supply.com. '
        + 'Select this for opportunities sourced from EU Supply instances.'
    },
    {
      key: 'sell2wales',
      label: 'Sell2Wales',
      description:
        'Tailored to the Sell2Wales opportunity listings. Apply this parser when scraping '
        + 'sell2wales.gov.wales feeds or HTML listings.'
    },
    {
      key: 'ukri',
      label: 'UK Research and Innovation',
      description:
        'Optimised for the UK Research and Innovation tender portal. Use it for ukri.org '
        + 'procurement listings.'
    }
  ].map(option => Object.freeze(option))
);

const PARSER_KEY_SET = new Set(PARSER_CATALOGUE.map(option => option.key));

/**
 * Normalise a snippet of markup by stripping tags and collapsing whitespace.
 * @param {string} str Raw HTML or text.
 * @returns {string} Cleaned string.
 */
function clean(str = '') {
  const safe = typeof str === 'string' ? str : str == null ? '' : String(str);
  return cheerio.load(safe).text().replace(/\s+/g, ' ').trim();
}

/**
 * Attempt to resolve a cheerio element according to the supplied selector
 * definition. Strings are treated as CSS selectors searched within the
 * provided block, whereas objects allow specifying alternate lookup
 * strategies such as `closest` or retrieving the block itself using `self`.
 * Arrays are processed until a non-empty match is found.
 *
 * @param {cheerio.Cheerio} block The element representing a single tender.
 * @param {string|object|Array} def Selector definition.
 * @returns {cheerio.Cheerio|null} Matched element or null when nothing is found.
 */
function resolveElement(block, def) {
  if (!def) return null;

  if (Array.isArray(def)) {
    for (const candidate of def) {
      const el = resolveElement(block, candidate);
      if (el && el.length) {
        return el;
      }
    }
    return null;
  }

  if (typeof def === 'string') {
    if (def === ':self' || def === 'self') {
      return block;
    }
    const el = block.find(def).first();
    return el.length ? el : null;
  }

  if (typeof def === 'object') {
    if (def.self) {
      return block;
    }

    const strategy = def.strategy || (def.closest ? 'closest' : 'find');
    const selector = def.selector || def.closest || def.find;

    if (!selector) {
      return block;
    }

    const el =
      strategy === 'closest'
        ? block.closest(selector)
        : strategy === 'self'
        ? block
        : block.find(selector).first();

    return el && el.length ? el : null;
  }

  return null;
}

/**
 * Extract text or attribute data from a block using the provided selector.
 * When `options.attribute` is supplied the corresponding attribute value is
 * returned rather than element text. Multiple selectors can be passed via an
 * array to provide fallbacks.
 *
 * @param {cheerio.Cheerio} block Tender wrapper element.
 * @param {string|object|Array} def Selector definition.
 * @param {{attribute?: string, cleanText?: boolean}} [options] Extraction opts.
 * @returns {string} Resolved value (empty string when no match is found).
 */
function extractValue(block, def, options = {}) {
  const { attribute, cleanText = true } = options;
  const selectors = Array.isArray(def) ? def : [def];

  for (const selectorDef of selectors) {
    if (!selectorDef) continue;

    let attrName = attribute;
    if (typeof selectorDef === 'object' && selectorDef.attr && !attrName) {
      attrName = selectorDef.attr;
    }

    const el = resolveElement(block, selectorDef);
    if (!el || !el.length) {
      continue;
    }

    if (attrName) {
      const raw = el.attr(attrName);
      if (typeof raw === 'string' && raw.trim()) {
        return cleanText ? clean(raw) : raw.trim();
      }
      continue;
    }

    const html = el.html();
    if (typeof html === 'string' && html.trim()) {
      return clean(html);
    }

    const text = el.text();
    if (typeof text === 'string' && text.trim()) {
      return clean(text);
    }
  }

  return '';
}

/**
 * Generic parser that can be configured via CSS selectors. Each selector is
 * applied relative to a wrapper element identified by `selectors.item`. When
 * `item` is omitted the selector supplied for the link or title is used as the
 * iteration anchor, allowing quick experiments albeit with less context.
 *
 * @param {string} html Raw HTML fragment to parse.
 * @param {object} selectors Map of selector strings/objects.
 * @param {string|object|Array} selectors.item CSS selector locating each row.
 * @param {string|object|Array} selectors.title Selector yielding the title.
 * @param {string|object|Array} selectors.link Selector yielding the link.
 * @param {string|object|Array} [selectors.date] Selector for the date field.
 * @param {string|object|Array} [selectors.description] Selector for the summary.
 * @returns {Array<object>} Normalised tender objects.
 */
function parseGeneric(html, selectors = {}) {
  const $ = cheerio.load(html);
  const results = [];

  const itemSelector = selectors.item || selectors.items || null;
  const anchorSelector = selectors.link || selectors.title || 'a';
  const nodes = itemSelector ? $(itemSelector).toArray() : $(anchorSelector).toArray();
  const seen = new Set();

  for (const node of nodes) {
    const base = itemSelector ? $(node) : $(node);
    const block = !itemSelector && selectors.scope ? base.closest(selectors.scope) : base;

    const title = selectors.title
      ? extractValue(block, selectors.title)
      : extractValue(block, ['h1', 'h2', 'h3', 'a']);

    const linkAttr =
      (typeof selectors.link === 'object' && selectors.link.attr) ||
      selectors.linkAttribute ||
      'href';
    const linkEl = selectors.link ? selectors.link : { selector: 'a', attr: 'href' };
    const link = extractValue(block, linkEl, { attribute: linkAttr, cleanText: false });

    if (!title || !link) {
      continue;
    }

    const key = `${title}|${link}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const tender = {
      title,
      link,
      date: selectors.date ? extractValue(block, selectors.date) : '',
      desc: selectors.description ? extractValue(block, selectors.description) : '',
      organisation: selectors.organisation ? extractValue(block, selectors.organisation) : '',
      supplier: selectors.supplier ? extractValue(block, selectors.supplier) : ''
    };

    const ocidAttr =
      (typeof selectors.ocid === 'object' && selectors.ocid.attr) || selectors.ocidAttribute;
    let ocid = selectors.ocid
      ? extractValue(block, selectors.ocid, {
          attribute: ocidAttr,
          cleanText: !ocidAttr
        })
      : '';

    if (!ocid) {
      ocid =
        block.attr('data-ocid') ||
        block.find('[data-ocid]').attr('data-ocid') ||
        (block.text().match(/ocds-[a-z0-9-]+/i) || [])[0] ||
        '';
    }

    tender.ocid = ocid;
    results.push(tender);
  }

  return results;
}

/**
 * Parse Contracts Finder style listings.
 * @param {string} html Raw HTML page.
 * @returns {Array<object>} List of tenders.
 */
function parseContractsFinder(html) {
  const $ = cheerio.load(html);
  const tenders = [];

  $('.search-result, .search-result-entry').each((_, el) => {
    const block = $(el);

    // Prefer title from <h2>; fall back to first anchor text.
    const h2 = block.find('h2').first();
    const linkEl = block.find('a').first();
    const title = clean(h2.html() || linkEl.html());
    const href = linkEl.attr('href') || '';

    const date = clean(
      block.find('time').first().html() ||
        block.find('.date').first().html()
    );
    const desc = clean(block.find('p').first().html());

    const organisation = clean(block.find('.org').first().html());
    const supplier = clean(block.find('.supplier').first().html());

    // Look for OCID attribute or text occurrence.
    const ocid =
      block.find('[data-ocid]').attr('data-ocid') ||
      (block.text().match(/ocds-[a-z0-9-]+/i) || [])[0] ||
      '';

    if (href && title) {
      tenders.push({
        title,
        link: href,
        date,
        desc,
        organisation,
        supplier,
        ocid
      });
    }
  });

  return tenders;
}

/**
 * Parse Sell2Wales style table rows.
 */
function parseSell2Wales(html) {
  const $ = cheerio.load(html);
  const tenders = [];

  $('tr').each((_, row) => {
    const block = $(row);
    const linkEl = block.find('a').first();
    if (!linkEl.length) return;

    const title = clean(linkEl.html());
    const href = linkEl.attr('href') || '';

    const date =
      clean(block.find('time').first().html()) ||
      (block.text().match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/) || [''])[0];

    const desc = clean(
      block.find('td.description').first().html() ||
        block.find('p').first().html()
    );

    const ocid =
      block.find('[data-ocid]').attr('data-ocid') ||
      (block.text().match(/ocds-[a-z0-9-]+/i) || [])[0] ||
      '';

    if (title && href) {
      tenders.push({
        title,
        link: href,
        date,
        desc,
        organisation: '',
        supplier: '',
        ocid
      });
    }
  });

  return tenders;
}

/**
 * Parse UKRI opportunity listings wrapped in <article> tags.
 */
function parseUkri(html) {
  const $ = cheerio.load(html);
  const tenders = [];

  $('article').each((_, art) => {
    const block = $(art);
    const linkEl = block.find('a').first();
    if (!linkEl.length) return;

    const title = clean(linkEl.html());
    const href = linkEl.attr('href') || '';
    const date = clean(block.find('time').first().html());
    const desc = clean(block.find('p').first().html());

    const ocid =
      block.find('[data-ocid]').attr('data-ocid') ||
      (block.text().match(/ocds-[a-z0-9-]+/i) || [])[0] ||
      '';

    if (!/contact\s+us/i.test(title)) {
      tenders.push({
        title,
        link: href,
        date,
        desc,
        organisation: '',
        supplier: '',
        ocid
      });
    }
  });

  return tenders;
}

/**
 * Parse EU-Supply public tender tables.
 */
function parseEuSupply(html) {
  const $ = cheerio.load(html);
  const tenders = [];

  $('tr').each((_, row) => {
    const block = $(row);
    const linkEl = block.find('a').first();
    if (!linkEl.length) return;

    const title = clean(linkEl.html());
    const href = linkEl.attr('href') || '';
    const date =
      clean(block.find('time').first().html()) ||
      (block.text().match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/) || [''])[0];

    const desc = clean(block.find('td.description').first().html());

    const ocid =
      block.find('[data-ocid]').attr('data-ocid') ||
      (block.text().match(/ocds-[a-z0-9-]+/i) || [])[0] ||
      '';

    tenders.push({
      title,
      link: href,
      date,
      desc,
      organisation: '',
      supplier: '',
      ocid
    });
  });

  return tenders;
}

/**
 * Basic RSS parser for generic feeds.
 */
function parseRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const tenders = [];

  $('item').each((_, item) => {
    const block = $(item);
    const title = clean(block.find('title').html());
    const href = clean(block.find('link').html());
    const date = clean(
      block.find('pubDate').html() || block.find('dc\\:date').html()
    );
    const desc = clean(block.find('description').html());

    const ocid =
      block.find('ocid').text().trim() ||
      (block.text().match(/ocds-[a-z0-9-]+/i) || [])[0] ||
      '';

    if (title && href) {
      tenders.push({
        title,
        link: href,
        date,
        desc,
        organisation: '',
        supplier: '',
        ocid
      });
    }
  });

  return tenders;
}

/**
 * Attempt to identify a parser from the server provided content-type header.
 * Only coarse-grained checks are performed because upstreams are often lax
 * with their MIME declarations.
 *
 * @param {string} contentType Raw content-type header value
 * @returns {string|null} Parser key if one can be inferred
 */
function detectParserFromContentType(contentType = '') {
  if (!contentType) {
    return null;
  }

  const lower = String(contentType).toLowerCase();

  if (lower.includes('rss') || lower.includes('atom')) {
    return 'rss';
  }

  if (lower.includes('xml') && (lower.includes('application/') || lower.includes('text/'))) {
    // Many feeds advertise themselves as generic XML. When this is the case we
    // still prefer the RSS parser over the HTML fallbacks.
    return 'rss';
  }

  return null;
}

/**
 * Inspect the downloaded markup to guess which specialised parser best fits
 * the structure. The heuristics prefer very distinctive markers to reduce the
 * chance of selecting the wrong parser which would lead to empty scrape
 * results.
 *
 * @param {string} body HTML/XML document body
 * @returns {string|null} Parser key when a confident match is found
 */
function detectParserFromMarkup(body) {
  if (typeof body !== 'string') {
    return null;
  }

  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  // Quick RSS/Atom detection based purely on the raw text to avoid unnecessary
  // DOM parsing when an XML feed is obvious.
  if (/<rss\b/i.test(trimmed) || /<feed\b/i.test(trimmed) || /<channel\b/i.test(trimmed)) {
    return 'rss';
  }

  let $;
  try {
    $ = cheerio.load(trimmed);
  } catch (error) {
    logger.error('Failed to parse markup during parser inference: %s', error.message);
    return null;
  }

  if ($('rss, channel, feed, item').length > 0) {
    return 'rss';
  }

  // EU Supply tables contain distinctive headers and often a dedicated class.
  const euSpecificTable = $('table.eu-supply-table, table[data-eusupply-table], table#tendersTable');
  if (euSpecificTable.length > 0) {
    return 'eusupply';
  }

  const euHeaders = ['tender title', 'tender reference', 'publication date'];
  const euHeaderMatches = $('th')
    .toArray()
    .map(el => $(el).text().trim().toLowerCase())
    .filter(text => text && euHeaders.some(marker => text.includes(marker)));
  if (euHeaderMatches.length >= 2 && $('td.description').length > 0) {
    return 'eusupply';
  }

  // Sell2Wales pages typically expose branded captions or table level markers.
  const sellTables = $('table.sell2wales, table[data-sell2wales-table], table#sell2wales-list');
  if (sellTables.length > 0) {
    return 'sell2wales';
  }

  const sellCaptions = $('caption')
    .toArray()
    .map(el => $(el).text().trim().toLowerCase());
  if (sellCaptions.some(text => text.includes('sell2wales') || text.includes('sell 2 wales'))) {
    return 'sell2wales';
  }

  if ($('td.description').length > 0 && /sell2wales/i.test(trimmed)) {
    return 'sell2wales';
  }

  // UKRI listings are wrapped in <article> elements with time and anchor tags.
  const ukriArticles = $('article');
  if (
    ukriArticles.length > 0 &&
    ukriArticles.find('a').length > 0 &&
    ukriArticles.find('time').length > 0
  ) {
    return 'ukri';
  }

  // Contracts Finder pages contain search-result blocks.
  if ($('.search-result, .search-result-entry').length > 0) {
    return DEFAULT_PARSER_KEY;
  }

  return null;
}

/**
 * Fetch a sample document for a source and infer which parser should be used.
 * The helper is defensive: failures to fetch or classify fall back to the
 * default parser to avoid breaking source creation flows.
 *
 * @param {{url: string, headers?: object}} source Source configuration snippet
 * @returns {Promise<string>} Parser key present in PARSER_CATALOGUE
 */
async function inferParserForSource(source) {
  if (!source || !source.url) {
    throw new Error('A source URL is required to infer a parser.');
  }

  try {
    const response = await fetchText(source.url, {
      headers: source.headers,
      includeMeta: true
    });

    const body = typeof response === 'string' ? response : response.body;
    const contentType = typeof response === 'object' ? response.contentType : '';

    const parserFromHeader = detectParserFromContentType(contentType);
    if (parserFromHeader && PARSER_KEY_SET.has(parserFromHeader)) {
      logger.info('Parser inference from content-type selected "%s" for %s.', parserFromHeader, source.url);
      return parserFromHeader;
    }

    const parserFromMarkup = detectParserFromMarkup(body);
    if (parserFromMarkup && PARSER_KEY_SET.has(parserFromMarkup)) {
      logger.info('Parser inference from markup selected "%s" for %s.', parserFromMarkup, source.url);
      return parserFromMarkup;
    }

    logger.info(
      'Parser inference defaulted to "%s" for %s because no specialised parser matched.',
      DEFAULT_PARSER_KEY,
      source.url
    );
  } catch (error) {
    logger.error('Parser inference failed for %s: %s', source.url, error.message);
  }

  return DEFAULT_PARSER_KEY;
}

/**
 * Dispatch parser based on source configuration. When a selectors object is
 * supplied the new generic parser is used; otherwise the legacy named parsers
 * remain available for backwards compatibility and specialised behaviour.
 *
 * @param {string} html Raw HTML or XML response body.
 * @param {string|object} source Either a parser key or full source definition.
 * @returns {Array<object>} Parsed tender rows.
 */
exports.parseTenders = function parseTenders(html, source = DEFAULT_PARSER_KEY) {
  const sourceConfig =
    typeof source === 'string' || !source
      ? { parser: source || DEFAULT_PARSER_KEY }
      : source;

  if (sourceConfig && sourceConfig.selectors) {
    return parseGeneric(html, sourceConfig.selectors);
  }

  const parserKey =
    sourceConfig && sourceConfig.parser ? sourceConfig.parser : DEFAULT_PARSER_KEY;

  switch (parserKey) {
    case 'eusupply':
      return parseEuSupply(html);
    case 'sell2wales':
      return parseSell2Wales(html);
    case 'ukri':
      return parseUkri(html);
    case 'rss':
      return parseRss(html);
    case DEFAULT_PARSER_KEY:
    default:
      return parseContractsFinder(html);
  }
};

exports.PARSER_CATALOGUE = PARSER_CATALOGUE;
exports.DEFAULT_PARSER_KEY = DEFAULT_PARSER_KEY;
exports.inferParserForSource = inferParserForSource;
