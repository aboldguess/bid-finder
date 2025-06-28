const fetch = require('node-fetch');
const cheerio = require('cheerio');
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
 * @returns {Promise<number>} number of new tenders inserted into the database
 */
module.exports.run = async function (onProgress) {
  try {
    // Fetch the search page with a realistic User-Agent so the request looks
    // like it is coming from a normal browser.
    const res = await fetch(config.scrapeUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });

    // Load the response body into cheerio for easy DOM traversal.
    const html = await res.text();
    const $ = cheerio.load(html);

    // Track how many tenders were inserted during this run.
    let count = 0;

    // Grab all search result elements so we know the total number upfront.
    const results = $('.search-result').toArray();
    const total = results.length;

    // Iterate over each search result and insert it into the database. The
    // insertTender function resolves with the number of rows inserted so we can
    // keep track of how many new tenders were added.
    for (const [i, el] of results.entries()) {
      // Extract tender details from the DOM element.
      const title = $(el).find('h2').text().trim();
      const link =
        config.scrapeBase + $(el).find('a').attr('href');
      const date = $(el).find('.date').text().trim();
      const desc = $(el).find('p').text().trim();

      // Notify listeners of progress so the UI can be updated in real time.
      if (onProgress) {
        onProgress({ title, index: i + 1, total });
      }

      try {
        // Attempt to store the tender. `insertTender` resolves with 1 when a
        // new record was inserted or 0 if the tender already existed.
        const inserted = await db.insertTender(title, link, date, desc);

        if (inserted) {
          count += 1;
        }
      } catch (err) {
        // Log database errors but continue processing the remaining tenders.
        logger.error('Error inserting tender:', err);
      }
    }

    // Return the number of newly inserted tenders.
    return count;
  } catch (err) {
    // Network or parsing errors end up here. Return 0 to indicate no new data
    // was stored during this run.
    logger.error('Error fetching tenders:', err);
    return 0;
  }
};
