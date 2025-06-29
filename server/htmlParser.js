// Minimal HTML parsers used to extract tender information without external
// dependencies. Each function targets the structure of a different procurement
// portal. The main `parseTenders` wrapper chooses the appropriate parser based
// on the supplied site key.

/**
 * Parse Contracts Finder markup. This is the original parser used by the
 * project and acts as the default.
 */
// Helper to strip any nested HTML tags and normalise whitespace
const clean = str => str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function parseContractsFinder(html) {
  const tenders = [];
  // Results are contained within elements that include the "search-result" class
  const blockRe = /<div[^>]*class="[^"]*search-result[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let blockMatch;
  while ((blockMatch = blockRe.exec(html))) {
    const block = blockMatch[1];
    const link = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/i.exec(block);
    // Some templates place the title inside the anchor, others in a sibling h2
    const title = link ? clean(link[2]) : clean(/<h2[^>]*>(.*?)<\/h2>/i.exec(block)?.[1] || '');
    const href = link ? link[1] : /<a[^>]*href="([^"]+)"/i.exec(block)?.[1] || '';
    const dateMatch =
      /<time[^>]*>(.*?)<\/time>/i.exec(block) ||
      /<span[^>]*class="[^"]*date[^"]*"[^>]*>(.*?)<\/span>/i.exec(block);
    const date = dateMatch ? clean(dateMatch[1]) : '';
    const desc = clean(/<p[^>]*>(.*?)<\/p>/i.exec(block)?.[1] || '');
    if (href && title) {
      tenders.push({ title, link: href, date, desc });
    }
  }
  return tenders;
}

/**
 * Rough parser for Sell2Wales listings. This is retained for reference only
 * as the live site has changed and the scraper no longer targets it by
 * default. The code scans table rows for the first anchor tag.
 */
function parseSell2Wales(html) {
  const tenders = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html))) {
    const block = row[1];
    const link = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/i.exec(block);
    if (!link) continue;
    const title = clean(link[2]);
    const href = link[1];
    const dateMatch =
      /(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/.exec(block) ||
      /<time[^>]*>(.*?)<\/time>/i.exec(block);
    const date = dateMatch ? clean(dateMatch[1]) : '';
    const desc = clean(
      /<td[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/td>/i.exec(block)?.[1] ||
        /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] ||
        ''
    );
    if (title && href) {
      tenders.push({ title, link: href, date, desc });
    }
  }
  return tenders;
}

/**
 * Parser for UKRI opportunities. The InnovateUK platform this targeted is not
 * currently scraped but the function remains for anyone experimenting with
 * custom sources.
 * Opportunities are typically wrapped in <article> elements.
 */
function parseUkri(html) {
  const tenders = [];
  const artRe = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let art;
  while ((art = artRe.exec(html))) {
    const block = art[1];
    const link = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/i.exec(block);
    if (!link) continue;
    const title = clean(link[2]);
    const href = link[1];
    const date = clean(/<time[^>]*>(.*?)<\/time>/i.exec(block)?.[1] || '');
    const desc = clean(/<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] || '');
    if (!/contact\s+us/i.test(title)) {
      tenders.push({ title, link: href, date, desc });
    }
  }
  return tenders;
}

/**
 * Parser for EU-Supply public tender tables. Each row represents a tender and
 * usually contains a link along with date and description cells.
 */
function parseEuSupply(html) {
  const tenders = [];
  const rowRe = /<tr[^>]*>([^]*?)<\/tr>/g;
  let row;
  while ((row = rowRe.exec(html))) {
    const block = row[1];
    const link = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/.exec(block);
    if (!link) continue;
    const title = link[2].trim();
    const href = link[1];
    const date = /(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/.exec(block)?.[1] || '';
    const desc = /<td[^>]*class="description"[^>]*>(.*?)<\/td>/.exec(block)?.[1].trim() || '';
    tenders.push({ title, link: href, date, desc });
  }
  return tenders;
}

/**
 * Basic RSS parser used for feeds exposed by many procurement portals.
 * Each <item> represents a tender so we extract standard RSS fields.
 */
function parseRss(xml) {
  const tenders = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let item;
  while ((item = itemRe.exec(xml))) {
    const block = item[1];
    const title = clean(/<title>([\s\S]*?)<\/title>/i.exec(block)?.[1] || '');
    const href = clean(/<link>([\s\S]*?)<\/link>/i.exec(block)?.[1] || '');
    const date = clean(/<(pubDate|dc:date)>([\s\S]*?)<\/(pubDate|dc:date)>/i.exec(block)?.[2] || '');
    const desc = clean(/<description>([\s\S]*?)<\/description>/i.exec(block)?.[1] || '');
    if (title && href) {
      tenders.push({ title, link: href, date, desc });
    }
  }
  return tenders;
}

/**
 * Select the appropriate parser for a site. Unknown keys fall back to the
 * Contracts Finder parser since its format is the basis for our tests.
 */
exports.parseTenders = function parseTenders(html, site = 'contractsFinder') {
  switch (site) {
    // EU Supply uses a different table structure so it has its own parser.
    case 'eusupply':
      return parseEuSupply(html);
    // Sell2Wales and UKRI each use their own markup so custom parsers exist
    // for them as well.
    case 'sell2wales':
      return parseSell2Wales(html);
    case 'ukri':
      return parseUkri(html);
    // Many sites expose RSS feeds which we can parse generically.
    case 'rss':
      return parseRss(html);
    // Any unknown keys fall back to the Contracts Finder format which our
    // tests are based on.
    case 'contractsFinder':
    default:
      return parseContractsFinder(html);
  }
};

