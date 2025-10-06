/**
 * File: test/source-onboarding.test.js
 * Mini README: Full integration test covering runtime source onboarding.
 *
 * Structure:
 *   - Boot the Express app against an in-memory SQLite database.
 *   - Authenticate via the real login flow to obtain a CSRF token and session.
 *   - POST /sources to register a custom feed and run the scraper with HTTP
 *     fetches stubbed by proxyquire to return deterministic fixtures.
 *   - Assert that tenders linked to the new source are persisted by the DB API.
 */
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const http = require('http');
const fetch = require('node-fetch');
const sinon = require('sinon');
const bcrypt = require('bcryptjs');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();

// Ensure the server uses the ephemeral in-memory database for the duration of
// this suite and provide a session secret so Express-session initialises.
process.env.DB_FILE = ':memory:';
process.env.SESSION_SECRET = 'test-secret';

// Remove cached modules so the proxyquired versions below are instantiated with
// the in-memory database configuration.
['../server/index', '../server/scrape', '../server/db', '../server/config'].forEach(
  modulePath => {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch (err) {
      // Module may not have been loaded yet which is fine.
    }
  }
);

const fixturesDir = path.join(__dirname, 'fixtures');
const listingFixture = fs.readFileSync(path.join(fixturesDir, 'rss-listing.xml'), 'utf8');
const detailFixture = fs.readFileSync(path.join(fixturesDir, 'detail-page.html'), 'utf8');

// Stubs injected into the scraper via proxyquire. fetchText returns the RSS
// listing on the first call then detail HTML for subsequent invocations. The
// concurrency limiter resolves tasks immediately so the scraper runs
// synchronously inside the test harness.
const fetchTextStub = sinon.stub();
const createLimiterStub = sinon.stub();

const scrape = proxyquire('../server/scrape', {
  './httpClient': { fetchText: fetchTextStub },
  './concurrency': { createLimiter: createLimiterStub }
});

const { app } = proxyquire('../server/index', {
  './scrape': scrape
});

const db = require('../server/db');
const config = require('../server/config');

const TEST_SOURCE_KEY = 'integration-rss-source';
const TEST_SOURCE_LABEL = 'Integration RSS Source';
const TEST_USER = { username: 'source-onboarder', password: 'S0urcePass!' };
const sourcesJsonPath = path.join(__dirname, '..', 'sources.json');

let server;
let baseUrl;

/**
 * Helper returning the absolute URL for a route on the ephemeral HTTP server.
 * @param {string} route - path starting with a forward slash.
 * @returns {string} absolute URL for the active test server.
 */
function url(route) {
  return `${baseUrl}${route}`;
}

/**
 * Retrieve a CSRF token and authenticated session cookie by exercising the real
 * login flow. The token is reused for subsequent POST requests in the test.
 *
 * @returns {Promise<{cookie: string, csrfToken: string}>}
 */
async function loginAndGetSession() {
  const loginPage = await fetch(url('/login'));
  expect(loginPage.status).to.equal(200);
  const initialCookieHeader = loginPage.headers.get('set-cookie');
  expect(initialCookieHeader).to.be.a('string');
  let sessionCookie = initialCookieHeader.split(';')[0];
  const html = await loginPage.text();
  const tokenMatch = html.match(/name="_csrf" value="([^"]+)"/);
  expect(tokenMatch).to.not.be.null;
  const csrfToken = tokenMatch[1];

  const formBody = new URLSearchParams({
    username: TEST_USER.username,
    password: TEST_USER.password,
    _csrf: csrfToken
  });

  const loginResponse = await fetch(url('/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: sessionCookie
    },
    body: formBody,
    redirect: 'manual'
  });
  expect(loginResponse.status).to.equal(302);
  const authCookieHeader = loginResponse.headers.get('set-cookie');
  if (authCookieHeader) {
    sessionCookie = authCookieHeader.split(';')[0];
  }

  return { cookie: sessionCookie, csrfToken };
}

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  if (server) {
    server.close();
  }
});

beforeEach(async () => {
  // Reset stub behaviour before every test execution.
  fetchTextStub.resetHistory();
  fetchTextStub.resetBehavior();
  fetchTextStub.resolves(detailFixture);
  fetchTextStub.onFirstCall().resolves(listingFixture);

  createLimiterStub.resetHistory();
  createLimiterStub.resetBehavior();
  createLimiterStub.resolves(async task => task());

  if (fs.existsSync(sourcesJsonPath)) {
    fs.unlinkSync(sourcesJsonPath);
  }

  // Start from a clean schema and provision the test user account.
  await db.reset();
  const hash = await bcrypt.hash(TEST_USER.password, 10);
  await db.createUser(TEST_USER.username, hash);

  delete config.sources[TEST_SOURCE_KEY];
});

afterEach(async () => {
  delete config.sources[TEST_SOURCE_KEY];
  if (fs.existsSync(sourcesJsonPath)) {
    fs.unlinkSync(sourcesJsonPath);
  }
  await db.reset();
});

describe('Source onboarding workflow', () => {
  it('registers a source and scrapes tenders into the database', async () => {
    const { cookie, csrfToken } = await loginAndGetSession();

    const response = await fetch(url('/sources'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookie,
        'CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        key: TEST_SOURCE_KEY,
        label: TEST_SOURCE_LABEL,
        url: 'https://www.contractsfinder.service.gov.uk/custom-feed',
        base: 'https://www.contractsfinder.service.gov.uk',
        parser: 'rss'
      })
    });

    expect(response.status).to.equal(200);
    const payload = await response.json();
    expect(payload).to.have.property('success', true);
    expect(config.sources).to.have.property(TEST_SOURCE_KEY);

    const added = await scrape.run(null, config.sources[TEST_SOURCE_KEY], TEST_SOURCE_KEY);
    expect(added).to.be.greaterThan(0);

    const tenders = await db.getTenders();
    expect(tenders.length).to.be.greaterThan(0);
    const inserted = tenders.find(tender => tender.source === TEST_SOURCE_LABEL);
    expect(inserted).to.exist;
    expect(inserted.cpv).to.include('12345678');

    expect(fetchTextStub.callCount).to.be.at.least(2);
  });
});
