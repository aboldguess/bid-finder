/**
 * @file auth-routes.test.js
 * @description Integration tests for routes guarded by the requireAuth
 * middleware. Ensures unauthenticated requests are either redirected to the
 * login page (HTML endpoints) or receive a 401 JSON response (API endpoints).
 *
 * Structure:
 * - Configure environment variables so the server initialises in memory.
 * - Mount the Express application without starting the network listener.
 * - Exercise a selection of protected routes via supertest and verify the
 *   HTTP status codes and headers.
 */
const { expect } = require('chai');
const http = require('http');
const fetch = require('node-fetch');

// Environment setup for the test app. Using an in-memory database avoids
// touching the real database and the session secret is set so index.js does not
// exit early.
process.env.DB_FILE = ':memory:';
process.env.SESSION_SECRET = 'test-secret';

// Load the Express application. The server only starts listening when index.js
// is executed directly, allowing us to import the app safely for tests.
const { app } = require('../server/index');

// Spin up an ephemeral HTTP server for issuing real network requests during
// tests. This avoids external dependencies like supertest while still exercising
// the Express middleware stack.
let server;
let cookie;
let csrf;
// Helper generating a URL to the test server for the given path
const url = path => `http://127.0.0.1:${server.address().port}${path}`;

before(async () => {
  server = http.createServer(app).listen(0); // 0 selects a free port
  await new Promise(resolve => server.once('listening', resolve));
  const res = await fetch(url('/login'));
  cookie = res.headers.get('set-cookie').split(';')[0];
  const html = await res.text();
  csrf = html.match(/name="_csrf" value="([^"]+)"/)[1];
});

after(() => server.close());

describe('requireAuth middleware', () => {
  it('redirects unauthenticated users from /scraper to /login', async () => {
    const res = await fetch(url('/scraper'), { redirect: 'manual' });
    expect(res.status).to.equal(302);
    // Some versions of Express include an absolute URL in the Location header,
    // so only verify that it ends with the expected path.
    expect(res.headers.get('location')).to.match(/\/login$/);
  });

  it('returns 401 for unauthorised POST /sources requests', async () => {
    const res = await fetch(url('/sources'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'CSRF-Token': csrf,
        Cookie: cookie
      },
      body: JSON.stringify({})
    });
    expect(res.status).to.equal(401);
  });

  it('returns 401 for unauthorised GET /scrape requests', async () => {
    const res = await fetch(url('/scrape'), {
      headers: { Accept: 'application/json' },
      redirect: 'manual'
    });
    expect(res.status).to.equal(401);
  });

  it('returns 401 for unauthorised GET /test-source requests', async () => {
    const res = await fetch(url('/test-source'), {
      headers: { Accept: 'application/json' },
      redirect: 'manual'
    });
    expect(res.status).to.equal(401);
  });

  it('rejects POST /login without CSRF token', async () => {
    const res = await fetch(url('/login'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie
      },
      body: new URLSearchParams({ username: 'x', password: 'y' }),
      redirect: 'manual'
    });
    expect(res.status).to.equal(403);
  });
});
