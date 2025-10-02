/**
 * File: test/scrape.test.js
 * Mini README: Integration-style tests for the main tender scraper.
 *
 * Structure:
 *   - Shared setup creates in-memory database and HTTP/pagination stubs.
 *   - "parses tenders" test verifies baseline single-page behaviour.
 *   - "follows pagination" test asserts multi-page detail extraction and storage.
 *
 * The suite focuses on ensuring scraper.js walks every results page, fetches
 * the individual tender detail pages, and persists consistent structured data
 * including absolute URLs and parsed metadata.
 */
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

// Pagination helpers are stubbed so tests can explicitly control when the
// scraper should request additional pages.
const resolvePaginationConfigStub = sinon
  .stub()
  .callsFake(source => ({
    maxPages: source?.pagination?.maxPages ?? 25,
    navSelectors: source?.pagination?.navSelectors || [],
    nextLinkSelectors: source?.pagination?.nextLinkSelectors || [],
    pageNumberPattern: '\\d+',
    detectLoops: source?.pagination?.detectLoops ?? true
  }));
const findNextPageUrlStub = sinon.stub().returns(null);

// Proxyquire allows us to inject the stubbed HTTP helper, limiter and the real
// db instance when requiring the scraper module.
const scrape = proxyquire('../server/scrape', {
  './httpClient': { fetchText: fetchTextStub },
  './concurrency': { createLimiter: createLimiterStub },
  './db': db,
  './pagination': {
    resolvePaginationConfig: resolvePaginationConfigStub,
    findNextPageUrl: findNextPageUrlStub
  }
});

beforeEach(async () => {
  await db.ready;
  await db.deleteAllTenders();
  fetchTextStub.resetHistory();
  fetchTextStub.resetBehavior();
  fetchTextStub.onCall(0).resolves(html);
  fetchTextStub.onCall(1).resolves('<div>CPV 12345678</div>');
  fetchTextStub.onCall(2).resolves('<div>CPV 87654321</div>');
  resolvePaginationConfigStub.resetHistory();
  resolvePaginationConfigStub.resetBehavior();
  resolvePaginationConfigStub.callsFake(source => ({
    maxPages: source?.pagination?.maxPages ?? 25,
    navSelectors: source?.pagination?.navSelectors || [],
    nextLinkSelectors: source?.pagination?.nextLinkSelectors || [],
    pageNumberPattern: '\\d+',
    detectLoops: source?.pagination?.detectLoops ?? true
  }));
  findNextPageUrlStub.resetHistory();
  findNextPageUrlStub.resetBehavior();
  findNextPageUrlStub.onCall(0).returns(null);
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

  it('follows pagination and stores detail page metadata for every tender', async () => {
    const pageOneHtml = `
      <div class="search-result">
        <h2>Page 1 Contract</h2>
        <span class="org">Org1</span>
        <span class="supplier">Sup1</span>
        <a href="/c1" data-ocid="ocds-p1"></a>
        <span class="date">2024-04-01</span>
        <p>Summary one</p>
      </div>`;
    const pageTwoHtml = `
      <div class="search-result">
        <h2>Page 2 Contract</h2>
        <span class="org">Org2</span>
        <span class="supplier">Sup2</span>
        <a href="/c2" data-ocid="ocds-p2"></a>
        <span class="date">2024-05-01</span>
        <p>Summary two</p>
      </div>`;
    const detailOneHtml = `
      Published date
      1 May 2024
      Closing date
      15 May 2024
      Name of buying organisation
      Buyer One Ltd
      Address
      1 Street
      Country
      England
      Description
      Detail description 1
      Eligibility
      Eligible 1
      11111111`;
    const detailTwoHtml = `
      Published date
      2 May 2024
      Response deadline
      20 May 2024
      Buyer
      Buyer Two Plc
      Address
      2 Road
      Country
      Scotland
      Description
      Detail description 2
      Eligibility
      Eligible 2
      22222222`;

    fetchTextStub.resetBehavior();
    fetchTextStub.resetHistory();
    fetchTextStub.onCall(0).resolves(pageOneHtml);
    fetchTextStub.onCall(1).resolves(pageTwoHtml);
    fetchTextStub.onCall(2).resolves(detailOneHtml);
    fetchTextStub.onCall(3).resolves(detailTwoHtml);

    findNextPageUrlStub.resetBehavior();
    findNextPageUrlStub.resetHistory();
    findNextPageUrlStub.onCall(0).returns('https://example.com/page2');
    findNextPageUrlStub.onCall(1).returns(null);

    const source = {
      label: 'Test Multi Page',
      url: 'https://example.com/page1',
      base: 'https://example.com',
      parser: 'contractsFinder',
      pagination: { maxPages: 5, detectLoops: true, navSelectors: [], nextLinkSelectors: [] }
    };

    const count = await scrape.run(null, source);
    expect(count).to.equal(2);
    expect(fetchTextStub.callCount).to.equal(4);

    const rows = await db.getTenders();
    expect(rows).to.have.length(2);

    const byTitle = Object.fromEntries(rows.map(row => [row.title, row]));
    const tenderOne = byTitle['Page 1 Contract'];
    const tenderTwo = byTitle['Page 2 Contract'];

    expect(tenderOne.link).to.equal('https://example.com/c1');
    expect(tenderTwo.link).to.equal('https://example.com/c2');

    expect(tenderOne.cpv).to.equal('11111111');
    expect(tenderTwo.cpv).to.equal('22222222');

    expect(tenderOne.description).to.equal('Detail description 1');
    expect(tenderTwo.description).to.equal('Detail description 2');

    expect(tenderOne.open_date).to.equal('1 May 2024');
    expect(tenderOne.deadline).to.equal('15 May 2024');
    expect(tenderTwo.deadline).to.equal('20 May 2024');
    expect(tenderTwo.customer).to.equal('Buyer Two Plc');

    const payloadOne = JSON.parse(tenderOne.raw_details);
    const payloadTwo = JSON.parse(tenderTwo.raw_details);

    expect(payloadOne.resolvedLink).to.equal('https://example.com/c1');
    expect(payloadTwo.resolvedLink).to.equal('https://example.com/c2');
    expect(payloadOne.detailPageHtml).to.include('Detail description 1');
    expect(payloadTwo.detailPageHtml).to.include('Detail description 2');
  });
});
