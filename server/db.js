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
    ocid TEXT UNIQUE,
    date TEXT,
    description TEXT,
    /* Source site label */
    source TEXT,
    /* Time the tender was scraped (ISO string) */
    scraped_at TEXT,
    /* Comma separated tags generated from the title/description */
    tags TEXT,
    /* Comma separated CPV classification codes */
    cpv TEXT,
    /* Additional metadata extracted from the detail page */
    open_date TEXT,
    deadline TEXT,
    customer TEXT,
    address TEXT,
    country TEXT,
    eligibility TEXT
  )`);
  // Older installations may lack some of the newer columns. Check the table
  // schema and add any missing columns so inserts do not fail.
  db.all('PRAGMA table_info(tenders)', (err, cols) => {
    if (err) return logger.error('Failed to read schema:', err);
    const has = name => cols.some(c => c.name === name);
    const addColumn = name =>
      db.run(`ALTER TABLE tenders ADD COLUMN ${name} TEXT`, alterErr => {
        if (alterErr) {
          return logger.error(`Failed to add ${name} column:`, alterErr);
        }
        logger.info(`Added missing ${name} column to tenders table`);
      });
    const ensureOcidIndex = () =>
      db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_tenders_ocid ON tenders(ocid)'
      );
    const ensureCpvIndex = () =>
      db.run('CREATE INDEX IF NOT EXISTS idx_tenders_cpv ON tenders(cpv)');
    if (!has('ocid')) {
      addColumn('ocid');
      ensureOcidIndex();
    } else {
      ensureOcidIndex();
    }
    if (!has('cpv')) {
      addColumn('cpv');
      ensureCpvIndex();
    } else {
      ensureCpvIndex();
    }
    ['open_date', 'deadline', 'customer', 'address', 'country', 'eligibility'].forEach(
      col => {
        if (!has(col)) {
          addColumn(col);
        }
      }
    );
  });
  // Reference table for CPV codes loaded from the official list.
  db.run(
    `CREATE TABLE IF NOT EXISTS cpv_codes (
      code TEXT PRIMARY KEY,
      description TEXT
    )`
  );
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

  // Mirror of the sources table used for awarded contract scraping. Keeping a
  // separate table allows award sources to be managed independently of the
  // regular tender sources.
  db.run(`CREATE TABLE IF NOT EXISTS award_sources (
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

  // Separate table to track awarded contracts scraped from public sources.
  // The structure mirrors the `tenders` table so existing logic can be reused
  // with minimal changes.
  db.run(`CREATE TABLE IF NOT EXISTS awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    link TEXT UNIQUE,
    date TEXT,
    description TEXT,
    source TEXT,
    scraped_at TEXT,
    tags TEXT
  )`);

  // Additional information scraped from individual award pages. Each row
  // references the main award via award_id so that not all sources are
  // required to provide these optional fields.
  db.run(`CREATE TABLE IF NOT EXISTS award_details (
    award_id INTEGER PRIMARY KEY,
    buyer TEXT,
    status TEXT,
    industry TEXT,
    location TEXT,
    value TEXT,
    procurement_reference TEXT,
    closing_date TEXT,
    closing_time TEXT,
    start_date TEXT,
    end_date TEXT,
    contract_type TEXT,
    procedure_type TEXT,
    procedure_desc TEXT,
    suitable_for_sme INTEGER,
    suitable_for_vcse INTEGER,
    how_to_apply TEXT,
    buyer_address TEXT,
    buyer_email TEXT,
    FOREIGN KEY(award_id) REFERENCES awards(id)
  )`);

  // Organisations referenced in tenders or awards. The type column
  // indicates whether the organisation is a customer or supplier.
  db.run(`CREATE TABLE IF NOT EXISTS organisations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    type TEXT,
    UNIQUE(name, type)
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
  insertTender: (
    title,
    link,
    date,
    description,
    source,
    scrapedAt,
    tags,
    ocid = null,
    cpv = '',
    openDate = '',
    deadline = '',
    customer = '',
    address = '',
    country = '',
    eligibility = ''
  ) => {
    return new Promise((resolve, reject) => {
      db.run(
        // Use INSERT OR IGNORE so that duplicate links or OCIDs are skipped silently.
        "INSERT OR IGNORE INTO tenders (title, link, ocid, date, description, source, scraped_at, tags, cpv, open_date, deadline, customer, address, country, eligibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          title,
          link,
          ocid,
          date,
          description,
          source,
          scrapedAt,
          tags,
          cpv,
          openDate,
          deadline,
          customer,
          address,
          country,
          eligibility
        ],
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
   *
   * This helper is retained for backwards compatibility in places that
   * expect all rows at once (primarily tests). New code should prefer
   * {@link getTendersPage} so large result sets can be fetched in chunks.
   *
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
   * Retrieve a single page of tenders ordered by published date.
   *
   * @param {number} limit  Maximum number of rows to return
   * @param {number} offset Number of rows to skip from the start of the table
   * @returns {Promise<Array>} resolves with the requested tender rows
   */
  getTendersPage: (limit, offset) => {
    return new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM tenders ORDER BY date DESC LIMIT ? OFFSET ?",
        [limit, offset],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  },

  /**
   * Insert an awarded contract if it does not already exist. The parameters
   * mirror insertTender so the scraper logic can be reused for awarded data.
   */
  insertAward: (title, link, date, description, source, scrapedAt, tags) => {
    return new Promise((resolve, reject) => {
      db.run(
        "INSERT OR IGNORE INTO awards (title, link, date, description, source, scraped_at, tags) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [title, link, date, description, source, scrapedAt, tags],
        function (err) {
          if (err) return reject(err);
          // Resolve with an object so callers can access the inserted row id
          // when a new award is stored.
          resolve({ changes: this.changes, id: this.lastID });
        }
      );
    });
  },

  /**
   * Retrieve all stored awarded contracts ordered by published date.
   */
  getAwards: () => {
    return new Promise((resolve, reject) => {
      db.all("SELECT * FROM awards ORDER BY date DESC", [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  /**
   * Insert additional details for an award. The details object may contain
   * any of the optional fields extracted from the award page.
   *
   * @param {number} awardId - ID of the award row this data relates to
   * @param {object} details - Key/value pairs of extra information
   * @returns {Promise<void>} resolves when stored
   */
  insertAwardDetails: (awardId, details) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO award_details (
          award_id, buyer, status, industry, location, value,
          procurement_reference, closing_date, closing_time,
          start_date, end_date, contract_type, procedure_type,
          procedure_desc, suitable_for_sme, suitable_for_vcse,
          how_to_apply, buyer_address, buyer_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          awardId,
          details.buyer || '',
          details.status || '',
          details.industry || '',
          details.location || '',
          details.value || '',
          details.procurement_reference || '',
          details.closing_date || '',
          details.closing_time || '',
          details.start_date || '',
          details.end_date || '',
          details.contract_type || '',
          details.procedure_type || '',
          details.procedure_desc || '',
          details.suitable_for_sme ? 1 : 0,
          details.suitable_for_vcse ? 1 : 0,
          details.how_to_apply || '',
          details.buyer_address || '',
          details.buyer_email || ''
        ],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /**
   * Retrieve stored details for a specific award.
   * @param {number} awardId - Award identifier
   * @returns {Promise<object|null>} resolves with the row or null
   */
  getAwardDetails: awardId => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM award_details WHERE award_id = ?',
        [awardId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
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
   * Insert an organisation if it does not already exist. The type should be
   * either 'customer' or 'supplier'.
   *
   * @param {string} name - Organisation name
   * @param {string} type - Type of organisation
   * @returns {Promise<number>} resolves with 1 when inserted or 0 if skipped
   */
  insertOrganisation: (name, type) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT OR IGNORE INTO organisations (name, type) VALUES (?, ?)',
        [name, type],
        function (err) {
          if (err) return reject(err);
          resolve(this.changes);
        }
      );
    });
  },

  /**
   * Retrieve all organisations of the given type ordered alphabetically.
   *
   * @param {string} type - Organisation type
   * @returns {Promise<Array>} resolves with organisation rows
   */
  getOrganisationsByType: type => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT name FROM organisations WHERE type = ? ORDER BY name',
        [type],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },

  /**
   * Count how many tenders have been stored.
   *
   * @returns {Promise<number>} total number of tender rows
   */
  getTenderCount: () => {
    return new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS c FROM tenders', (err, row) => {
        if (err) return reject(err);
        resolve(row.c);
      });
    });
  },

  /**
   * Count stored awarded contracts.
   *
   * @returns {Promise<number>} total number of award rows
   */
  getAwardCount: () => {
    return new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS c FROM awards', (err, row) => {
        if (err) return reject(err);
        resolve(row.c);
      });
    });
  },

  /**
   * Count organisations of a particular type such as 'customer' or 'supplier'.
   *
   * @param {string} type - Organisation type to count
   * @returns {Promise<number>} number of organisations
   */
  getOrganisationCount: type => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT COUNT(*) AS c FROM organisations WHERE type = ?',
        [type],
        (err, row) => {
          if (err) return reject(err);
          resolve(row.c);
        }
      );
    });
  },

  /**
   * Delete all tenders from the database. Used by admin tools to clear
   * stored data without dropping and recreating the entire schema.
   *
   * @returns {Promise<void>} resolves when all rows are removed
   */
  deleteAllTenders: () => {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM tenders', err => {
        if (err) return reject(err);
        resolve();
      });
    });
  },

  /**
   * Delete tenders older than a specific published date.
   *
   * @param {string} date - ISO date string, rows with a date prior to this are removed
   * @returns {Promise<void>} resolves when deletion completes
   */
  deleteTendersBefore: date => {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM tenders WHERE date < ?', [date], err => {
        if (err) return reject(err);
        resolve();
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
   * Insert a new award source definition.
   * Mirrors insertSource but targets the award_sources table.
   */
  insertAwardSource: (key, label, url, base, parser) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT OR IGNORE INTO award_sources (key, label, url, base, parser) VALUES (?, ?, ?, ?, ?)',
        [key, label, url, base, parser],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /** Retrieve all stored award sources. */
  getAwardSources: () => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM award_sources', (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  /** Update an existing award source definition. */
  updateAwardSource: (key, label, url, base, parser) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE award_sources SET label = ?, url = ?, base = ?, parser = ? WHERE key = ?',
        [label, url, base, parser, key],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /** Delete an award source completely. */
  deleteAwardSource: key => {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM award_sources WHERE key = ?', [key], err => {
        if (err) return reject(err);
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
        db.run('DROP TABLE IF EXISTS award_sources');
        db.run('DROP TABLE IF EXISTS awards');
        db.run('DROP TABLE IF EXISTS award_details');
        db.run('DROP TABLE IF EXISTS organisations');
        db.run(`CREATE TABLE tenders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            link TEXT UNIQUE,
            ocid TEXT UNIQUE,
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
        db.run(`CREATE TABLE award_sources (
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
        db.run(`CREATE TABLE awards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            link TEXT UNIQUE,
            date TEXT,
            description TEXT,
            source TEXT,
            scraped_at TEXT,
            tags TEXT
          )`);
        db.run(`CREATE TABLE award_details (
            award_id INTEGER PRIMARY KEY,
            buyer TEXT,
            status TEXT,
            industry TEXT,
            location TEXT,
            value TEXT,
            procurement_reference TEXT,
            closing_date TEXT,
            closing_time TEXT,
            start_date TEXT,
            end_date TEXT,
            contract_type TEXT,
            procedure_type TEXT,
            procedure_desc TEXT,
            suitable_for_sme INTEGER,
            suitable_for_vcse INTEGER,
            how_to_apply TEXT,
            buyer_address TEXT,
            buyer_email TEXT,
            FOREIGN KEY(award_id) REFERENCES awards(id)
          )`);
        db.run(`CREATE TABLE organisations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            type TEXT,
            UNIQUE(name, type)
          )`, err2 => {
            if (err2) return reject(err2);
            resolve();
          });
      });
    });
  }
};
