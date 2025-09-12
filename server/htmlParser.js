/*
 * File: server/htmlParser.js
 * Purpose: Parse tender listings from different procurement portals.
 *
 * Structure:
 *   - clean: normalises text by stripping tags and whitespace.
 *   - parseContractsFinder
 *   - parseSell2Wales
 *   - parseUkri
 *   - parseEuSupply
 *   - parseRss
 *   - parseTenders (exported dispatcher)
 *
 * The parsers rely on Cheerio selectors rather than regex for reliability.
 * Each function returns an array of tender objects with common fields.
 */
const cheerio = require('cheerio');

/**
 * Normalise a snippet of markup by stripping tags and collapsing whitespace.
 * @param {string} str Raw HTML or text.
 * @returns {string} Cleaned string.
 */
function clean(str = '') {
  return cheerio.load(str).text().replace(/\s+/g, ' ').trim();
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
 * Dispatch parser based on source key.
 */
exports.parseTenders = function parseTenders(html, site = 'contractsFinder') {
  switch (site) {
    case 'eusupply':
      return parseEuSupply(html);
    case 'sell2wales':
      return parseSell2Wales(html);
    case 'ukri':
      return parseUkri(html);
    case 'rss':
      return parseRss(html);
    case 'contractsFinder':
    default:
      return parseContractsFinder(html);
  }
};
