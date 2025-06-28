# Procurement Scraper GUI

## Setup

1. Run `npm install`
2. Start the app with `node server/index.js`
3. The server listens on the port defined by the `PORT` environment variable
   (default `3000`). Visit `http://localhost:<PORT>` to use the UI.
4. Optional environment variables:
   - `DB_FILE` - location of the SQLite database file
   - `CRON_SCHEDULE` - cron expression for automatic scraping
   - `SCRAPE_URL` - URL to fetch tender data from

