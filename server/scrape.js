const fetch = require('node-fetch');
const cheerio = require('cheerio');
const db = require('./db');

module.exports.run = async function () {
  try {
    // Fetch the search page with a realistic User-Agent so the request looks
    // like it is coming from a normal browser.
    const res = await fetch('https://www.contractsfinder.service.gov.uk/Search', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });

    const html = await res.text();
    const $ = cheerio.load(html);
    let count = 0;

    // Iterate over each search result and insert it into the database. The
    // insertTender function resolves with the number of rows inserted so we can
    // keep track of how many new tenders were added.
    for (const el of $('.search-result').toArray()) {
      const title = $(el).find('h2').text().trim();
      const link =
        'https://www.contractsfinder.service.gov.uk' + $(el).find('a').attr('href');
      const date = $(el).find('.date').text().trim();
      const desc = $(el).find('p').text().trim();

      try {
        const inserted = await db.insertTender(title, link, date, desc);
        if (inserted) {
          count += 1;
        }
      } catch (err) {
        // Log database errors but continue processing the remaining tenders
        console.error('Error inserting tender:', err);
      }
    }

    return count;
  } catch (err) {
    // Any errors fetching or parsing the page are logged here
    console.error('Error fetching tenders:', err);
    return 0;
  }
};
