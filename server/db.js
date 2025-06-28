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
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    link TEXT UNIQUE,
    date TEXT,
    description TEXT
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
   * @returns {Promise<number>} resolves with 1 when inserted or 0 if skipped
   */
  insertTender: (title, link, date, description) => {
    return new Promise((resolve, reject) => {
      db.run(
        // Use INSERT OR IGNORE so that duplicate links are skipped silently.
        "INSERT OR IGNORE INTO tenders (title, link, date, description) VALUES (?, ?, ?, ?)",
        [title, link, date, description],
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
  }
};
