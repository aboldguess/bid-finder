/**
 * @file helmet.js
 * @description Lightweight fallback implementation mimicking a subset of the
 * Helmet middleware for environments where the official package cannot be
 * installed. It sets a few common security headers including an optional
 * Content Security Policy.
 *
 * Structure:
 * - Build Content-Security-Policy string from provided directives.
 * - Return Express middleware function applying security headers.
 */
module.exports = function helmet(options = {}) {
  const directives =
    options.contentSecurityPolicy && options.contentSecurityPolicy.directives;
  let csp;
  if (directives) {
    csp = Object.entries(directives)
      .map(([key, value]) => {
        const headerName = key.replace(/([A-Z])/g, m => '-' + m.toLowerCase());
        return `${headerName} ${value.join(' ')}`;
      })
      .join('; ');
  }
  return function helmetMiddleware(req, res, next) {
    // Basic headers equivalent to Helmet defaults
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (csp) {
      res.setHeader('Content-Security-Policy', csp);
    }
    next();
  };
};
