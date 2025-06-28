const path = require('path');

// Centralised configuration object used throughout the server code. Values can
// be overridden via environment variables for flexibility in different
// deployment environments.
module.exports = {
  // Port the Express server listens on
  port: process.env.PORT || 3000,

  // Directory containing frontend templates and static assets
  frontendDir: process.env.FRONTEND_DIR || path.join(__dirname, '../frontend'),

  // Location of the SQLite database file
  dbFile: process.env.DB_FILE || path.join(__dirname, '../tenders.db'),

  // URL used to fetch the tender search page
  scrapeUrl:
    process.env.SCRAPE_URL ||
    'https://www.contractsfinder.service.gov.uk/Search',

  // Base URL prepended to scraped tender links
  scrapeBase:
    process.env.SCRAPE_BASE ||
    'https://www.contractsfinder.service.gov.uk',

  // Cron expression determining when the scraper runs automatically
  cronSchedule: process.env.CRON_SCHEDULE || '0 6 * * *'
};
