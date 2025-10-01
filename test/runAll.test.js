const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

// In-memory DB so nothing is persisted
process.env.DB_FILE = ':memory:';
delete require.cache[require.resolve('../server/db')];
const db = require('../server/db');

const htmlA = fs.readFileSync(path.join(__dirname, 'mock.html'), 'utf8');
// Second listing uses different OCIDs so inserts are not treated as duplicates.
const htmlB = htmlA.replace('ocds-1', 'ocds-3').replace('ocds-2', 'ocds-4');
const fetchTextStub = sinon.stub();
fetchTextStub.onCall(0).resolves(htmlA);
fetchTextStub.onCall(1).resolves('<div></div>');
fetchTextStub.onCall(2).resolves('<div></div>');
fetchTextStub.onCall(3).resolves(htmlB);
fetchTextStub.onCall(4).resolves('<div></div>');
fetchTextStub.onCall(5).resolves('<div></div>');

const limitFn = sinon.stub().callsFake(async task => task());
const createLimiterStub = sinon.stub().resolves(limitFn);

const configStub = {
  sources: {
    a: { label: 'A', url: 'http://a', base: 'http://a', parser: 'contractsFinder' },
    b: { label: 'B', url: 'http://b', base: 'http://b', parser: 'contractsFinder' }
  },
  scrapeUrl: '',
  scrapeBase: ''
};

const scrape = proxyquire('../server/scrape', {
  './httpClient': { fetchText: fetchTextStub },
  './concurrency': { createLimiter: createLimiterStub },
  './db': db,
  './config': configStub
});

beforeEach(async () => {
  await db.ready;
  await db.deleteAllTenders();
});

describe('scrape.runAll', () => {
  it('scrapes every configured source', async () => {
    const results = await scrape.runAll();
    expect(Object.keys(results)).to.have.length(2);
    expect(results.a.added).to.equal(2);
    expect(results.b.added).to.equal(2);
  });
});
