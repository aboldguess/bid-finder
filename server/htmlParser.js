// Minimal HTML parser used to extract tender information without external
// dependencies. It relies on regular expressions which are sufficient for the
// simple markup structure returned by Contracts Finder.

/**
 * Parse the search results HTML and return an array of tender objects.
 *
 * @param {string} html - Raw HTML from the search results page
 * @returns {Array<{title: string, link: string, date: string, desc: string}>}
 */
exports.parseTenders = function parseTenders(html) {
  const tenders = [];

  // Match each result block. The `[^]*?` pattern matches any text, including new
  // lines, in a non-greedy way so we capture one result at a time.
  const blockRe = /<div class="search-result">([^]*?)<\/div>/g;
  let blockMatch;
  while ((blockMatch = blockRe.exec(html))) {
    const block = blockMatch[1];

    // Extract required fields using small, targeted regexes. The "?" after each
    // group ensures we do not throw if a piece of data is missing.
    const title = /<h2>(.*?)<\/h2>/.exec(block)?.[1].trim() || '';
    const link = /<a[^>]*href="([^"]+)"/.exec(block)?.[1] || '';
    const date = /<span class="date">(.*?)<\/span>/.exec(block)?.[1].trim() || '';
    const desc = /<p>(.*?)<\/p>/.exec(block)?.[1].trim() || '';

    tenders.push({ title, link, date, desc });
  }

  return tenders;
};
