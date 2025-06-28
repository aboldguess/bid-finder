# Procurement Scraper GUI

This application scrapes new tenders from the UK government's Contracts Finder website (or other configurable sources) and displays them in a simple dashboard. Results are stored in a local SQLite database so you can browse them even after the scraper has finished running.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Initialise the database:
   ```bash
   npm run init-db
   ```
3. Start the server:
   ```bash
   node server/index.js
   ```
   The UI will be available at `http://localhost:<PORT>`.

## Environment variables

- `PORT` - port for the Express server (default `3000`).
- `FRONTEND_DIR` - directory for templates and static files.
- `DB_FILE` - path to the SQLite database file.
- `SCRAPE_URL` - URL used to fetch tender data.
- `SCRAPE_BASE` - base URL prepended to scraped tender links.
- `EXAMPLE_URL` and `EXAMPLE_BASE` - optional secondary source used in the
  dropdown menu.
- `SCOTLAND_URL` and `SCOTLAND_BASE` - overrides for the predefined Public
  Contracts Scotland source.
- `WALES_URL` and `WALES_BASE` - overrides for the predefined Sell2Wales source.
- `CRON_SCHEDULE` - cron expression controlling automatic scraping (defaults to `0 6 * * *`).

## Scheduled cron job

The scraper runs automatically using `node-cron`. With the default schedule `0 6 * * *` the job executes once every day at 06:00. Adjust `CRON_SCHEDULE` to change the frequency. You can also trigger a manual scrape by visiting `/scrape` or clicking the button on the dashboard.

## Real-time feedback

When a scrape is triggered the dashboard streams progress updates. It reports
the source being scraped, how many tenders were discovered and whether each one
was added to the database or skipped as a duplicate. A final message summarises
how many new tenders were stored.

## Adding new sources

The dashboard includes a small form for defining additional tender sources at
runtime. Provide a unique key, display label, search URL and base URL. Newly
added sources appear in the drop-down menu immediately but are not persisted
beyond the current process.
