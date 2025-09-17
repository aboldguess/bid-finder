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

// Stub the HTTP helper so scrape.js receives predictable HTML without making a
// network call. The first invocation returns the listing HTML, subsequent calls
// emulate detail pages containing CPV codes.
const fetchTextStub = sinon.stub();
fetchTextStub.onCall(0).resolves(html);
fetchTextStub.onCall(1).resolves('<div>CPV 12345678</div>');
fetchTextStub.onCall(2).resolves('<div>CPV 87654321</div>');

// Concurrency helper stubbed to execute detail fetches immediately while
// preserving the async contract expected by the scraper.
const limitFn = sinon.stub().callsFake(async task => task());
const createLimiterStub = sinon.stub().resolves(limitFn);

// Proxyquire allows us to inject the stubbed HTTP helper, limiter and the real
// db instance when requiring the scraper module.
const scrape = proxyquire('../server/scrape', {
  './httpClient': { fetchText: fetchTextStub },
  './concurrency': { createLimiter: createLimiterStub },
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
    expect(rows[0]).to.have.property('ocid');
    expect(rows[0]).to.have.property('cpv');
    expect(rows.map(r => r.cpv)).to.deep.equal(['87654321', '12345678']);
    const ts = await db.getLastScraped();
    expect(ts).to.be.a('string');
    const cust = await db.getOrganisationsByType('customer');
    const supp = await db.getOrganisationsByType('supplier');
    expect(cust).to.have.length(2);
    expect(supp).to.have.length(2);
  });
});
