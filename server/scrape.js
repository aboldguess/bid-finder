const fetch = require('node-fetch');
const { parseTenders } = require('./htmlParser');
const db = require('./db');
const config = require('./config');
const logger = require('./logger');

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
async function runInternal(onProgress, source) {
  try {
    // Determine the URL/base for this run. When no source is supplied we
    // construct an object using the default Contracts Finder settings and the
    // parser key expected by htmlParser.
    const src =
      source || {
        url: config.scrapeUrl,
        base: config.scrapeBase,
        parser: 'contractsFinder'
      };

    // Log the start of the scrape and let any progress listener know which
    // source is being processed.
    logger.info(`Starting scrape for ${src.label} (${src.url})`);
    if (onProgress) {
      onProgress({ step: 'start', source: src });
    }

    // Fetch the search page with a realistic User-Agent so the request looks
    // like it is coming from a normal browser.
    const res = await fetch(src.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });

    // Grab the raw HTML then extract tender information using our small
    // regex-based parser. This avoids the need for external HTML libraries.
    const html = await res.text();
    // Forward the parser key so htmlParser knows which scraping strategy to use.
    const tenders = parseTenders(html, src.parser);

    logger.info(`Found ${tenders.length} tenders on ${src.label}`);

    // Notify listeners how many tenders were discovered on the page.
    if (onProgress) {
      onProgress({ step: 'found', count: tenders.length });
    }

    // Track how many tenders were inserted during this run.
    let count = 0;

    // "tenders" already contains each result, so we know the total count.
    const total = tenders.length;

    // Iterate over each result and insert it into the database. The
    // insertTender function resolves with the number of rows inserted so we can
    // keep track of how many new tenders were added.
    for (const [i, tender] of tenders.entries()) {
      const title = tender.title;
      const link = src.base + tender.link;
      const date = tender.date;
      const desc = tender.desc;
      // Include metadata about where and when the tender was scraped so
      // the dashboard can display this context to the user.
      const srcLabel = src.label;
      const scrapedAt = new Date().toISOString();

      let inserted = 0;
      try {
        // Attempt to store the tender. `insertTender` resolves with 1 when a
        // new record was inserted or 0 if the tender already existed.
        inserted = await db.insertTender(title, link, date, desc, srcLabel, scrapedAt);

        if (inserted) {
          count += 1;
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
          inserted: Boolean(inserted)
        });
      }
    }

    // Record when this scrape completed successfully so the UI can show
    // freshness information. Failures in this step should not abort the run.
    try {
      await db.setLastScraped(new Date().toISOString());
    } catch (err) {
      logger.error('Failed to update last_scraped timestamp:', err);
    }

    // Provide additional debug output when no new tenders were stored so that
    // any issues with the parser or source can be investigated more easily.
    if (count === 0) {
      if (tenders.length === 0) {
        logger.info(`No tenders were returned for ${src.label}`);
      } else {
        logger.info(
          `${tenders.length} tenders found on ${src.label} but all were duplicates`
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
module.exports.run = async function (onProgress, source) {
  const result = await runInternal(onProgress, source);
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
    const res = await runInternal(progress, src);
    if (res.error) {
      logger.error(`Scrape failed for ${key}:`, res.error);
    }
    results[key] = { added: res.added, error: res.error && res.error.message };
  }
  return results;
};
