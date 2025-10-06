/**
 * @file parser-detection.test.js
 * @description Mini readme: verifies the automatic parser inference helper can
 *   correctly identify which scraping strategy to apply based on sample
 *   responses. The tests stub the HTTP client to avoid real network requests
 *   and feed fixture HTML/XML into the detection heuristics.
 *
 * Structure:
 *   1. Utility `loadModule` helper wires proxyquire with stubbed dependencies.
 *   2. Individual tests cover RSS, EU Supply, Sell2Wales, UKRI and Contracts
 *      Finder layouts.
 *   3. Error handling is exercised to confirm a safe fallback to the default
 *      parser when fetching fails.
 */
const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

proxyquire.noCallThru();
proxyquire.noPreserveCache();

function loadModule(configureFetch) {
  const fetchTextStub = sinon.stub();
  configureFetch(fetchTextStub);
  const loggerStub = {
    info: sinon.stub(),
    error: sinon.stub()
  };

  const parserModule = proxyquire('../server/htmlParser', {
    './httpClient': { fetchText: fetchTextStub },
    './logger': loggerStub
  });

  return {
    inferParserForSource: parserModule.inferParserForSource,
    DEFAULT_PARSER_KEY: parserModule.DEFAULT_PARSER_KEY,
    fetchTextStub,
    loggerStub
  };
}

describe('inferParserForSource', () => {
  it('detects RSS feeds using the content-type header', async () => {
    const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss><channel><title>Feed</title><item><title>A</title></item></channel></rss>`;
    const { inferParserForSource, fetchTextStub } = loadModule(stub => {
      stub.resolves({
        body: sampleRss,
        contentType: 'application/rss+xml; charset=utf-8'
      });
    });

    const parserKey = await inferParserForSource({ url: 'https://example.com/rss' });
    expect(parserKey).to.equal('rss');
    expect(
      fetchTextStub.calledOnceWith('https://example.com/rss', sinon.match({ includeMeta: true }))
    ).to.be.true;
  });

  it('detects EU Supply markup from distinctive table headers', async () => {
    const euHtml = `
      <html>
        <body>
          <table class="eu-supply-table">
            <thead>
              <tr><th>Tender Title</th><th>Tender Reference</th><th>Publication Date</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><a href="/tender">Example Tender</a></td>
                <td class="description">Important works</td>
                <td><time>2024-05-01</time></td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>`;

    const { inferParserForSource } = loadModule(stub => {
      stub.resolves({ body: euHtml, contentType: 'text/html; charset=utf-8' });
    });

    const parserKey = await inferParserForSource({ url: 'https://eu.example/list' });
    expect(parserKey).to.equal('eusupply');
  });

  it('detects Sell2Wales listings using branded captions', async () => {
    const sellHtml = `
      <html>
        <body>
          <table data-sell2wales-table="true">
            <caption>Sell2Wales opportunities</caption>
            <tbody>
              <tr>
                <td><a href="/opp">Opportunity</a></td>
                <td class="description">Details</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>`;

    const { inferParserForSource } = loadModule(stub => {
      stub.resolves({ body: sellHtml, contentType: 'text/html' });
    });

    const parserKey = await inferParserForSource({ url: 'https://sell2wales.example/list' });
    expect(parserKey).to.equal('sell2wales');
  });

  it('detects UKRI article based listings', async () => {
    const ukriHtml = `
      <html>
        <body>
          <article class="ukri-opportunity">
            <h2><a href="/opp">Research Project</a></h2>
            <time>2024-05-01</time>
            <p>Summary</p>
          </article>
        </body>
      </html>`;

    const { inferParserForSource } = loadModule(stub => {
      stub.resolves({ body: ukriHtml, contentType: 'text/html' });
    });

    const parserKey = await inferParserForSource({ url: 'https://ukri.example/list' });
    expect(parserKey).to.equal('ukri');
  });

  it('falls back to Contracts Finder when search-result blocks exist', async () => {
    const cfHtml = `
      <div class="search-result">
        <h2>Contract</h2>
        <a href="/contract">View</a>
      </div>`;

    const { inferParserForSource, DEFAULT_PARSER_KEY } = loadModule(stub => {
      stub.resolves({ body: cfHtml, contentType: 'text/html' });
    });

    const parserKey = await inferParserForSource({ url: 'https://cf.example/list' });
    expect(parserKey).to.equal(DEFAULT_PARSER_KEY);
  });

  it('returns the default parser and logs on fetch failure', async () => {
    const fetchError = new Error('network unreachable');
    const { inferParserForSource, DEFAULT_PARSER_KEY, loggerStub, fetchTextStub } = loadModule(
      stub => {
        stub.rejects(fetchError);
      }
    );

    const parserKey = await inferParserForSource({ url: 'https://broken.example/list' });
    expect(parserKey).to.equal(DEFAULT_PARSER_KEY);
    expect(loggerStub.error.called).to.be.true;
    expect(fetchTextStub.calledOnce).to.be.true;
  });
});
