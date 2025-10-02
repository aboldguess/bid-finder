/**
 * File: test/scrapeAwarded.test.js
 * Mini README: Integration checks for the awarded-contract scraper.
 *
 * Structure:
 *   - Shared setup wires an in-memory database and HTTP/pagination stubs.
 *   - Single test exercises multi-page scraping and detail enrichment.
 *
 * The goal is to prove scrapeAwarded.js iterates through every results page,
 * resolves absolute URLs, harvests award detail pages, and persists structured
 * data (including buyer metadata) into the awards tables.
 */
const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

process.env.DB_FILE = ':memory:';
delete require.cache[require.resolve('../server/db')];
const db = require('../server/db');

const fetchTextStub = sinon.stub();
const limitFn = sinon.stub().callsFake(async task => task());
const createLimiterStub = sinon.stub().resolves(limitFn);
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

const scrapeAwarded = proxyquire('../server/scrapeAwarded', {
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
  fetchTextStub.resetBehavior();
  fetchTextStub.resetHistory();
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

describe('scrapeAwarded.run', () => {
  it('scrapes all pages and stores award details from detail views', async () => {
    const pageOneHtml = `
      <div class="search-result">
        <h2>Award Page 1</h2>
        <span class="org">Buyer One</span>
        <span class="supplier">Supplier One</span>
        <a href="/a1"></a>
        <span class="date">2024-04-01</span>
        <p>Award summary 1</p>
      </div>`;
    const pageTwoHtml = `
      <div class="search-result">
        <h2>Award Page 2</h2>
        <span class="org">Buyer Two</span>
        <span class="supplier">Supplier Two</span>
        <a href="/a2"></a>
        <span class="date">2024-05-01</span>
        <p>Award summary 2</p>
      </div>`;
    const detailOneHtml = `
      Award Page 1
      Buyer One
      Location of contract
      London
      Value of contract
      £100,000
      Procurement reference
      REF-1
      Closing date
      10 May 2024
      Closing time
      12:00
      Contract start date
      1 June 2024
      Contract end date
      31 May 2025
      Contract type
      Services
      Procedure type
      Open
      What is Open?
      Competitive procedure
      Contract is suitable for SMEs?
      Yes
      Contract is suitable for VCSEs?
      No
      How to apply
      Email buyer
      About the buyer
      Address
      1 Street
      London
      Email
      buyer.one@example.com`;
    const detailTwoHtml = `
      Award Page 2
      Buyer Two
      Location of contract
      Glasgow
      Value of contract
      £250,000
      Procurement reference
      REF-2
      Closing date
      20 May 2024
      Closing time
      17:00
      Contract start date
      1 July 2024
      Contract end date
      30 June 2025
      Contract type
      Works
      Procedure type
      Restricted
      What is Restricted?
      Invited suppliers only
      Contract is suitable for SMEs?
      No
      Contract is suitable for VCSEs?
      Yes
      How to apply
      Portal link
      About the buyer
      Address
      2 Road
      Glasgow
      Email
      buyer.two@example.com`;

    fetchTextStub.onCall(0).resolves(pageOneHtml);
    fetchTextStub.onCall(1).resolves(pageTwoHtml);
    fetchTextStub.onCall(2).resolves(detailOneHtml);
    fetchTextStub.onCall(3).resolves(detailTwoHtml);

    findNextPageUrlStub.resetBehavior();
    findNextPageUrlStub.onCall(0).returns('https://example.com/page2');
    findNextPageUrlStub.onCall(1).returns(null);

    const source = {
      label: 'Awards Multi Page',
      url: 'https://example.com/page1',
      base: 'https://example.com',
      parser: 'contractsFinder',
      pagination: { maxPages: 5, detectLoops: true, navSelectors: [], nextLinkSelectors: [] }
    };

    const inserted = await scrapeAwarded.run(null, source);
    expect(inserted).to.equal(2);
    expect(fetchTextStub.callCount).to.equal(4);

    const awards = await db.getAwards();
    expect(awards).to.have.length(2);

    const byTitle = Object.fromEntries(awards.map(row => [row.title, row]));
    const awardOne = byTitle['Award Page 1'];
    const awardTwo = byTitle['Award Page 2'];

    expect(awardOne.link).to.equal('https://example.com/a1');
    expect(awardTwo.link).to.equal('https://example.com/a2');

    const awardOneDetails = await db.getAwardDetails(awardOne.id);
    const awardTwoDetails = await db.getAwardDetails(awardTwo.id);

    expect(awardOneDetails.location).to.equal('London');
    expect(awardOneDetails.value).to.equal('£100,000');
    expect(awardOneDetails.contract_type).to.equal('Services');
    expect(awardOneDetails.suitable_for_sme).to.equal(1);
    expect(awardOneDetails.suitable_for_vcse).to.equal(0);
    expect(awardOneDetails.buyer_email).to.equal('buyer.one@example.com');

    expect(awardTwoDetails.location).to.equal('Glasgow');
    expect(awardTwoDetails.value).to.equal('£250,000');
    expect(awardTwoDetails.contract_type).to.equal('Works');
    expect(awardTwoDetails.suitable_for_sme).to.equal(0);
    expect(awardTwoDetails.suitable_for_vcse).to.equal(1);
    expect(awardTwoDetails.buyer_email).to.equal('buyer.two@example.com');
  });
});
