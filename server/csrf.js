/**
 * @file csrf.js
 * @description Lightweight CSRF protection middleware used when external
 * libraries cannot be installed. Tokens are stored per-session and verified on
 * all mutating requests. API mirrors the popular csurf module.
 *
 * Usage:
 * const csrf = require('./csrf');
 * app.use(csrf());
 */
const crypto = require('crypto');

/**
 * Factory creating CSRF middleware bound to the current session.
 * @returns {function} Express middleware enforcing token validation.
 */
function csrf() {
  return function csrfMiddleware(req, res, next) {
    if (!req.session) {
      throw new Error('csrf middleware requires an active session');
    }
    // Create a session-bound secret on first use.
    if (!req.session.csrfSecret) {
      req.session.csrfSecret = crypto.randomBytes(24).toString('hex');
    }
    // Helper available to routes and templates for embedding a token.
    req.csrfToken = () =>
      crypto
        .createHmac('sha256', req.session.csrfSecret)
        .update('csrf-token')
        .digest('hex');

    // Only check non-safe methods.
    const safe = ['GET', 'HEAD', 'OPTIONS', 'TRACE'];
    if (safe.includes(req.method)) return next();

    const token =
      (req.body && req.body._csrf) ||
      req.headers['csrf-token'] ||
      req.headers['x-csrf-token'] ||
      req.headers['x-xsrf-token'] ||
      (req.query && req.query._csrf);

    if (token && token === req.csrfToken()) return next();

    const err = new Error('Invalid CSRF token');
    err.code = 'EBADCSRFTOKEN';
    return next(err);
  };
}

module.exports = csrf;
