const path = require('path');

// Centralised configuration object used throughout the server code. Values can
// be overridden via environment variables for flexibility in different
// deployment environments.

// Default data source pointing at the UK government's Contracts Finder site.
const defaultSource = {
  label: 'Contracts Finder',
  url:
    process.env.SCRAPE_URL ||
    'https://www.contractsfinder.service.gov.uk/Search',
  base:
    process.env.SCRAPE_BASE ||
    'https://www.contractsfinder.service.gov.uk'
};

// Additional example source. This can be overridden via environment variables
// and serves mainly to demonstrate the new source-selection feature.
const exampleSource = {
  label: 'Example Source',
  url: process.env.EXAMPLE_URL || 'https://example.com/search',
  base: process.env.EXAMPLE_BASE || 'https://example.com'
};

module.exports = {
  // Port the Express server listens on
  port: process.env.PORT || 3000,

  // Directory containing frontend templates and static assets
  frontendDir: process.env.FRONTEND_DIR || path.join(__dirname, '../frontend'),

  // Location of the SQLite database file
  dbFile: process.env.DB_FILE || path.join(__dirname, '../tenders.db'),

  // Object containing all available scraping sources. Additional sources can be
  // added here or injected via environment variables.
  sources: {
    default: defaultSource,
    example: exampleSource
  },

  // Legacy fields maintained for backwards compatibility. These map to the
  // default source so existing code and tests continue to work.
  scrapeUrl: defaultSource.url,
  scrapeBase: defaultSource.base,

  // Cron expression determining when the scraper runs automatically
  cronSchedule: process.env.CRON_SCHEDULE || '0 6 * * *'
};
