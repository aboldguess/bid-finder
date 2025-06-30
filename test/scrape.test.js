const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

// Use a shared in-memory database between the db module used in the test and
// the one injected into scrape.js.
process.env.DB_FILE = ':memory:';
delete require.cache[require.resolve('../server/db')];
const db = require('../server/db');

// Load the HTML used to mock the tender website response.
const html = fs.readFileSync(path.join(__dirname, 'mock.html'), 'utf8');

// Stub fetch so scrape.js receives predictable HTML without making a network call.
const fetchStub = sinon.stub().resolves({ text: async () => html });

// Proxyquire allows us to inject the stubbed fetch and the real db instance when
// requiring the scraper module.
const scrape = proxyquire('../server/scrape', {
  'node-fetch': fetchStub,
  './db': db
});

describe('scrape.run', () => {
  it('parses tenders from HTML and stores them', async () => {
    const count = await scrape.run();
    expect(count).to.equal(2);
    const rows = await db.getTenders();
    expect(rows).to.have.length(2);
    expect(rows[0]).to.have.property('source');
    expect(rows[0]).to.have.property('scraped_at');
    expect(rows[0]).to.have.property('tags');
    const ts = await db.getLastScraped();
    expect(ts).to.be.a('string');
  });
});
