# Procurement Scraper GUI

This application scrapes new tenders from several procurement portals including the UK government's Contracts Finder website, the EU Supply portal and example sources like Sell2Wales and UKRI. Results are stored in a local SQLite database so you can browse them even after the scraper has finished running.

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

## Usage

- **Access the dashboard** by navigating to `http://localhost:<PORT>` once the
  server is running.
- **Run the scraper** by selecting a source from the drop-down list and clicking
  **Scrape**. Progress messages stream to the page and new tenders appear in the
  results table.
- **Scrape all sources** at once by visiting `/scrape-all`. Each source is
  processed sequentially and the response details which succeeded or failed.
- **Add a source** using the *Add Source* form. Provide a key, label, search URL
  and base URL. Once submitted the new source is added immediately for the
  current session and saved to the database so it is available after restarting
  the server. See the "Adding new sources" section below for a detailed step by
  step guide.
- **Manage the application** by registering at `/register`, logging in at
  `/login` and visiting `/admin`. Only authenticated users can access admin
  functions.
- **Automatic scraping** runs in the background according to the `CRON_SCHEDULE`
  environment variable (default `0 6 * * *`). Results are stored in the
  database without any manual interaction.

## Environment variables

- `PORT` - port for the Express server (default `3000`).
- `FRONTEND_DIR` - directory for templates and static files.
- `DB_FILE` - path to the SQLite database file.
- `SCRAPE_URL` - URL used to fetch tender data for the default Contracts Finder feed.
- `SCRAPE_BASE` - base URL prepended to scraped tender links.
- `EUSUPPLY_URL` and `EUSUPPLY_BASE` - overrides for the built-in EU Supply source.
- `SELL2WALES_URL` and `SELL2WALES_BASE` - overrides for the Sell2Wales source.
- `UKRI_URL` and `UKRI_BASE` - overrides for the UKRI source.
- `PCS_URL` and `PCS_BASE` - overrides for Public Contracts Scotland.
- `ETENDERSNI_URL` and `ETENDERSNI_BASE` - overrides for eTenders NI.
- `ETENDERSIE_URL` and `ETENDERSIE_BASE` - overrides for eTenders Ireland.
- `PROCONTRACT_URL` and `PROCONTRACT_BASE` - overrides for ProContract.
- `INTEND_URL` and `INTEND_BASE` - overrides for In-Tend.
- `CRON_SCHEDULE` - cron expression controlling automatic scraping (defaults to `0 6 * * *`).

## Scheduled cron job

The scraper runs automatically using `node-cron`. With the default schedule `0 6 * * *` the job executes once every day at 06:00. Adjust `CRON_SCHEDULE` to change the frequency. You can also trigger a manual scrape by visiting `/scrape` or clicking the button on the dashboard. Any changes made via the admin interface are saved in the database so the chosen schedule is retained across restarts.

## Real-time feedback

When a scrape is triggered the dashboard streams progress updates. It reports
the source being scraped, how many tenders were discovered and whether each one
was added to the database or skipped as a duplicate. A final message summarises
how many new tenders were stored.

## Statistics

The `/stats` page displays when the scraper last completed successfully. This
helps you confirm that automated cron jobs are running as expected.

## Logs

All console output is also written to `logs/app.log` so you can review what the
scraper was doing after it finishes. The log file persists across restarts and
includes messages for every tender processed. If no new tenders are stored the
log will explain whether none were found or all were detected as duplicates.

## Adding new sources

The dashboard includes a small form for defining additional tender sources at
runtime. Follow these steps to register a new site:

1. Navigate to `/admin` and locate the **Add Source** form.
2. Enter a short **key** (letters and numbers only). This is used internally to
   identify the source.
3. Provide a descriptive **label** which will appear in the drop-down list on
   the dashboard.
4. Fill in the **search URL** pointing to the RSS feed or web page containing
   tenders.
5. Set the **base URL** that should be prepended to any relative links found in
   the feed.
6. Optionally specify a **parser** name. Use `rss` for RSS feeds or one of the
   custom parsers listed in `server/htmlParser.js`.
7. Click **Add Source** to save. The source is stored in the database and can be
   selected immediately.

The application ships with Contracts Finder, EU Supply and a selection of other
procurement portals pre-configured so you can start scraping immediately.
