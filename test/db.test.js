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
      '2024-01-02T00:00:00Z',
      'tag1',
      'ocds-x'
    );
    const second = await db.insertTender(
      't1',
      'link1',
      '2024-01-01',
      'desc',
      'source',
      '2024-01-02T00:00:00Z',
      'tag1',
      'ocds-x'
    );
    expect(first).to.equal(1);
    expect(second).to.equal(0);
  });

  it('insertTender dedupes on OCID', async () => {
    const first = await db.insertTender(
      'tO',
      'linkO1',
      '2024-01-01',
      'd',
      's',
      '2024-01-02T00:00:00Z',
      '',
      'ocds-dedupe'
    );
    const second = await db.insertTender(
      'tO2',
      'linkO2',
      '2024-01-02',
      'd',
      's',
      '2024-01-03T00:00:00Z',
      '',
      'ocds-dedupe'
    );
    expect(first).to.equal(1);
    expect(second).to.equal(0);
  });

  it('getTenders retrieves rows ordered by date', async () => {
    // Insert two tenders with different dates
    await db.insertTender('t2', 'link2', '2024-02-01', 'd', 's', '2024-02-02T00:00:00Z', 'tag', 'ocds-2');
    await db.insertTender('t3', 'link3', '2024-03-01', 'd', 's', '2024-03-02T00:00:00Z', 'tag', 'ocds-3');
    const rows = await db.getTenders();
    expect(rows).to.have.length(3);
    // Ensure ordering by descending date
    expect(rows[0].date).to.equal('2024-03-01');
    expect(rows[1].date).to.equal('2024-02-01');
    // New columns should be populated
    expect(rows[0].source).to.be.a('string');
    expect(rows[0].scraped_at).to.be.a('string');
    expect(rows[0]).to.have.property('tags');
    expect(rows[0]).to.have.property('ocid');
  });

  it('cron schedule can be stored and retrieved', async () => {
    // Initially no schedule should exist
    const none = await db.getCronSchedule();
    expect(none).to.equal(null);
    // Persist a schedule and fetch it back
    await db.setCronSchedule('*/5 * * * *');
    const stored = await db.getCronSchedule();
    expect(stored).to.equal('*/5 * * * *');
  });

  it('sources can be persisted and loaded', async () => {
    await db.insertSource('x', 'Example', 'http://e', 'http://b', 'contractsFinder');
    const rows = await db.getSources();
    expect(rows).to.have.length(1);
    expect(rows[0].key).to.equal('x');
  });

  it('sources can be updated', async () => {
    await db.insertSource('y', 'Old', 'http://o', 'http://o', 'contractsFinder');
    await db.updateSource('y', 'New', 'http://n', 'http://n', 'rss');
    const rows = await db.getSources();
    const updated = rows.find(r => r.key === 'y');
    expect(updated.label).to.equal('New');
    expect(updated.parser).to.equal('rss');
  });

  it('sources can be deleted', async () => {
    await db.insertSource('z', 'Delete', 'http://d', 'http://d', 'contractsFinder');
    await db.deleteSource('z');
    const rows = await db.getSources();
    expect(rows.some(r => r.key === 'z')).to.equal(false);
  });

  it('source stats accumulate totals', async () => {
    await db.updateSourceStats('s', '2024-01-01T00:00:00Z', 3);
    await db.updateSourceStats('s', '2024-01-02T00:00:00Z', 2);
    const rows = await db.getSourceStats();
    const s = rows.find(r => r.key === 's');
    expect(s.total).to.equal(5);
    expect(s.last_added).to.equal(2);
  });

  it('award details can be stored and retrieved', async () => {
    const res = await db.insertAward(
      'a',
      'linka',
      '2024-06-01',
      'desc',
      'src',
      '2024-06-02T00:00:00Z',
      't'
    );
    await db.insertAwardDetails(res.id, {
      buyer: 'Buyer',
      value: '100',
      location: 'X'
    });
    const row = await db.getAwardDetails(res.id);
    expect(row.buyer).to.equal('Buyer');
    expect(row.value).to.equal('100');
    expect(row.location).to.equal('X');
  });
});
