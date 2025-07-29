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
   If the default port is already in use the server will automatically select
  the next free port. The UI will be available at `http://<HOST>:<PORT>`. When
  `HOST` is set to `0.0.0.0` (the default) the server listens on all network
  interfaces. Use the IP address of the machine in place of `<HOST>` when
  connecting from another computer.

### Raspberry Pi quickstart

The repository includes small helper scripts for Raspberry Pi systems. Run the
setup script once to install Node.js, initialise the database and optionally
start the server. Pass the `-p` flag to install only production dependencies and
provide a port number to immediately launch the application:

```bash
./scripts/rpi_bidfinder.sh -p 4000
```

## Usage

- **Access the dashboard** by navigating to `http://<HOST>:<PORT>/opportunities`
  once the server is running. If the server is bound to `0.0.0.0` replace `<HOST>`
  with the machine's actual IP address.
- **Manage sources** via the `/scraper` page where each source can be tested or
  scraped individually. Statistics such as last scraped time and number of
  contracts found are shown alongside edit options.
- **Scrape all sources** at once by visiting `/scrape-all`. Each source is
  processed sequentially and the response details which succeeded or failed.
- **Edit or delete sources** directly on the Scraper page which lists all
  configured entries.
- **Manage the application** by registering at `/register`, logging in at
  `/login` and visiting `/scraper`. Once logged in your session persists for 30 days
  so you remain authenticated after closing the browser. Only
  authenticated users can access these management functions.
- **Automatic scraping** runs in the background according to the `CRON_SCHEDULE`
  environment variable (default `0 6 * * *`). Results are stored in the
  database without any manual interaction.

## Environment variables

- `PORT` - port for the Express server (default `3000`). If this port is in use
  when the server starts you will be asked to supply a different value.
- `HOST` - interface the server listens on (default `0.0.0.0`).
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
- `TAG_RULES` - JSON mapping of tag names to keyword arrays for automatic tagging.

## Scheduled cron job

The scraper runs automatically using `node-cron`. With the default schedule `0 6 * * *` the job executes once every day at 06:00. Adjust `CRON_SCHEDULE` to change the frequency. You can also trigger a manual scrape by visiting `/scrape` or clicking the button on the dashboard. Any changes made via the Scraper page are saved in the database so the chosen schedule is retained across restarts.
The schedule form lists the hour before the minute for readability, but the cron expression itself always uses the order _minute hour_.

## Real-time feedback

When a scrape is triggered the dashboard streams progress updates. It reports
the source being scraped, how many tenders were discovered and whether each one
was added to the database or skipped as a duplicate. A final message summarises
how many new tenders were stored.

Each tender is deduplicated using its link and, when available, the procurement
identifier (OCID) extracted from the listing. This prevents multiple entries for
the same opportunity even if the URL changes between runs.

## Statistics

The `/stats` page lists detailed information about each configured source. It
shows when every site was last scraped, how many tenders were inserted during
the most recent run and the running total stored in the database. This helps
identify sources that consistently produce zero results so potential issues can
be debugged quickly.

## Logs

All console output is also written to `logs/app.log` so you can review what the
scraper was doing after it finishes. The log file persists across restarts and
includes messages for every tender processed. If no new tenders are stored the
log will explain whether none were found or all were detected as duplicates.

## Adding new sources

The dashboard includes a small form for defining additional tender sources at
runtime. Follow these steps to register a new site:
See the `/help` page for example configurations.

1. Navigate to `/scraper` and locate the **Add Source** form.
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
   selected immediately. A small JSON file (`sources.json`) is also written so
   custom sources survive server restarts even if the database is cleared.
8. Existing sources are shown in a list below the form. Click **Edit** to modify
   details or **Delete** to remove a source altogether.

When filling in the form you will be asked for five pieces of information:
- **Key** – a short unique identifier used internally (e.g. `eusupply`).
- **Label** – human readable name shown in the dashboard (e.g. `EU Supply UK`).
- **Search URL** – the RSS feed or results page to scrape (e.g. `https://uk.eu-supply.com/ctm/supplier/publictenders?B=UK`).
- **Base URL** – the website root prepended to tender links (e.g. `https://uk.eu-supply.com`).
- **Parser** – name of the parser to use such as `rss`, `eusupply`, `sell2wales`, `ukri` or the default `contractsFinder`.

Leaving the parser field empty will use `contractsFinder` which matches the built-in Contracts Finder listings.

The application ships with Contracts Finder, EU Supply and a selection of other
procurement portals pre-configured so you can start scraping immediately.

### Awarded contract sources

Award notices are scraped separately using the same mechanism. Use the **Award
Sources** form on the Scraper page to register feeds that list awarded
contracts. Example award sources are shown on the `/help` page. Like tender
sources, award feeds are also saved to `sources.json` to ensure they are
restored after a restart.
