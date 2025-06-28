const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./tenders.db');

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
  insertTender: (title, link, date, description) => {
    db.run("INSERT OR IGNORE INTO tenders (title, link, date, description) VALUES (?, ?, ?, ?)",
      [title, link, date, description]);
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
