/**
 * @file concurrency.js
 * @description Mini readme: lightweight wrapper around the `p-limit` library
 *   used by the scrapers to throttle concurrent HTTP requests. Exported helper
 *   `createLimiter(concurrency)` resolves to a limiter function that queues
 *   tasks when the requested concurrency would otherwise be exceeded. The
 *   module lazily loads `p-limit` so it plays nicely with CommonJS consumers.
 *
 * Structure:
 *   1. Lazily import `p-limit` and normalise its default export.
 *   2. Guard against invalid concurrency values by coercing to integers.
 *   3. Expose `createLimiter` returning a ready-to-use limiter function.
 */

const MIN_CONCURRENCY = 1;

let limitFactoryPromise;

/**
 * Dynamically import `p-limit` so we can use the modern ESM build from
 * CommonJS modules. The resolved value is cached to avoid duplicate loads.
 *
 * @returns {Promise<import('p-limit').default>} cached limit factory
 */
async function loadLimitFactory() {
  if (!limitFactoryPromise) {
    limitFactoryPromise = import('p-limit')
      .then(mod => mod.default || mod)
      .catch(err => {
        // Reset the cache so future attempts can retry if the failure was
        // transient (e.g. corrupted node_modules during deployment).
        limitFactoryPromise = null;
        throw err;
      });
  }
  return limitFactoryPromise;
}

/**
 * Create a concurrency limiter with the desired parallelism. Input is coerced
 * to a positive integer to prevent runtime errors caused by misconfiguration.
 *
 * @param {number} requestedConcurrency - Desired maximum parallel tasks
 * @returns {Promise<import('p-limit').Limit>} limiter ready to schedule work
 */
async function createLimiter(requestedConcurrency) {
  const safeConcurrency = Math.max(
    MIN_CONCURRENCY,
    Number.isFinite(requestedConcurrency)
      ? Math.floor(requestedConcurrency)
      : MIN_CONCURRENCY
  );
  const limitFactory = await loadLimitFactory();
  return limitFactory(safeConcurrency);
}

module.exports = {
  createLimiter
};

