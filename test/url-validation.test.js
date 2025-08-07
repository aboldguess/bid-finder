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
let csrf;

before(async () => {
  server = http.createServer(app).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  // Obtain initial CSRF token from the registration page
  let res = await fetch(url('/register'));
  cookie = res.headers.get('set-cookie').split(';')[0];
  let html = await res.text();
  let token = html.match(/name="_csrf" value="([^"]+)"/)[1];
  // Attempt to register the user
  res = await fetch(url('/register'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie
    },
    body: new URLSearchParams({ username: 'tester', password: 'pass', _csrf: token }),
    redirect: 'manual'
  });
  let setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    // User may already exist from previous runs; log in instead.
    res = await fetch(url('/login'), { headers: { Cookie: cookie } });
    html = await res.text();
    token = html.match(/name="_csrf" value="([^"]+)"/)[1];
    res = await fetch(url('/login'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie
      },
      body: new URLSearchParams({ username: 'tester', password: 'pass', _csrf: token }),
      redirect: 'manual'
    });
    setCookie = res.headers.get('set-cookie');
  }
  expect(setCookie).to.be.a('string');
  cookie = setCookie.split(';')[0];
  // Fetch the scraper page to retrieve a CSRF token for API requests
  res = await fetch(url('/scraper'), { headers: { Cookie: cookie } });
  html = await res.text();
  csrf = html.match(/name="_csrf" value="([^"]+)"/)[1];
});

after(() => server.close());

describe('source URL validation', () => {
  it('rejects non-HTTPS URLs', async () => {
    const res = await fetch(url('/sources'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Cookie: cookie,
        'CSRF-Token': csrf
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
        Cookie: cookie,
        'CSRF-Token': csrf
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
