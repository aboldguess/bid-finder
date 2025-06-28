const fetch = require('node-fetch');
const cheerio = require('cheerio');
const db = require('./db');

module.exports.run = async function () {
  const res = await fetch('https://www.contractsfinder.service.gov.uk/Search');
  const html = await res.text();
  const $ = cheerio.load(html);
  let count = 0;

  $('.search-result').each((i, el) => {
    const title = $(el).find('h2').text().trim();
    const link = 'https://www.contractsfinder.service.gov.uk' + $(el).find('a').attr('href');
    const date = $(el).find('.date').text().trim();
    const desc = $(el).find('p').text().trim();
    db.insertTender(title, link, date, desc);
    count++;
  });

  return count;
};
