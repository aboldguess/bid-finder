const sqlite3 = require('sqlite3').verbose();
// Open a connection to the SQLite database stored in tenders.db
const db = new sqlite3.Database('./tenders.db');

// Ensure the tenders table exists before we attempt any writes
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
  // Insert a tender into the database. The promise resolves with the number of
  // rows inserted (0 if the tender already existed).
  insertTender: (title, link, date, description) => {
    return new Promise((resolve, reject) => {
      db.run(
        "INSERT OR IGNORE INTO tenders (title, link, date, description) VALUES (?, ?, ?, ?)",
        [title, link, date, description],
        function (err) {
          if (err) {
            return reject(err);
          }
          // `this.changes` will be 1 when a row was inserted and 0 when ignored
          resolve(this.changes);
        }
      );
    });
  },
  getTenders: () => {
    return new Promise((resolve, reject) => {
      db.all("SELECT * FROM tenders ORDER BY date DESC", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
};
