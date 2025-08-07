/**
 * @file db.test.js
 * @description Unit tests verifying database helper behaviour including
 * insertion, querying and deletion of tender and source records.
 */
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
      'ocds-x',
      '12345678',
      '2024-01-01',
      '2024-02-01',
      'Buyer',
      'Addr',
      'Country',
      'Eligibility'
    );
    const second = await db.insertTender(
      't1',
      'link1',
      '2024-01-01',
      'desc',
      'source',
      '2024-01-02T00:00:00Z',
      'tag1',
      'ocds-x',
      '12345678',
      '2024-01-01',
      '2024-02-01',
      'Buyer',
      'Addr',
      'Country',
      'Eligibility'
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
      'ocds-dedupe',
      '23456789',
      '',
      '',
      '',
      '',
      '',
      ''
    );
    const second = await db.insertTender(
      'tO2',
      'linkO2',
      '2024-01-02',
      'd',
      's',
      '2024-01-03T00:00:00Z',
      '',
      'ocds-dedupe',
      '23456789',
      '',
      '',
      '',
      '',
      '',
      ''
    );
    expect(first).to.equal(1);
    expect(second).to.equal(0);
  });

  it('getTenders retrieves rows ordered by date', async () => {
    // Insert two tenders with different dates
    await db.insertTender('t2', 'link2', '2024-02-01', 'd', 's', '2024-02-02T00:00:00Z', 'tag', 'ocds-2', '11111111', '', '', '', '', '', '');
    await db.insertTender('t3', 'link3', '2024-03-01', 'd', 's', '2024-03-02T00:00:00Z', 'tag', 'ocds-3', '22222222', '', '', '', '', '', '');
    const rows = await db.getTenders();
    // There are now four rows in total including earlier inserts.
    expect(rows).to.have.length(4);
    // Ensure ordering by descending date
    expect(rows[0].date).to.equal('2024-03-01');
    expect(rows[1].date).to.equal('2024-02-01');
    // New columns should be populated
    expect(rows[0].source).to.be.a('string');
    expect(rows[0].scraped_at).to.be.a('string');
    expect(rows[0]).to.have.property('tags');
    expect(rows[0]).to.have.property('ocid');
    expect(rows[0]).to.have.property('cpv');
    expect(rows[0]).to.have.property('open_date');
    expect(rows[0]).to.have.property('deadline');
    expect(rows[0]).to.have.property('customer');
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

  it('award sources can be persisted', async () => {
    await db.insertAwardSource('aw', 'Award', 'http://a', 'http://a', 'rss');
    const rows = await db.getAwardSources();
    expect(rows).to.have.length(1);
    expect(rows[0].key).to.equal('aw');
  });

  it('award sources can be updated and deleted', async () => {
    await db.insertAwardSource('del', 'D', 'http://d', 'http://d', 'rss');
    await db.updateAwardSource('del', 'DD', 'http://dd', 'http://dd', 'rss');
    let rows = await db.getAwardSources();
    let item = rows.find(r => r.key === 'del');
    expect(item.label).to.equal('DD');
    await db.deleteAwardSource('del');
    rows = await db.getAwardSources();
    expect(rows.some(r => r.key === 'del')).to.equal(false);
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

  it('count helpers return the number of stored rows', async () => {
    const tenderCount = await db.getTenderCount();
    const awardCount = await db.getAwardCount();
    const custCount = await db.getOrganisationCount('customer');
    const suppCount = await db.getOrganisationCount('supplier');
    expect(tenderCount).to.be.a('number');
    expect(awardCount).to.be.a('number');
    expect(custCount).to.be.a('number');
    expect(suppCount).to.be.a('number');
    // There should be at least one tender and award from previous tests
    expect(tenderCount).to.be.greaterThan(0);
    expect(awardCount).to.be.greaterThan(0);
  });

  it('getTenderCountsBySource summarises stored rows', async () => {
    await db.insertTender(
      's1',
      'link-s1',
      '2024-07-01',
      'd',
      'src1',
      '2024-07-02T00:00:00Z',
      't',
      'ocds-s1',
      '55555551',
      '',
      '',
      '',
      '',
      '',
      ''
    );
    await db.insertTender(
      's2',
      'link-s2',
      '2024-07-02',
      'd',
      'src2',
      '2024-07-03T00:00:00Z',
      't',
      'ocds-s2',
      '55555552',
      '',
      '',
      '',
      '',
      '',
      ''
    );
    const counts = await db.getTenderCountsBySource();
    const map = Object.fromEntries(counts.map(r => [r.source, r.count]));
    expect(map.src1).to.be.a('number');
    expect(map.src2).to.be.a('number');
  });

  it('deleteTendersBySource removes only the specified source', async () => {
    await db.insertTender(
      'd1',
      'link-d1',
      '2024-07-03',
      'd',
      'delSrc',
      '2024-07-04T00:00:00Z',
      't',
      'ocds-d1',
      '55555553',
      '',
      '',
      '',
      '',
      '',
      ''
    );
    await db.insertTender(
      'k1',
      'link-k1',
      '2024-07-04',
      'd',
      'keepSrc',
      '2024-07-05T00:00:00Z',
      't',
      'ocds-k1',
      '55555554',
      '',
      '',
      '',
      '',
      '',
      ''
    );
    await db.deleteTendersBySource('delSrc');
    const rows = await db.getTenders();
    const sources = rows.map(r => r.source);
    expect(sources).to.include('keepSrc');
    expect(sources).to.not.include('delSrc');
  });

  it('deleteAllTenders removes everything', async () => {
    await db.deleteAllTenders();
    const count = await db.getTenderCount();
    expect(count).to.equal(0);
  });

  it('deleteTendersBefore removes only old rows', async () => {
    await db.insertTender('new', 'n1', '2024-05-01', 'd', 's', '2024-05-02T00:00:00Z', 't', 'ocds-n', '99999999', '', '', '', '', '', '');
    await db.insertTender('old', 'o1', '2023-01-01', 'd', 's', '2023-01-02T00:00:00Z', 't', 'ocds-o', '88888888', '', '', '', '', '', '');
    await db.deleteTendersBefore('2024-01-01');
    const rows = await db.getTenders();
    const titles = rows.map(r => r.title);
    expect(titles).to.include('new');
    expect(titles).to.not.include('old');
  });
});
