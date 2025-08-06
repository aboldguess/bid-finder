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
const fetchStub = sinon.stub();
fetchStub.onCall(0).resolves({ text: async () => htmlA });
fetchStub.onCall(1).resolves({ text: async () => '<div></div>' });
fetchStub.onCall(2).resolves({ text: async () => '<div></div>' });
fetchStub.onCall(3).resolves({ text: async () => htmlB });
fetchStub.onCall(4).resolves({ text: async () => '<div></div>' });
fetchStub.onCall(5).resolves({ text: async () => '<div></div>' });

const configStub = {
  sources: {
    a: { label: 'A', url: 'http://a', base: 'http://a', parser: 'contractsFinder' },
    b: { label: 'B', url: 'http://b', base: 'http://b', parser: 'contractsFinder' }
  },
  scrapeUrl: '',
  scrapeBase: ''
};

const scrape = proxyquire('../server/scrape', {
  'node-fetch': fetchStub,
  './db': db,
  './config': configStub
});

describe('scrape.runAll', () => {
  it('scrapes every configured source', async () => {
    const results = await scrape.runAll();
    expect(Object.keys(results)).to.have.length(2);
    expect(results.a.added).to.equal(2);
    expect(results.b.added).to.equal(2);
  });
});
