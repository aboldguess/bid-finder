// Mini readme
// ------------
// Parser utilities for tender and award detail pages. The scrapers fetch
// individual opportunity pages to obtain richer metadata that is not
// available in listing feeds. Each parser normalises the input HTML into
// a simple JavaScript object so the rest of the code can work with
// consistent structures. The tender parser now extracts key fields such as
// deadlines and buyer details so they can be persisted alongside CPV codes.

// ---------------------------------------------------------------------------
// Award detail parser
// ---------------------------------------------------------------------------
// Extracts structured fields from an awarded contract page. The input is
// expected to be HTML or plain text containing headings like
// "Location of contract" followed by the corresponding value on the next
// line. The parser returns an object with keys matching the database columns
// used to store additional award information.

function parseAwardDetails(html) {
  // Strip HTML tags and normalise line endings to simplify regex matching.
  const text = html.replace(/<[^>]*>/g, '').replace(/\r/g, '');
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const out = {};

  // Helper to read the value immediately after a label. Many fields are
  // presented on the next line so we locate the label and take the
  // subsequent line as the value.
  const valueAfter = label => {
    const idx = lines.findIndex(l => l.toLowerCase() === label.toLowerCase());
    return idx !== -1 && lines[idx + 1] ? lines[idx + 1] : '';
  };

  // Extract simple one line fields.
  out.buyer = lines[1] || '';
  out.status = (text.match(/(Open opportunity|Closed opportunity|Awarded)/i) || [])[0] || '';
  out.industry = (() => {
    const start = lines.findIndex(l => l.toLowerCase() === 'industry');
    if (start === -1) return '';
    const values = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^(location of contract|value of contract|procurement reference|published date|closing date|closing time|contract start date|contract end date|contract type|procedure type)/i.test(l)) break;
      values.push(l);
    }
    return values.join('; ');
  })();
  out.location = valueAfter('Location of contract');
  out.value = valueAfter('Value of contract');
  out.procurement_reference = valueAfter('Procurement reference');
  out.closing_date = valueAfter('Closing date');
  out.closing_time = valueAfter('Closing time');
  out.start_date = valueAfter('Contract start date');
  out.end_date = valueAfter('Contract end date');
  out.contract_type = valueAfter('Contract type');
  out.procedure_type = valueAfter('Procedure type');
  out.procedure_desc = (() => {
    const idx = lines.findIndex(l => /^what is/i.test(l));
    if (idx === -1) return '';
    const vals = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^contract is suitable/i.test(l)) break;
      vals.push(l);
    }
    return vals.join(' ');
  })();
  out.suitable_for_sme = valueAfter('Contract is suitable for SMEs?').toLowerCase() === 'yes';
  out.suitable_for_vcse = valueAfter('Contract is suitable for VCSEs?').toLowerCase() === 'yes';
  out.description = (() => {
    const start = lines.findIndex(l => l.toLowerCase() === 'description');
    if (start === -1) return '';
    const vals = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.toLowerCase() === 'how to apply') break;
      vals.push(l);
    }
    return vals.join(' ');
  })();
  out.how_to_apply = (() => {
    const start = lines.findIndex(l => l.toLowerCase() === 'how to apply');
    if (start === -1) return '';
    const vals = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.toLowerCase() === 'about the buyer') break;
      vals.push(l);
    }
    return vals.join(' ');
  })();
  out.buyer_address = (() => {
    const start = lines.findIndex(l => l.toLowerCase() === 'address');
    if (start === -1) return '';
    const vals = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.toLowerCase() === 'email') break;
      vals.push(l);
    }
    return vals.join(', ');
  })();
  out.buyer_email = valueAfter('Email');

  return out;
}

// ---------------------------------------------------------------------------
// Tender detail parser
// ---------------------------------------------------------------------------
/**
 * Parse a tender's detail page to extract structured fields. Besides CPV
 * codes the function attempts to pull commonly used metadata such as
 * deadlines and buyer details by looking for labelled sections in the plain
 * text version of the page.
 *
 * @param {string} html - Raw HTML of the opportunity detail page
 * @returns {object} Object containing CPV codes and additional fields
 */
function parseTenderDetails(html) {
  // Remove HTML tags so the regex can work on plain text. Collapsing
  // whitespace avoids spurious blank entries when splitting later.
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\r/g, '');
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const valueAfter = label => {
    const idx = lines.findIndex(l => l.toLowerCase() === label.toLowerCase());
    return idx !== -1 && lines[idx + 1] ? lines[idx + 1] : '';
  };
  const out = {};
  out.cpv = Array.from(new Set(text.match(/\b\d{8}\b/g) || []));
  out.open_date = valueAfter('Published date');
  out.deadline = valueAfter('Closing date') || valueAfter('Response deadline');
  out.customer =
    valueAfter('Name of buying organisation') || valueAfter('Buyer');
  out.address = valueAfter('Address');
  out.country = valueAfter('Country');
  out.description = (() => {
    const start = lines.findIndex(l => l.toLowerCase() === 'description');
    if (start === -1) return '';
    const vals = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^(eligibility|how to apply|about the buyer)/i.test(l)) break;
      vals.push(l);
    }
    return vals.join(' ');
  })();
  out.eligibility = valueAfter('Eligibility');
  return out;
}

module.exports = { parseAwardDetails, parseTenderDetails };
