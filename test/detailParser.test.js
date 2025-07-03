const { expect } = require('chai');
const { parseAwardDetails } = require('../server/detailParser');

describe('parseAwardDetails', () => {
  it('extracts fields from award page text', () => {
    const text = `M6 Lune Gorge - Bird Netting/ Tree Netting
KIER TRANSPORTATION LIMITED
Published date: 3 July 2025

Open opportunity - This means that the contract is currently active.

Contract summary
Industry
Cordage, rope, twine and netting - 39541000

Location of contract
CA10 3XR

Value of contract
£300,000

Procurement reference
ABC123

Closing date
10 July 2025

Closing time
5pm

Contract start date
21 August 2025

Contract end date
1 October 2025

Contract type
Works

Procedure type
Competitive quotation (below threshold)
What is a competitive quotation (below threshold)?
Bidders submit quotes.
Contract is suitable for SMEs?
Yes
Contract is suitable for VCSEs?
No
Description
Work on bridge structures.
How to apply
Follow instructions.
About the buyer
Address
2nd Floor Optimum House
SALFORD
M503XP
England
Email
transportationprocurement@kier.co.uk`;
    const d = parseAwardDetails(text);
    expect(d.value).to.equal('£300,000');
    expect(d.location).to.equal('CA10 3XR');
    expect(d.contract_type).to.equal('Works');
    expect(d.suitable_for_sme).to.equal(true);
    expect(d.buyer_email).to.equal('transportationprocurement@kier.co.uk');
  });
});
