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
    scraped_at TEXT,
    /* Comma separated tags generated from the title/description */
    tags TEXT
  )`);
  // Small metadata table used to store global key/value pairs such as the
  // timestamp of the last successful scrape. Using a key column keeps the
  // schema flexible should more values be needed later.
  db.run(`CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  // Store registered users. Passwords are hashed using bcrypt before
  // insertion so this table only needs to hold the username and hash.
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);

  // Persist custom scraping sources so they survive process restarts. Each
  // source is keyed by a short unique string which is also used in the
  // `config.sources` object. Having the parser column allows different HTML
  // extraction strategies to be used for each source.
  db.run(`CREATE TABLE IF NOT EXISTS sources (
    key TEXT PRIMARY KEY,
    label TEXT,
    url TEXT,
    base TEXT,
    parser TEXT
  )`);

  // Track per-source scraping statistics so the admin UI can show when each
  // source was last scraped and how many tenders were stored.
  db.run(`CREATE TABLE IF NOT EXISTS source_stats (
    key TEXT PRIMARY KEY,
    last_scraped TEXT,
    last_added INTEGER,
    total INTEGER
  )`);

  // Suppliers and customers are stored separately so dedicated pages can list
  // every organisation mentioned in the scraped tenders. Using UNIQUE on the
  // name column avoids duplicates when the same organisation appears multiple
  // times across different runs.
  db.run(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    source TEXT,
    scraped_at TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    source TEXT,
    scraped_at TEXT
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
   * @param {string} tags - Comma separated tags for the tender
   * @returns {Promise<number>} resolves with 1 when inserted or 0 if skipped
   */
  insertTender: (title, link, date, description, source, scrapedAt, tags) => {
    return new Promise((resolve, reject) => {
      db.run(
        // Use INSERT OR IGNORE so that duplicate links are skipped silently.
        "INSERT OR IGNORE INTO tenders (title, link, date, description, source, scraped_at, tags) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [title, link, date, description, source, scrapedAt, tags],
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
   * Persist the cron schedule expression in the metadata table. Using
   * INSERT .. ON CONFLICT allows the value to be updated without creating
   * duplicate rows.
   *
   * @param {string} schedule - Cron expression to store
   * @returns {Promise<void>} resolves when written
   */
  setCronSchedule: schedule => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO metadata (key, value) VALUES ('cron_schedule', ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [schedule],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /**
   * Retrieve the stored cron schedule expression if one has been saved.
   *
   * @returns {Promise<string|null>} cron expression or null when absent
   */
  getCronSchedule: () => {
    return new Promise((resolve, reject) => {
      db.get(
        "SELECT value FROM metadata WHERE key='cron_schedule'",
        (err, row) => {
          if (err) return reject(err);
          resolve(row ? row.value : null);
        }
      );
    });
  },

  /**
   * Insert a new scraping source definition.
   *
   * @param {string} key - Unique identifier used in config.sources
   * @param {string} label - Display name for the source
   * @param {string} url - Search URL
   * @param {string} base - Base URL for tender links
   * @param {string} parser - htmlParser key determining which parser to use
   * @returns {Promise<void>} resolves once the row has been inserted
   */
  insertSource: (key, label, url, base, parser) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT OR IGNORE INTO sources (key, label, url, base, parser) VALUES (?, ?, ?, ?, ?)',
        [key, label, url, base, parser],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /**
   * Retrieve all stored scraping sources.
   *
   * @returns {Promise<Array>} resolves with each source row
   */
  getSources: () => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM sources', (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  /**
   * Retrieve scraping statistics for all sources.
   *
   * @returns {Promise<Array>} resolves with rows from source_stats
   */
  getSourceStats: () => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM source_stats', (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  /**
   * Insert a supplier name if it has not been seen before.
   *
   * @param {string} name - Supplier organisation name
   * @param {string} source - Scraping source label
   * @param {string} ts - ISO timestamp when discovered
   * @returns {Promise<number>} resolves with 1 when inserted or 0 if duplicate
   */
  insertSupplier: (name, source, ts) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT OR IGNORE INTO suppliers (name, source, scraped_at) VALUES (?, ?, ?)',
        [name, source, ts],
        function (err) {
          if (err) return reject(err);
          resolve(this.changes);
        }
      );
    });
  },

  /**
   * Insert a customer organisation if new.
   *
   * @param {string} name - Customer name
   * @param {string} source - Scraping source label
   * @param {string} ts - ISO timestamp
   * @returns {Promise<number>} resolves with 1 when inserted or 0 if duplicate
   */
  insertCustomer: (name, source, ts) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT OR IGNORE INTO customers (name, source, scraped_at) VALUES (?, ?, ?)',
        [name, source, ts],
        function (err) {
          if (err) return reject(err);
          resolve(this.changes);
        }
      );
    });
  },

  /**
   * Retrieve all suppliers ordered alphabetically.
   *
   * @returns {Promise<Array>} resolves with supplier rows
   */
  getSuppliers: () => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM suppliers ORDER BY name', (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  /**
   * Retrieve all customers ordered alphabetically.
   *
   * @returns {Promise<Array>} resolves with customer rows
   */
  getCustomers: () => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM customers ORDER BY name', (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  /**
   * Update an existing scraping source definition. The key cannot be changed
   * as it forms the primary identifier used throughout the application.
   *
   * @param {string} key - Identifier of the source to update
   * @param {string} label - New display label
   * @param {string} url - Updated search URL
   * @param {string} base - Updated base URL for tender links
   * @param {string} parser - Parser name to use for this source
   * @returns {Promise<void>} resolves once the row has been updated
   */
  updateSource: (key, label, url, base, parser) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE sources SET label = ?, url = ?, base = ?, parser = ? WHERE key = ?',
        [label, url, base, parser, key],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /**
   * Remove a scraping source completely.
   *
   * @param {string} key - Identifier of the source to delete
   * @returns {Promise<void>} resolves once the row has been removed
   */
  deleteSource: key => {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM sources WHERE key = ?', [key], err => {
        if (err) return reject(err);
        // Remove any statistics tracked for this source as well.
        db.run('DELETE FROM source_stats WHERE key = ?', [key], err2 => {
          if (err2) return reject(err2);
          resolve();
        });
      });
    });
  },

  /**
   * Update scraping statistics for a source after a run completes. The row is
   * created on first use and the total count is incremented with each update.
   *
   * @param {string} key - Source identifier
   * @param {string} ts - ISO timestamp when the run finished
   * @param {number} added - Number of tenders inserted during the run
   * @returns {Promise<void>} resolves when the stats are stored
   */
  updateSourceStats: (key, ts, added) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO source_stats (key, last_scraped, last_added, total)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           last_scraped=excluded.last_scraped,
           last_added=excluded.last_added,
           total=source_stats.total + excluded.last_added`,
        [key, ts, added, added],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /**
   * Create a new user with the given username and hashed password.
   *
   * @param {string} username - Unique username for the account
   * @param {string} passwordHash - Bcrypt hashed password string
   * @returns {Promise<void>} resolves once the row is inserted
   */
  createUser: (username, passwordHash) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, passwordHash],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /**
   * Look up a user by username.
   *
   * @param {string} username - Username to search for
   * @returns {Promise<object|null>} resolves with the user row or null if none
   */
  getUserByUsername: username => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE username = ?',
        [username],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
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
        db.run('DROP TABLE IF EXISTS users');
        db.run('DROP TABLE IF EXISTS sources');
        db.run('DROP TABLE IF EXISTS source_stats');
        db.run('DROP TABLE IF EXISTS suppliers');
        db.run('DROP TABLE IF EXISTS customers');
        db.run(`CREATE TABLE tenders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            link TEXT UNIQUE,
            date TEXT,
            description TEXT,
            source TEXT,
            scraped_at TEXT,
            tags TEXT
          )`);
        db.run(`CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT
          )`);
        db.run(`CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
          )`);
        db.run(`CREATE TABLE sources (
            key TEXT PRIMARY KEY,
            label TEXT,
            url TEXT,
            base TEXT,
            parser TEXT
          )`);
        db.run(`CREATE TABLE source_stats (
            key TEXT PRIMARY KEY,
            last_scraped TEXT,
            last_added INTEGER,
            total INTEGER
          )`);
        db.run(`CREATE TABLE suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            source TEXT,
            scraped_at TEXT
          )`);
        db.run(`CREATE TABLE customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            source TEXT,
            scraped_at TEXT
          )`, err2 => {
            if (err2) return reject(err2);
            resolve();
          });
      });
    });
  }
};
