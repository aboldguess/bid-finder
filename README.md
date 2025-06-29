# Procurement Scraper GUI

This application scrapes new tenders from the UK government's Contracts Finder website and the EU Supply portal (or other configurable sources) and displays them in a simple dashboard. Results are stored in a local SQLite database so you can browse them even after the scraper has finished running.

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
- **Add a source** using the *Add Source* form. Provide a key, label, search URL
  and base URL. The source is added immediately for the current session.
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
- `SCRAPE_URL` - URL used to fetch tender data.
- `SCRAPE_BASE` - base URL prepended to scraped tender links.
- `EUSUPPLY_URL` and `EUSUPPLY_BASE` - overrides for the built-in EU Supply source.
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

## Adding new sources

The dashboard includes a small form for defining additional tender sources at
runtime. Provide a unique key, display label, search URL and base URL. Newly
added sources appear in the drop-down menu immediately and are also stored in
the SQLite database so they are available after restarting the server.
