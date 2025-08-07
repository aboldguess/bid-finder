/**
 * @file url-validation.test.js
 * @description Integration tests verifying that the server rejects scraping
 * source definitions using unsupported protocols or disallowed hostnames.
 *
 * Structure:
 * - Boot the Express application with an in-memory database.
 * - Register a user to obtain an authenticated session cookie.
 * - Attempt to create sources with invalid URLs and expect HTTP 400 responses.
 */
const { expect } = require('chai');
const http = require('http');
const fetch = require('node-fetch');

process.env.DB_FILE = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const { app } = require('../server/index');

let server;
const url = p => `http://127.0.0.1:${server.address().port}${p}`;
let cookie;

before(async () => {
  server = http.createServer(app).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  let res = await fetch(url('/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'tester', password: 'pass' }),
    redirect: 'manual'
  });
  let setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    // User may already exist from previous tests; attempt to log in instead.
    res = await fetch(url('/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'tester', password: 'pass' }),
      redirect: 'manual'
    });
    setCookie = res.headers.get('set-cookie');
  }
  expect(setCookie).to.be.a('string');
  cookie = setCookie.split(';')[0];
});

after(() => server.close());

describe('source URL validation', () => {
  it('rejects non-HTTPS URLs', async () => {
    const res = await fetch(url('/sources'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        key: 'insecure',
        label: 'Insecure',
        url: 'http://www.contractsfinder.service.gov.uk/rss',
        base: 'http://www.contractsfinder.service.gov.uk'
      })
    });
    expect(res.status).to.equal(400);
  });

  it('rejects URLs from disallowed domains', async () => {
    const res = await fetch(url('/sources'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        key: 'evil',
        label: 'Evil',
        url: 'https://evil.example/rss',
        base: 'https://evil.example'
      })
    });
    expect(res.status).to.equal(400);
  });
});
