# Procurement Scraper GUI

## Setup

1. Run `npm install`
2. Initialise the database with `npm run init-db`
3. Start the app with `node server/index.js`
4. The server listens on the port defined by the `PORT` environment variable
   (default `3000`). Visit `http://localhost:<PORT>` to use the UI.
5. Optional environment variables:
   - `DB_FILE` - location of the SQLite database file
   - `CRON_SCHEDULE` - cron expression for automatic scraping
   - `SCRAPE_URL` - URL to fetch tender data from

