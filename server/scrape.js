/**
 * @file scrape.js
 * @description Implements the main tender scraping workflow. Pages are fetched
 * from configured sources, parsed into individual tenders, optionally enriched
 * with detail pages and finally persisted to the database. The module exposes
 * `run` for a single source and `runAll` for iterating over every configured
 * source. Extensive logging and progress callbacks aid debugging.
 */
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { parseTenders } = require('./htmlParser');
// Detail pages expose additional metadata such as CPV classifications.
const { parseTenderDetails } = require('./detailParser');
const db = require('./db');
const config = require('./config');
const logger = require('./logger');
const { resolvePaginationConfig, findNextPageUrl } = require('./pagination');

// Network safety limits: abort requests taking longer than 10s and cap response
// bodies at 5MB to avoid resource exhaustion.
const FETCH_TIMEOUT = 10000; // ms
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Generate tags for a tender based on the configured keyword rules.
 * Each rule maps a tag to a list of keywords. If any keyword appears in the
 * title or description the corresponding tag is added to the result.
 *
 * @param {string} title - Tender title
 * @param {string} desc - Tender description
 * @returns {string[]} list of tags
 */
function generateTags(title, desc) {
  const tags = [];
  const text = `${title} ${desc}`.toLowerCase();
  for (const [tag, keywords] of Object.entries(config.tagRules)) {
    if (keywords.some(k => text.includes(k.toLowerCase()))) {
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Scrape the government's Contracts Finder site for the latest tenders.
 *
 * @returns {Promise<number>} number of new tenders inserted into the database
 */
/**
 * Run the scraper and optionally report progress for each tender found.
 *
 * @param {function(object):void} [onProgress] - Optional callback invoked after
 *   each tender is processed. Receives an object containing the title, 1-based
 *   index and total number of tenders.
 * @param {{url: string, base: string}} [source] - Override the default scrape
 *   target. This allows the scraper to run against different tender sources.
 * @returns {Promise<number>} number of new tenders inserted into the database
 */
/**
 * Internal implementation used by both `run` and `runAll`. It mirrors the
 * current run() behaviour but returns an object describing the outcome so that
 * callers can access error details when needed.
 *
 * @param {function(object):void} [onProgress]
 * @param {object} [source]
 * @returns {Promise<{added:number, error?:Error}>}
 */
async function runInternal(onProgress, sourceKey, source) {
  try {
    // Determine the URL/base for this run. When no source is supplied we
    // construct an object using the default Contracts Finder settings and the
    // parser key expected by htmlParser.
    const defaultSource = config.sources?.default || {};
    const src =
      source || {
        url: config.scrapeUrl,
        base: config.scrapeBase,
        parser: 'contractsFinder',
        label: defaultSource.label || 'Contracts Finder',
        selectors: defaultSource.selectors,
        pagination: defaultSource.pagination || config.pagination
      };

    // Track how long the scrape takes so progress messages can include the
    // elapsed time. This helps reassure the user that work is ongoing.
    const startTime = Date.now();

    // Log the start of the scrape and notify any progress listener which
    // source is being processed.
    logger.info(`Starting scrape for ${src.label} (${src.url})`);
    if (onProgress) {
      onProgress({ step: 'start', source: src, elapsed: 0 });
    }

    // Collect tenders from all available pages. The pagination helper inspects
    // HTML navigation elements to find the next link while guarding against
    // loops or excessive page counts.
    const allTenders = [];
    let nextUrl = src.url;
    let page = 1;
    const pagination = resolvePaginationConfig(src);
    const pageLimit = Math.max(1, pagination.maxPages || 1);
    const visitedUrls = new Set();
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    };

    while (nextUrl) {
      if (pagination.detectLoops && visitedUrls.has(nextUrl)) {
        logger.info(
          `Detected repeated pagination URL on ${src.label}; stopping at ${nextUrl}`
        );
        break;
      }
      if (page > pageLimit) {
        logger.info(
          `Reached pagination limit (${pageLimit}) for ${src.label}; halting further requests`
        );
        break;
      }
      visitedUrls.add(nextUrl);

      // Notify listeners which page is about to be fetched along with the
      // number of seconds elapsed since the run started. This provides visible
      // feedback that progress is being made even when a single page takes a
      // while to load.
      if (onProgress) {
        onProgress({
          step: 'page',
          page,
          elapsed: Math.round((Date.now() - startTime) / 1000)
        });
      }

      // Fetch each page sequentially using a browser-like User-Agent.
      const res = await fetch(nextUrl, {
        headers,
        timeout: FETCH_TIMEOUT,
        size: MAX_RESPONSE_SIZE
      });
      const html = await res.text();
      const $ = cheerio.load(html);

      // Extract tenders from the HTML using the configured parser and add them
      // to the overall results list.
      const pageTenders = parseTenders(html, src);
      logger.info(`Found ${pageTenders.length} tenders on ${src.label} page ${page}`);
      allTenders.push(...pageTenders);

      if (pageTenders.length === 0) {
        logger.info(`No tenders detected on ${src.label} page ${page}; stopping pagination.`);
        break;
      }

      const nextPageUrl = findNextPageUrl(
        $,
        src.base || nextUrl,
        pagination,
        visitedUrls,
        page,
        logger
      );
      if (nextPageUrl) {
        nextUrl = nextPageUrl;
        page += 1;
      } else {
        logger.info(`No further pagination link found on ${src.label} page ${page}.`);
        nextUrl = null;
      }
    }

    logger.info(`Found ${allTenders.length} tenders on ${src.label}`);

    if (onProgress) {
      // Report the total number of tenders discovered across all pages along
      // with how long the scrape has been running.
      onProgress({
        step: 'found',
        count: allTenders.length,
        elapsed: Math.round((Date.now() - startTime) / 1000)
      });
    }

    // Track how many tenders were inserted during this run.
    let count = 0;

    // `allTenders` contains every result from all pages, so we know the total
    // count before inserting anything.
    const total = allTenders.length;

    // Iterate over each result and insert it into the database. The
    // insertTender function resolves with the number of rows inserted so we can
    // keep track of how many new tenders were added.
    // Use a single timestamp for all tenders so stats can group them by run.
    const runTs = new Date().toISOString();

    for (const [i, tender] of allTenders.entries()) {
      const title = tender.title;
      // Combine the base URL with the scraped link, handling both
      // absolute and relative hrefs using the URL constructor. This
      // avoids malformed URLs when the feed already provides an
      // absolute link.
      const link = new URL(tender.link, src.base).href;
      const date = tender.date;
      const desc = tender.desc;
      const organisation = tender.organisation;
      const supplier = tender.supplier;
      const ocid = tender.ocid || null;
      const tags = generateTags(title, desc);

      // Fetch the detail page to extract CPV codes and any other metadata.
      let cpvCodes = [];
      let details = {};
      try {
        const resDetail = await fetch(link, {
          headers,
          timeout: FETCH_TIMEOUT,
          size: MAX_RESPONSE_SIZE
        });
        const detailHtml = await resDetail.text();
        details = parseTenderDetails(detailHtml);
        cpvCodes = details.cpv;
      } catch (err) {
        // Detail pages occasionally fail to load; log the error but continue.
        logger.error('Failed to fetch tender details:', err);
      }

      // Include metadata about where and when the tender was scraped so
      // the dashboard can display this context to the user.
      const srcLabel = src.label;
      const scrapedAt = runTs;

      let inserted = 0;
      try {
        // Attempt to store the tender. `insertTender` resolves with 1 when a
        // new record was inserted or 0 if the tender already existed.
        inserted = await db.insertTender(
          title,
          link,
          date,
          details.description || desc,
          srcLabel,
          scrapedAt,
          tags.join(','),
          ocid,
          cpvCodes.join(','),
          details.open_date || date,
          details.deadline || '',
          details.customer || organisation || '',
          details.address || '',
          details.country || '',
          details.eligibility || ''
        );

        if (inserted) {
          count += 1;
          const orgName = details.customer || organisation;
          if (orgName) {
            try {
              await db.insertOrganisation(orgName, 'customer');
            } catch (err) {
              logger.error('Error inserting organisation:', err);
            }
          }
          if (supplier) {
            try {
              await db.insertOrganisation(supplier, 'supplier');
            } catch (err) {
              logger.error('Error inserting organisation:', err);
            }
          }
        }
      } catch (err) {
        // Log database errors but continue processing the remaining tenders.
        logger.error('Error inserting tender:', err);
      }

      // Log progress for debugging purposes and notify listeners so the UI can
      // update in real time.
      logger.info(
        `[${i + 1}/${total}] ${title} - ${inserted ? 'inserted' : 'duplicate'}`
      );
      if (onProgress) {
        onProgress({
          step: 'tender',
          title,
          index: i + 1,
          total,
          inserted: Boolean(inserted),
          elapsed: Math.round((Date.now() - startTime) / 1000)
        });
      }
    }

    // Record when this scrape completed successfully so the UI can show
    // freshness information. Failures in this step should not abort the run.
    try {
      // Persist overall and per-source timestamps for the admin UI.
      await db.setLastScraped(runTs);
      if (sourceKey) {
        await db.updateSourceStats(sourceKey, runTs, count);
      }
    } catch (err) {
      logger.error('Failed to update last_scraped timestamp:', err);
    }

    // Provide additional debug output when no new tenders were stored so that
    // any issues with the parser or source can be investigated more easily.
    if (count === 0) {
      if (allTenders.length === 0) {
        logger.info(`No tenders were returned for ${src.label}`);
      } else {
        logger.info(
          `${allTenders.length} tenders found on ${src.label} but all were duplicates`
        );
      }
    } else {
      logger.info(`Inserted ${count} new tenders from ${src.label}`);
    }

    // Return the number of newly inserted tenders.
    return { added: count };
  } catch (err) {
    // Network or parsing errors end up here. Return 0 to indicate no new data
    // was stored during this run and expose the error so callers can log it.
    logger.error('Error fetching tenders from', source?.label || 'default', ':', err);
    return { added: 0, error: err };
  }
}

/**
 * Public wrapper matching the original API used throughout the codebase. This
 * preserves backwards compatibility while allowing runAll() to obtain error
 * information from runInternal.
 */
module.exports.run = async function (onProgress, source, sourceKey = 'default') {
  const result = await runInternal(onProgress, sourceKey, source);
  return result.added;
};

/**
 * Scrape all configured sources one after another. The returned object maps the
 * source key to the result of each run.
 *
 * @param {function(object):void} [onProgress]
 * @returns {Promise<Object>} results keyed by source key
 */
module.exports.runAll = async function (onProgress) {
  logger.info('Starting scrape for all configured sources');
  const results = {};
  for (const [key, src] of Object.entries(config.sources)) {
    const progress = p => onProgress && onProgress({ source: key, ...p });
    const res = await runInternal(progress, key, src);
    if (res.error) {
      logger.error(`Scrape failed for ${key}:`, res.error);
    }
    results[key] = { added: res.added, error: res.error && res.error.message };
  }
  return results;
};
