/**
 * @file db.js
 * @description Centralised database helper wrapping SQLite interactions. It
 * establishes connections, ensures schema consistency and exposes helper
 * methods for managing tenders, sources and related metadata.
 */
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
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

// Track whether the CPV lookup table has already been hydrated during the
// current process lifetime. Loading the XML list repeatedly is unnecessary and
// wastes I/O, so the promise is reused while a load is in progress.
let cpvLoadPromise = null;

// Shared path to the CPV XML reference file packaged with the repository.
const cpvXmlPath = path.join(__dirname, '..', 'cpv_2008_xml', 'cpv_2008.xml');

// Ensure the tenders table exists before we attempt any writes. This table will
// hold every tender that we scrape, avoiding duplicates via the UNIQUE link
// constraint.
let schemaResolve;
let schemaReject;
const schemaReady = new Promise((resolve, reject) => {
  schemaResolve = resolve;
  schemaReject = reject;
});

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
    eligibility TEXT,
    /* Raw JSON payload containing the listing and parsed detail data */
    raw_details TEXT
  )`);
  // Older installations may lack some of the newer columns. Check the table
  // schema and add any missing columns so inserts do not fail.
  db.all('PRAGMA table_info(tenders)', (err, cols) => {
    if (err) {
      logger.error('Failed to read schema:', err);
      schemaReject(err);
      return;
    }
    const has = name => cols.some(c => c.name === name);
    const runStatement = sql =>
      new Promise((resolve, reject) => {
        db.run(sql, alterErr => {
          if (alterErr) {
            const message = alterErr.message || '';
            if (/duplicate column|already exists/i.test(message)) {
              return resolve();
            }
            return reject(alterErr);
          }
          resolve();
        });
      });

    (async () => {
      try {
        if (!has('ocid')) {
          await runStatement('ALTER TABLE tenders ADD COLUMN ocid TEXT');
          logger.info('Added missing ocid column to tenders table');
        }
        await runStatement(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_tenders_ocid ON tenders(ocid)'
        );
        if (!has('cpv')) {
          await runStatement('ALTER TABLE tenders ADD COLUMN cpv TEXT');
          logger.info('Added missing cpv column to tenders table');
        }
        await runStatement(
          'CREATE INDEX IF NOT EXISTS idx_tenders_cpv ON tenders(cpv)'
        );
        for (const col of [
          'open_date',
          'deadline',
          'customer',
          'address',
          'country',
          'eligibility',
          'raw_details'
        ]) {
          if (!has(col)) {
            await runStatement(`ALTER TABLE tenders ADD COLUMN ${col} TEXT`);
            logger.info(`Added missing ${col} column to tenders table`);
          }
        }
        schemaResolve();
      } catch (migrationErr) {
        logger.error('Failed to migrate tenders schema:', migrationErr);
        schemaReject(migrationErr);
      }
    })();
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

  // Store per-user CPV favourites so shortlisted codes persist across devices.
  db.run(`CREATE TABLE IF NOT EXISTS cpv_favourites (
    user_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, code),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
  db.run(
    `CREATE TABLE IF NOT EXISTS organisations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    type TEXT,
    UNIQUE(name, type)
  )`,
    err => {
      if (err) {
        schemaReject(err);
      }
    }
  );
});

/**
 * Ensure the CPV lookup table contains data by hydrating it from the bundled
 * XML file on demand. The import only runs when the table is empty so the
 * operation is effectively idempotent even across application restarts.
 *
 * @returns {Promise<boolean>} resolves true when data was imported, false when
 *   the table already contained rows.
 */
function ensureCpvCodesLoaded() {
  if (cpvLoadPromise) {
    return cpvLoadPromise;
  }

  cpvLoadPromise = new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) AS c FROM cpv_codes', (countErr, row) => {
      if (countErr) {
        cpvLoadPromise = null;
        return reject(countErr);
      }
      if (row && row.c > 0) {
        cpvLoadPromise = null;
        return resolve(false);
      }

      fs.readFile(cpvXmlPath, 'utf8', (readErr, xmlData) => {
        if (readErr) {
          cpvLoadPromise = null;
          return reject(readErr);
        }

        const entries = [];
        const cpvRegex = /<CPV CODE="(\d{8})-\d">([\s\S]*?)<\/CPV>/g;
        const textRegex = /<TEXT LANG="EN">([^<]+)<\/TEXT>/;
        let match;
        while ((match = cpvRegex.exec(xmlData)) !== null) {
          const [, code, block] = match;
          const textMatch = textRegex.exec(block);
          const description = textMatch ? textMatch[1].trim() : '';
          if (!code) continue;
          entries.push({ code, description });
        }

        db.serialize(() => {
          const stmt = db.prepare(
            'INSERT OR REPLACE INTO cpv_codes (code, description) VALUES (?, ?)'
          );
          entries.forEach(entry => {
            stmt.run(entry.code, entry.description, err => {
              if (err) {
                logger.error('Failed to store CPV code %s: %s', entry.code, err.message);
              }
            });
          });
          stmt.finalize(finalizeErr => {
            cpvLoadPromise = null;
            if (finalizeErr) {
              return reject(finalizeErr);
            }
            logger.info('Hydrated CPV lookup table with %d entries', entries.length);
            resolve(true);
          });
        });
      });
    });
  });

  return cpvLoadPromise;
}

/**
 * Convert a tender date string into a normalised Date instance.
 *
 * Historical data is often stored using a mix of ISO dates (2024-06-01),
 * slashed values (01/06/2024) and natural language strings ("7 June 2024").
 * For comparison queries we convert everything to a midnight UTC timestamp so
 * lexical quirks do not affect ordering.
 *
 * @param {string} value - Raw date string stored in the database.
 * @returns {Date|null} Date instance when parsing succeeds, otherwise null.
 */
function normaliseTenderDate(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;

  const buildDate = (year, month, day) => {
    const y = Number.parseInt(year, 10);
    const m = Number.parseInt(month, 10);
    const d = Number.parseInt(day, 10);
    if ([y, m, d].some(num => Number.isNaN(num))) {
      return null;
    }
    const fullYear = y < 100 ? 2000 + y : y;
    if (m < 1 || m > 12 || d < 1 || d > 31) {
      return null;
    }
    const date = new Date(Date.UTC(fullYear, m - 1, d));
    if (
      date.getUTCFullYear() !== fullYear ||
      date.getUTCMonth() !== m - 1 ||
      date.getUTCDate() !== d
    ) {
      return null;
    }
    return date;
  };

  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return buildDate(isoMatch[1], isoMatch[2], isoMatch[3]);
  }

  const dmyMatch = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmyMatch) {
    return buildDate(dmyMatch[3], dmyMatch[2], dmyMatch[1]);
  }

  // Remove ordinal suffixes such as "7th" before handing to Date.parse.
  const cleaned = str.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return buildDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return null;
}

module.exports = {
  ready: schemaReady,
  ensureCpvCodesLoaded,
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
    eligibility = '',
    rawDetails = ''
  ) => {
    return new Promise((resolve, reject) => {
      db.run(
        // Use INSERT OR IGNORE so that duplicate links or OCIDs are skipped silently.
        "INSERT OR IGNORE INTO tenders (title, link, ocid, date, description, source, scraped_at, tags, cpv, open_date, deadline, customer, address, country, eligibility, raw_details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
          eligibility,
          rawDetails
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
   * Primarily used by tests and legacy tooling that expects the full dataset
   * in one response.
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
   * Retrieve the stored raw payload for a tender by its identifier.
   *
   * @param {number} id - Primary key of the tender row
   * @returns {Promise<object|null>} resolves with the row or null when missing
   */
  getTenderRawById: id => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT id, title, source, scraped_at, raw_details FROM tenders WHERE id = ?',
        [id],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  },

  /**
   * Search the CPV catalogue using a combination of code and description terms.
   *
   * @param {object} options - Search configuration.
   * @param {string} options.search - Free text query (optional).
   * @param {number} options.limit - Maximum number of rows to return.
   * @param {number} options.offset - Number of rows to skip from the start.
   * @returns {Promise<{ rows: Array<{code:string, description:string}>, total: number }>}
   *   Resolves with the matching CPV entries and a total count for pagination.
   */
  searchCpvCodes: ({ search = '', limit = 50, offset = 0 }) => {
    return new Promise((resolve, reject) => {
      const where = [];
      const params = [];

      const trimmed = search.trim();
      if (trimmed) {
        const terms = trimmed.split(/\s+/).map(t => t.trim()).filter(Boolean);
        terms.forEach(term => {
          const clause = ['description LIKE ?'];
          params.push(`%${term}%`);
          if (/^\d+$/.test(term)) {
            clause.push('code LIKE ?');
            params.push(`${term}%`);
          }
          where.push(`(${clause.join(' OR ')})`);
        });
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const countSql = `SELECT COUNT(*) AS c FROM cpv_codes ${whereSql}`;
      const dataSql = `SELECT code, description FROM cpv_codes ${whereSql} ORDER BY code LIMIT ? OFFSET ?`;

      const countParams = params.slice();
      db.get(countSql, countParams, (countErr, countRow) => {
        if (countErr) {
          return reject(countErr);
        }
        const total = countRow ? countRow.c : 0;
        const dataParams = params.slice();
        dataParams.push(limit, offset);
        db.all(dataSql, dataParams, (dataErr, rows) => {
          if (dataErr) {
            return reject(dataErr);
          }
          resolve({ rows, total });
        });
      });
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
   * Retrieve the distinct list of tender sources stored in the database so the
   * UI can offer friendly filter controls.
   *
   * @returns {Promise<string[]>} resolves with an alphabetically sorted list of sources.
   */
  getTenderSources: () => {
    return new Promise((resolve, reject) => {
      db.all(
        "SELECT DISTINCT source FROM tenders WHERE source IS NOT NULL AND source != '' ORDER BY source",
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.map(r => r.source));
        }
      );
    });
  },

  /**
   * Perform an advanced tender search supporting keyword queries, date ranges,
   * source filtering and CPV logic (AND/OR). Results are paginated so the
   * frontend can request data incrementally.
   *
   * @param {object} filters - Filter definition.
   * @param {string} [filters.query] - Free text search applied to title, description, tags and CPV.
   * @param {string[]} [filters.sources] - Specific sources to include.
   * @param {string} [filters.scrapedFrom] - Lower bound for scraped_at (ISO string).
   * @param {string} [filters.scrapedTo] - Upper bound for scraped_at (ISO string).
   * @param {string} [filters.openFrom] - Lower bound for open_date.
   * @param {string} [filters.openTo] - Upper bound for open_date.
   * @param {string} [filters.closeFrom] - Lower bound for deadline.
   * @param {string} [filters.closeTo] - Upper bound for deadline.
   * @param {string[]} [filters.cpv] - CPV codes to filter by.
   * @param {'and'|'or'} [filters.cpvMode] - Whether every CPV must match or any.
   * @param {string} [filters.sort] - Sort column identifier.
   * @param {'asc'|'desc'} [filters.direction] - Sort direction.
   * @param {number} limit - Maximum rows to return.
   * @param {number} offset - Row offset.
   * @returns {Promise<{ rows: any[], total: number }>} resolves with matching rows and count.
   */
  searchTenders: (filters, limit, offset) => {
    return new Promise((resolve, reject) => {
      const where = [];
      const params = [];

      if (filters.query) {
        const like = `%${filters.query}%`;
        where.push('(title LIKE ? OR description LIKE ? OR tags LIKE ? OR cpv LIKE ? )');
        params.push(like, like, like, like);
      }

      if (filters.sources && filters.sources.length) {
        const validSources = filters.sources.filter(Boolean);
        if (validSources.length) {
          const placeholders = validSources.map(() => '?').join(',');
          where.push(`source IN (${placeholders})`);
          params.push(...validSources);
        }
      }

      if (filters.scrapedFrom) {
        where.push('scraped_at >= ?');
        params.push(filters.scrapedFrom);
      }
      if (filters.scrapedTo) {
        where.push('scraped_at <= ?');
        params.push(filters.scrapedTo);
      }
      if (filters.openFrom) {
        where.push('open_date >= ?');
        params.push(filters.openFrom);
      }
      if (filters.openTo) {
        where.push('open_date <= ?');
        params.push(filters.openTo);
      }
      if (filters.closeFrom) {
        where.push('deadline >= ?');
        params.push(filters.closeFrom);
      }
      if (filters.closeTo) {
        where.push('deadline <= ?');
        params.push(filters.closeTo);
      }

      if (filters.cpv && filters.cpv.length) {
        const sanitizedCodes = filters.cpv.filter(code => /^\d{8}$/.test(code));
        if (sanitizedCodes.length) {
          if (filters.cpvMode === 'and') {
            sanitizedCodes.forEach(code => {
              where.push("instr(',' || COALESCE(cpv, '') || ',', ?) > 0");
              params.push(`,${code},`);
            });
          } else {
            const clauses = sanitizedCodes.map(() => "instr(',' || COALESCE(cpv, '') || ',', ?) > 0");
            where.push(`(${clauses.join(' OR ')})`);
            sanitizedCodes.forEach(code => params.push(`,${code},`));
          }
        }
      }

      const sortColumnMap = {
        title: 'title COLLATE NOCASE',
        source: 'source COLLATE NOCASE',
        scraped_at: 'scraped_at',
        open_date: 'open_date',
        deadline: 'deadline',
        published_date: 'date'
      };
      const sortKey = sortColumnMap[filters.sort] || 'scraped_at';
      const sortDirection = filters.direction === 'asc' ? 'ASC' : 'DESC';

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const countSql = `SELECT COUNT(*) AS c FROM tenders ${whereSql}`;
      const dataSql = `SELECT id, title, link, date AS published_date, description, source, scraped_at, tags, cpv, open_date, deadline, raw_details FROM tenders ${whereSql} ORDER BY ${sortKey} ${sortDirection} LIMIT ? OFFSET ?`;

      const countParams = params.slice();
      db.get(countSql, countParams, (countErr, countRow) => {
        if (countErr) {
          return reject(countErr);
        }
        const total = countRow ? countRow.c : 0;
        const dataParams = params.slice();
        dataParams.push(limit, offset);
        db.all(dataSql, dataParams, (dataErr, rows) => {
          if (dataErr) {
            return reject(dataErr);
          }
          resolve({ rows, total });
        });
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
   * Delete all scraper output from the database so the UI can return to a
   * pristine state without recreating the schema. All operations run inside a
   * transaction so either every table is cleared or none are modified.
   *
   * @returns {Promise<{
   *   tenders:number,
   *   awards:number,
   *   awardDetails:number,
   *   organisations:number,
   *   sourceStats:number,
   *   metadata:number
   * }>} resolves with a per-table deletion summary so callers can surface
   * detailed feedback to administrators.
   */
  deleteAllTenders: () => {
    // Helper executing a statement and resolving with the number of affected
    // rows. Using a promise wrapper keeps the control-flow readable while
    // guaranteeing each DELETE happens sequentially.
    const run = (sql, params = []) =>
      new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) return reject(err);
          resolve(this.changes || 0);
        });
      });

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        (async () => {
          const summary = {
            tenders: 0,
            awards: 0,
            awardDetails: 0,
            organisations: 0,
            sourceStats: 0,
            metadata: 0
          };

          try {
            // BEGIN IMMEDIATE blocks writers which avoids interleaving deletes
            // with new scraper inserts while the clean-up is in progress.
            await run('BEGIN IMMEDIATE TRANSACTION');

            // Remove dependent tables first so no orphaned award details or
            // organisation lookups linger after the purge completes.
            summary.awardDetails = await run('DELETE FROM award_details');
            summary.awards = await run('DELETE FROM awards');
            summary.tenders = await run('DELETE FROM tenders');
            summary.organisations = await run('DELETE FROM organisations');
            summary.sourceStats = await run('DELETE FROM source_stats');
            // Reset metadata that only reflects stored tender data. Other keys
            // such as the cron schedule are preserved so admin configuration
            // survives a clean-up operation.
            summary.metadata = await run(
              "DELETE FROM metadata WHERE key = 'last_scraped'"
            );

            await run('COMMIT');
            resolve(summary);
          } catch (err) {
            try {
              await run('ROLLBACK');
            } catch (rollbackErr) {
              logger.error(
                'Rollback failed while clearing stored data:',
                rollbackErr
              );
            }
            reject(err);
          }
        })();
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
      const cutoff = normaliseTenderDate(date);
      if (!cutoff) {
        const error = new Error('Invalid cutoff date');
        error.code = 'INVALID_DATE';
        return reject(error);
      }

      db.all('SELECT id, date FROM tenders', (err, rows) => {
        if (err) return reject(err);

        const cutoffTime = cutoff.getTime();
        const idsToDelete = rows
          .map(row => ({ id: row.id, parsed: normaliseTenderDate(row.date) }))
          .filter(row => row.parsed && row.parsed.getTime() < cutoffTime)
          .map(row => row.id);

        if (!idsToDelete.length) {
          return resolve(0);
        }

        const placeholders = idsToDelete.map(() => '?').join(',');
        db.run(
          `DELETE FROM tenders WHERE id IN (${placeholders})`,
          idsToDelete,
          function (deleteErr) {
            if (deleteErr) return reject(deleteErr);
            resolve(this.changes || 0);
          }
        );
      });
    });
  },

  /**
   * Summarise how many tenders are stored for each source.
   *
   * @returns {Promise<Array<{source:string,count:number}>>} grouped counts
   */
  getTenderCountsBySource: () => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT source, COUNT(*) as count FROM tenders GROUP BY source',
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },

  /**
   * Remove all tenders belonging to a specific source.
   *
   * @param {string} source - Source label to purge
   * @returns {Promise<void>} resolves once rows are deleted
   */
  deleteTendersBySource: source => {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM tenders WHERE source = ?', [source], function (err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
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
   * Retrieve all user accounts. Only the identifier and username are returned
   * so no credential data ever leaves the database layer.
   *
   * @returns {Promise<Array<{id:number,username:string}>>} sorted list of users
   */
  getAllUsers: () => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT id, username FROM users ORDER BY username COLLATE NOCASE',
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
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
   * Look up a user by numeric identifier. Mirrors getUserByUsername but uses
   * the primary key which is convenient for admin tooling.
   *
   * @param {number} id - Identifier of the account
   * @returns {Promise<object|null>} matching row or null when absent
   */
  getUserById: id => {
    return new Promise((resolve, reject) => {
      db.get('SELECT id, username FROM users WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  },

  /**
   * Retrieve all CPV favourites that belong to the supplied user.
   *
   * @param {number} userId - Account identifier taken from the session.
   * @returns {Promise<Array<{code:string,description:string}>>} favourites list.
   */
  getUserCpvFavourites: userId => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT code, COALESCE(description, '') AS description
         FROM cpv_favourites
         WHERE user_id = ?
         ORDER BY code`,
        [userId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  },

  /**
   * Insert or update a CPV favourite for the specified user.
   *
   * @param {number} userId - Identifier of the account storing the favourite.
   * @param {string} code - Sanitised CPV code (eight digits).
   * @param {string} description - Friendly description associated with the code.
   * @returns {Promise<void>} resolves when the favourite is persisted.
   */
  upsertUserCpvFavourite: (userId, code, description) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO cpv_favourites (user_id, code, description)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, code) DO UPDATE SET
           description = excluded.description,
           created_at = CURRENT_TIMESTAMP`,
        [userId, code, description],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  /**
   * Remove a stored CPV favourite for a user when it is no longer required.
   *
   * @param {number} userId - Account identifier.
   * @param {string} code - CPV code to delete.
   * @returns {Promise<number>} number of rows removed.
   */
  deleteUserCpvFavourite: (userId, code) => {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM cpv_favourites WHERE user_id = ? AND code = ?',
        [userId, code],
        function (err) {
          if (err) return reject(err);
          resolve(this.changes || 0);
        }
      );
    });
  },

  /**
   * Update a user's stored password hash. The caller is responsible for hashing
   * the password before invoking this helper.
   *
   * @param {number} id - Identifier of the account to update
   * @param {string} passwordHash - New bcrypt hash to store
   * @returns {Promise<number>} resolves with number of affected rows
   */
  updateUserPassword: (id, passwordHash) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET password = ? WHERE id = ?',
        [passwordHash, id],
        function (err) {
          if (err) return reject(err);
          resolve(this.changes || 0);
        }
      );
    });
  },

  /**
   * Permanently delete a user account.
   *
   * @param {number} id - Identifier of the user to remove
   * @returns {Promise<number>} number of rows deleted
   */
  deleteUser: id => {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
      });
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
        db.run('DROP TABLE IF EXISTS cpv_favourites');
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
            tags TEXT,
            cpv TEXT,
            open_date TEXT,
            deadline TEXT,
            customer TEXT,
            address TEXT,
            country TEXT,
            eligibility TEXT,
            raw_details TEXT
          )`);
        db.run(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_tenders_ocid ON tenders(ocid)'
        );
        db.run('CREATE INDEX IF NOT EXISTS idx_tenders_cpv ON tenders(cpv)');
        db.run(`CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT
          )`);
        db.run(`CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
          )`);
        db.run(`CREATE TABLE cpv_favourites (
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, code),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
