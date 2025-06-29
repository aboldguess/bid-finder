// Minimal HTML parsers used to extract tender information without external
// dependencies. Each function targets the structure of a different procurement
// portal. The main `parseTenders` wrapper chooses the appropriate parser based
// on the supplied site key.

/**
 * Parse Contracts Finder markup. This is the original parser used by the
 * project and acts as the default.
 */
function parseContractsFinder(html) {
  const tenders = [];
  const blockRe = /<div class="search-result">([^]*?)<\/div>/g;
  let blockMatch;
  while ((blockMatch = blockRe.exec(html))) {
    const block = blockMatch[1];
    const title = /<h2>(.*?)<\/h2>/.exec(block)?.[1].trim() || '';
    const link = /<a[^>]*href="([^"]+)"/.exec(block)?.[1] || '';
    const date = /<span class="date">(.*?)<\/span>/.exec(block)?.[1].trim() || '';
    const desc = /<p>(.*?)<\/p>/.exec(block)?.[1].trim() || '';
    tenders.push({ title, link, date, desc });
  }
  return tenders;
}

/**
 * Rough parser for Sell2Wales listings. The site uses table rows for each
 * opportunity so we scan for <tr> elements and extract link/text from the first
 * anchor tag.
 */
function parseSell2Wales(html) {
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
    const desc = /<p[^>]*>(.*?)<\/p>/.exec(block)?.[1].trim() || '';
    tenders.push({ title, link: href, date, desc });
  }
  return tenders;
}

/**
 * Parser for UKRI opportunities. Opportunities are usually wrapped in <article>
 * elements with a heading link, description paragraph and optional <time> tag.
 */
function parseUkri(html) {
  const tenders = [];
  const artRe = /<article[^>]*>([^]*?)<\/article>/g;
  let art;
  while ((art = artRe.exec(html))) {
    const block = art[1];
    const link = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/.exec(block);
    if (!link) continue;
    const title = link[2].trim();
    const href = link[1];
    const date = /<time[^>]*>(.*?)<\/time>/.exec(block)?.[1].trim() || '';
    const desc = /<p[^>]*>(.*?)<\/p>/.exec(block)?.[1].trim() || '';
    tenders.push({ title, link: href, date, desc });
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
 * Select the appropriate parser for a site. Unknown keys fall back to the
 * Contracts Finder parser since its format is the basis for our tests.
 */
exports.parseTenders = function parseTenders(html, site = 'contractsFinder') {
  switch (site) {
    case 'sell2wales':
      return parseSell2Wales(html);
    case 'ukri':
      return parseUkri(html);
    case 'eusupply':
      return parseEuSupply(html);
    case 'contractsFinder':
    default:
      return parseContractsFinder(html);
  }
};

