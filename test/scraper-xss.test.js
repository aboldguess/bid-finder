/**
 * @file scraper-xss.test.js
 * @description Integration tests ensuring the scraper management page renders
 *              data safely and the server rejects malicious source definitions.
 *
 * Structure:
 * - Start the Express app with an in-memory SQLite database.
 * - Register a user to obtain a session cookie for authenticated requests.
 * - Attempt to create a source with an injection payload and expect rejection.
 * - Inject a malicious label into the configuration and verify the rendered
 *   page escapes the script tag.
 */
const { expect } = require('chai');
const http = require('http');
const fetch = require('node-fetch');
const config = require('../server/config');

// Isolate the test environment from the real database and relax the session
// cookie security so node-fetch can capture it over plain HTTP.
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

  // Register a test user; registration logs the user in and sets a session
  // cookie which we forward on subsequent requests.
  const res = await fetch(url('/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'tester', password: 'pass' }),
    redirect: 'manual'
  });
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => server.close());

describe('scraper page XSS protections', () => {
  it('rejects source definitions containing angle brackets', async () => {
    const res = await fetch(url('/sources'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        key: 'bad',
        label: '</script>',
        url: 'http://example.com',
        base: 'http://example.com'
      })
    });
    expect(res.status).to.equal(400);
  });

  it('escapes malicious labels when rendering the scraper page', async () => {
    // Inject a source directly into the configuration to emulate stored XSS.
    config.sources.evil = {
      label: '</script><script>alert(1)</script>',
      url: 'http://example.com',
      base: 'http://example.com',
      parser: 'contractsFinder'
    };

    const res = await fetch(url('/scraper'), {
      headers: { Cookie: cookie }
    });
    const html = await res.text();
    expect(html).to.not.include('</script><script>alert(1)</script>');
    expect(html).to.include('\u003c/script>');
    delete config.sources.evil;
  });
});

