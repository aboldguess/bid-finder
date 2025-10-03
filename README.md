# Procurement Scraper GUI

This application scrapes new tenders from several procurement portals including the UK government's Contracts Finder website, the EU Supply portal and example sources like Sell2Wales and UKRI. Results are stored in a local SQLite database so you can browse them even after the scraper has finished running.

Each opportunity's detail page is also fetched so that additional metadata,
including any CPV classification codes, can be captured. CPV codes are indexed
in the database allowing future filters by procurement category.

## Setup

1. Install dependencies:
 ```bash
  npm install
  ```
2. Initialise the database:
  ```bash
  npm run init-db
  ```
3. Set a strong session secret so login cookies can be safely signed. Replace
   the example text with your own random string.
   - **Linux/macOS/Raspberry Pi**
     ```bash
     export SESSION_SECRET="change_me_to_a_random_string"
     ```
   - **Windows PowerShell**
     ```powershell
     $env:SESSION_SECRET="change_me_to_a_random_string"
     ```
4. Start the server:
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
start the server. Pass the `-p` flag to install only production dependencies.
Supplying a port starts the server in the background and writes logs to
`logs/app.log` so the script returns to the shell immediately:

```bash
./scripts/rpi_bidfinder.sh -p 4000
tail -f logs/app.log    # monitor server logs
```

Stop the server later with:

```bash
pkill -f "node server/index.js"
```

## Usage

- **Access the dashboard** by navigating to `http://<HOST>:<PORT>/dashboard`
  once the server is running. If the server is bound to `0.0.0.0` replace `<HOST>`
  with the machine's actual IP address.
- **Explore live tenders** from the **Tenders** tab, which offers advanced
  filtering by keywords, CPV codes, time ranges and sources.
- **Log in or register** at `/login` or `/register` to unlock administration
  tools. Sessions persist for 30 days so you remain signed in between visits.
- **Open the Admin console** at `/admin` for a consolidated control centre that:
  - Displays live database statistics and the timestamp of the last scrape.
  - Provides a **Cron Scheduler** section for adjusting the automated scraping
    cadence with dropdowns for minute, hour, day, month and weekday.
  - Offers database maintenance controls with confirmation prompts.
  - Lets administrators create, reset or delete user accounts.
  - Hosts feed management forms for adding, editing, testing or deleting tender
    and award sources.
- **Scrape all sources** at once by visiting `/scrape-all`. Each source is
  processed sequentially and the response details which succeeded or failed.
- **Trigger targeted scrapes** with `/scrape?source=<KEY>` or
  `/scrape-awarded?source=<KEY>` to refresh a single feed when diagnosing issues.
- **Automatic scraping** runs in the background according to the cron expression
  stored in the database. Adjust it from the Admin console or set the
  `CRON_SCHEDULE` environment variable before starting the server.

## Environment variables

- `PORT` - port for the Express server (default `3000`). If this port is in use
  when the server starts you will be asked to supply a different value.
- `HOST` - interface the server listens on (default `0.0.0.0`).
- `FRONTEND_DIR` - directory for templates and static files.
- `DB_FILE` - path to the SQLite database file.
- `SESSION_SECRET` - **required** secret used to sign session cookies. The server
  exits on startup if this is missing. Generate a long random string for
  production use.
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
- `ADMIN_USERS` - optional comma-separated list of usernames granted administrator
  access. When provided, sensitive routes like `/logs` are restricted to these
  accounts.
- `ENABLE_LOG_STREAM` - set to `false` to disable the `/logs` streaming endpoint
  in production and avoid exposing real-time log data if not required.
- `ALLOWED_SOURCE_DOMAINS` - comma-separated list of additional hostnames that
  administrators are permitted to use when defining custom feeds. The value is
  merged with the built-in allow list (which already includes
  `contracts.mod.uk` for the DSTL portal).

### Allowing additional source domains

If you see a message similar to `Search URL rejected: Host "contracts.mod.uk"
is not on the allow list` while adding a feed, extend the allow list using the
`ALLOWED_SOURCE_DOMAINS` environment variable. Example commands:

- **Linux/macOS/Raspberry Pi**
  ```bash
  export ALLOWED_SOURCE_DOMAINS="contracts.mod.uk"
  ```
- **Windows PowerShell**
  ```powershell
  $env:ALLOWED_SOURCE_DOMAINS="contracts.mod.uk"
  ```

Restart the server after setting the variable so the new domains are loaded.
Multiple hostnames can be supplied by separating them with commas, for example
`contracts.mod.uk,example.org`.

For convenience, the helper script below can export the variable and launch the
server in one step:

```bash
./scripts/run.sh --allow-domain contracts.mod.uk
```

To configure a Raspberry Pi in a single command, the setup script forwards the
same option to the background server:

```bash
./scripts/rpi_bidfinder.sh --allow-domain contracts.mod.uk 4000
```

## Scheduled cron job

The scraper runs automatically using `node-cron`. With the default schedule `0 6 * * *` the job executes once every day at 06:00. Adjust `CRON_SCHEDULE` to change the frequency before the server starts or tweak the value live from the Cron Scheduler panel on the Admin console. Manual scrapes remain available via `/scrape` or the dashboard button, and any updates made in the UI are persisted in the database so the chosen cadence is retained across restarts.
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

For real-time monitoring the dashboard opens a Server-Sent Events connection to
`/logs` and streams new log entries as they happen. Set `ENABLE_LOG_STREAM=false`
in production if you do not require this live feed or wish to avoid exposing
log data over HTTP.

## Session storage

User login sessions persist across server restarts using a small SQLite database
(`sessions.sqlite`) created in the project root. The database is managed via the
`connect-sqlite3` library and can be safely backed up or removed to clear all
sessions.

## Adding new sources

The Admin console includes dedicated forms for defining additional tender
sources at runtime. Follow these steps to register a new site. See the `/help`
page for example configurations.

1. Navigate to `/admin` and locate the **Tender sources** form.
2. Enter a short **key** (letters and numbers only). This is used internally to
   identify the source.
3. Provide a descriptive **label** which will appear in dropdowns across the
   dashboard and reporting tools.
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
Sources** form on the Admin console to register feeds that list awarded
contracts. Example award sources are shown on the `/help` page. Like tender
sources, award feeds are also saved to `sources.json` to ensure they are
restored after a restart.
