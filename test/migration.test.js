const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { expect } = require('chai');

it('adds ocid and cpv columns if missing', async () => {
  const file = path.join(__dirname, 'migrate.db');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  // Create old schema without ocid or cpv columns
  const oldDb = new sqlite3.Database(file);
  await new Promise(res => oldDb.run(`CREATE TABLE tenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    link TEXT UNIQUE,
    date TEXT,
    description TEXT,
    source TEXT,
    scraped_at TEXT,
    tags TEXT
  )`, res));
  await new Promise(res => oldDb.close(res));

  // Load db.js which should migrate the schema
  process.env.DB_FILE = file;
  delete require.cache[require.resolve('../server/db')];
  const db = require('../server/db');

  await db.insertTender('t', 'l', '2024-01-01', 'd', 's', '2024-01-02', 'tag', 'ocid-1', '12345678');
  const rows = await db.getTenders();
  expect(rows[0].ocid).to.equal('ocid-1');
  expect(rows[0].cpv).to.equal('12345678');
  fs.unlinkSync(file);
});
