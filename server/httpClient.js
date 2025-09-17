/**
 * @file httpClient.js
 * @description Mini readme: centralises HTTP access for the scraping layer.
 *   The module builds a hardened Axios client with retry support and exposes a
 *   small helper (`fetchText`) that mirrors the parts of the old `fetch` API we
 *   relied upon. Configuration is sourced from `config.network`, keeping
 *   timeouts, retry counts and body size limits consistent across scrapers.
 *   Logging hooks emit retry attempts and terminal failures for easier
 *   debugging.
 *
 * Structure:
 *   1. Initialise a shared Axios instance using project configuration.
 *   2. Attach axios-retry to provide exponential backoff on transient faults.
 *   3. Register interceptors that log retries and last-chance failures.
 *   4. Export the raw client and the convenience `fetchText` helper.
 */
const axios = require('axios');
const axiosRetry = require('axios-retry');

const config = require('./config');
const logger = require('./logger');

const networkConfig = config.network || {};
const RETRY_ATTEMPTS = Math.max(0, networkConfig.retryAttempts ?? 3);

// Shared Axios instance so TCP connections can be reused by keep-alive.
const client = axios.create({
  timeout: networkConfig.requestTimeout,
  maxContentLength: networkConfig.maxContentLength,
  maxBodyLength: networkConfig.maxContentLength,
  decompress: true,
  // Response encoding is handled automatically, we simply request UTF-8 strings.
  responseType: 'text'
});

// Attach axios-retry using exponential backoff to cope with flaky upstreams.
axiosRetry(client, {
  retries: RETRY_ATTEMPTS,
  retryDelay: axiosRetry.exponentialDelay,
  shouldResetTimeout: true,
  onRetry: (retryCount, error, requestConfig) => {
    const url = requestConfig?.url || 'unknown URL';
    const total = requestConfig?.['axios-retry']?.retries ?? RETRY_ATTEMPTS;
    logger.info(
      `Retrying request to ${url} (attempt ${retryCount}/${total}) due to: ${error.message}`
    );
  }
});

// Final failure logging: axios-retry mutates the request config with the retry
// state. Once the retry count meets the configured cap we emit an error log.
client.interceptors.response.use(
  response => response,
  error => {
    const requestConfig = error.config || {};
    const retryState = requestConfig['axios-retry'] || {};
    const attempts = retryState.retryCount || 0;
    const allowed =
      typeof retryState.retries === 'number' ? retryState.retries : RETRY_ATTEMPTS;

    if (attempts >= allowed) {
      const url = requestConfig.url || 'unknown URL';
      logger.error(
        `Request to ${url} failed after ${attempts} attempt${
          attempts === 1 ? '' : 's'
        }: ${error.message}`
      );
    }

    return Promise.reject(error);
  }
);

/**
 * Fetch a URL and return the body as a UTF-8 string. The helper mirrors the
 * subset of the Fetch API used throughout the project so callers can migrate
 * without structural changes.
 *
 * @param {string} url - Absolute URL to request
 * @param {import('axios').AxiosRequestConfig} [options] - Optional Axios config
 * @returns {Promise<string>} response body
 */
async function fetchText(url, options = {}) {
  // `transformResponse` is disabled to avoid implicit JSON parsing when the
  // upstream incorrectly reports a JSON content-type for HTML pages.
  const response = await client.get(url, {
    ...options,
    responseType: 'text',
    transformResponse: data => data
  });
  return response.data;
}

module.exports = {
  client,
  fetchText
};

