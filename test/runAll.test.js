const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

// In-memory DB so nothing is persisted
process.env.DB_FILE = ':memory:';
delete require.cache[require.resolve('../server/db')];
const db = require('../server/db');

const html = fs.readFileSync(path.join(__dirname, 'mock.html'), 'utf8');
const fetchStub = sinon.stub().resolves({ text: async () => html });

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
