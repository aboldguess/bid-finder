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
    'https://www.contractsfinder.service.gov.uk',
  parser: 'contractsFinder'
};

// Additional example source. This can be overridden via environment variables
// and serves mainly to demonstrate the new source-selection feature.
const exampleSource = {
  label: 'Example Source',
  url: process.env.EXAMPLE_URL || 'https://example.com/search',
  base: process.env.EXAMPLE_BASE || 'https://example.com',
  parser: 'contractsFinder'
};

// Additional predefined sources showcasing how multiple tender portals can be
// targeted. These are merely examples and may not be fully compatible with the
// simple HTML parser used by the scraper.
const scotlandSource = {
  label: 'Public Contracts Scotland',
  url:
    process.env.SCOTLAND_URL ||
    'https://www.publiccontractsscotland.gov.uk/Search/search_main.aspx',
  base:
    process.env.SCOTLAND_BASE ||
    'https://www.publiccontractsscotland.gov.uk',
  parser: 'contractsFinder'
};

const walesSource = {
  label: 'Sell2Wales',
  url:
    process.env.WALES_URL ||
    'https://www.sell2wales.gov.wales/Search/Search_Switch.aspx',
  base: process.env.WALES_BASE || 'https://www.sell2wales.gov.wales',
  parser: 'sell2wales'
};

const ukriSource = {
  label: 'UKRI Opportunities',
  url: process.env.UKRI_URL || 'https://www.ukri.org/opportunity/',
  base: process.env.UKRI_BASE || 'https://www.ukri.org',
  parser: 'ukri'
};

const euSupplySource = {
  label: 'EU Supply UK',
  url:
    process.env.EUSUPPLY_URL ||
    'https://uk.eu-supply.com/ctm/supplier/publictenders?B=UK',
  base: process.env.EUSUPPLY_BASE || 'https://uk.eu-supply.com',
  parser: 'eusupply'
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
    example: exampleSource,
    scotland: scotlandSource,
    wales: walesSource,
    ukri: ukriSource,
    eusupply: euSupplySource
  },

  // Legacy fields maintained for backwards compatibility. These map to the
  // default source so existing code and tests continue to work.
  scrapeUrl: defaultSource.url,
  scrapeBase: defaultSource.base,

  // Cron expression determining when the scraper runs automatically
  cronSchedule: process.env.CRON_SCHEDULE || '0 6 * * *'
};

