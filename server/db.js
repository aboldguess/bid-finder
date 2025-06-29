const sqlite3 = require('sqlite3').verbose();
const config = require('./config');
const logger = require('./logger');

// Open a connection to the SQLite database. The file will be created
// automatically if it does not already exist.
const db = new sqlite3.Database(config.dbFile, err => {
  if (err) {
    // Log connection errors but allow the application to continue so that any
    // subsequent operations can surface their own failures clearly.
    logger.error('Failed to open database:', err);
  }
});

// Ensure the tenders table exists before we attempt any writes. This table will
// hold every tender that we scrape, avoiding duplicates via the UNIQUE link
// constraint.
// Create tables on startup if they do not already exist. Additional columns
// store metadata about where each tender came from and when it was scraped.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    link TEXT UNIQUE,
    date TEXT,
    description TEXT,
    /* Source site label */
    source TEXT,
    /* Time the tender was scraped (ISO string) */
    scraped_at TEXT
  )`);
  // Small metadata table used to store global key/value pairs such as the
  // timestamp of the last successful scrape. Using a key column keeps the
  // schema flexible should more values be needed later.
  db.run(`CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
});

module.exports = {
  /**
   * Insert a tender into the database if it does not already exist.
   *
   * @param {string} title - Tender title
   * @param {string} link - Unique link to the tender
   * @param {string} date - Published date string
   * @param {string} description - Short description of the tender
   * @param {string} source - Label of the source site
   * @param {string} scrapedAt - ISO timestamp when the tender was scraped
   * @returns {Promise<number>} resolves with 1 when inserted or 0 if skipped
   */
  insertTender: (title, link, date, description, source, scrapedAt) => {
    return new Promise((resolve, reject) => {
      db.run(
        // Use INSERT OR IGNORE so that duplicate links are skipped silently.
        "INSERT OR IGNORE INTO tenders (title, link, date, description, source, scraped_at) VALUES (?, ?, ?, ?, ?, ?)",
        [title, link, date, description, source, scrapedAt],
        function (err) {
          if (err) {
            // Propagate database errors to the caller.
            return reject(err);
          }

          // `this.changes` tells us whether a row was actually inserted (1) or
          // ignored because it already existed (0).
          resolve(this.changes);
        }
      );
    });
  },

  /**
   * Retrieve all stored tenders ordered by published date descending.
   * @returns {Promise<Array>} resolves with an array of tender rows
   */
  getTenders: () => {
    return new Promise((resolve, reject) => {
      db.all("SELECT * FROM tenders ORDER BY date DESC", [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  },

  /**
   * Store the timestamp of the last successful scrape. Using INSERT .. ON
   * CONFLICT means the row is created on first use and updated thereafter.
   *
   * @param {string} ts ISO timestamp string
   * @returns {Promise<void>} resolves when the value is written
   */
  setLastScraped: ts => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO metadata (key, value) VALUES ('last_scraped', ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [ts],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /**
   * Retrieve the timestamp of the most recent successful scrape.
   *
   * @returns {Promise<string|null>} ISO timestamp or null if none stored
   */
  getLastScraped: () => {
    return new Promise((resolve, reject) => {
      db.get(
        "SELECT value FROM metadata WHERE key='last_scraped'",
        (err, row) => {
          if (err) return reject(err);
          resolve(row ? row.value : null);
        }
      );
    });
  },

  /**
   * Drop and recreate the tenders table. This is used by the admin interface
   * to clear all stored data without restarting the application.
   * @returns {Promise<void>} resolves once the table has been recreated
   */
  reset: () => {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('DROP TABLE IF EXISTS tenders');
        db.run('DROP TABLE IF EXISTS metadata');
        db.run(`CREATE TABLE tenders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            link TEXT UNIQUE,
            date TEXT,
            description TEXT,
            source TEXT,
            scraped_at TEXT
          )`);
        db.run(`CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT
          )`, err2 => {
            if (err2) return reject(err2);
            resolve();
          });
      });
    });
  }
};
