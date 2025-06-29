const { expect } = require('chai');

// Use an in-memory database for tests so nothing is persisted on disk.
process.env.DB_FILE = ':memory:';

// Clear the module cache to ensure the DB_FILE env var is read.
delete require.cache[require.resolve('../server/db')];
const db = require('../server/db');

describe('Database helpers', () => {
  it('insertTender ignores duplicates', async () => {
    const first = await db.insertTender(
      't1',
      'link1',
      '2024-01-01',
      'desc',
      'source',
      '2024-01-02T00:00:00Z'
    );
    const second = await db.insertTender(
      't1',
      'link1',
      '2024-01-01',
      'desc',
      'source',
      '2024-01-02T00:00:00Z'
    );
    expect(first).to.equal(1);
    expect(second).to.equal(0);
  });

  it('getTenders retrieves rows ordered by date', async () => {
    // Insert two tenders with different dates
    await db.insertTender('t2', 'link2', '2024-02-01', 'd', 's', '2024-02-02T00:00:00Z');
    await db.insertTender('t3', 'link3', '2024-03-01', 'd', 's', '2024-03-02T00:00:00Z');
    const rows = await db.getTenders();
    expect(rows).to.have.length(3);
    // Ensure ordering by descending date
    expect(rows[0].date).to.equal('2024-03-01');
    expect(rows[1].date).to.equal('2024-02-01');
    // New columns should be populated
    expect(rows[0].source).to.be.a('string');
    expect(rows[0].scraped_at).to.be.a('string');
  });
});
