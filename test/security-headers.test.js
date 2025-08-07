/**
 * @file security-headers.test.js
 * @description Verifies that global security headers such as the Content
 * Security Policy are applied via Helmet. Ensures responses contain the
 * expected protection headers.
 *
 * Structure:
 * - Configure environment for in-memory operation.
 * - Spin up the Express application on a random port.
 * - Issue a request and assert key security headers are present.
 */
const { expect } = require('chai');
const http = require('http');
const fetch = require('node-fetch');

process.env.DB_FILE = ':memory:';
process.env.SESSION_SECRET = 'test-secret';

const { app } = require('../server/index');
let server;
const url = path => `http://127.0.0.1:${server.address().port}${path}`;

before(async () => {
  server = http.createServer(app).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
});

after(() => server.close());

describe('security headers', () => {
  it('includes CSP and other Helmet headers', async () => {
    const res = await fetch(url('/login'));
    expect(res.headers.get('content-security-policy')).to.include("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).to.equal('nosniff');
    expect(res.headers.get('x-dns-prefetch-control')).to.equal('off');
  });
});
