const sqlite3 = require('sqlite3').verbose();
const config = require('./config');
const logger = require('./logger');

// Simple utility script used to initialize the database. It creates the
// `tenders` table if it does not exist and then closes the connection. This
// is handy for deployment environments where the application may not run long
// enough to trigger table creation automatically.
// Open the database file specified in config.js. The file will be created on
// first run if it does not already exist.
const db = new sqlite3.Database(config.dbFile, err => {
  if (err) {
    logger.error('Failed to open database:', err);
    process.exit(1);
  }
});

// Create required tables and close the connection once finished. Both tables are
// kept minimal so initialisation is fast even on constrained platforms.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    link TEXT UNIQUE,
    date TEXT,
    description TEXT,
    source TEXT,
    scraped_at TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  );
  db.run(`CREATE TABLE IF NOT EXISTS sources (
    key TEXT PRIMARY KEY,
    label TEXT,
    url TEXT,
    base TEXT,
    parser TEXT
  )`, err => {
    if (err) {
      logger.error('Failed to create table:', err);
    } else {
      logger.info('Database initialised');
    }
    db.close();
  });
});
