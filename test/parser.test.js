const { expect } = require('chai');
const { parseTenders } = require('../server/htmlParser');

describe('htmlParser', () => {
  it('parses Contracts Finder style HTML', () => {
    const html = `
      <div class="search-result">
        <h2>Contract A</h2>
        <span class="org">OrgA</span>
        <span class="supplier">SupA</span>
        <a href="/cA">View</a>
        <span class="date">2024-01-01</span>
        <p>Desc A</p>
      </div>
      <div class="search-result">
        <a href="/cB">Contract B</a>
        <span class="org">OrgB</span>
        <span class="supplier">SupB</span>
        <time>2024-02-01</time>
        <p>Desc B</p>
      </div>`;
    const tenders = parseTenders(html, 'contractsFinder');
    expect(tenders).to.have.length(2);
    expect(tenders[0].title).to.equal('Contract A');
    expect(tenders[1].title).to.equal('Contract B');
    expect(tenders[0].organisation).to.equal('OrgA');
    expect(tenders[0].supplier).to.equal('SupA');
  });

  it('parses Sell2Wales table rows', () => {
    const html = `
      <table>
        <tr><td><a href="/s1">S1</a></td><td class="description">D1</td><td>01/01/2024</td></tr>
        <tr><td><a href="/s2">S2</a></td><td class="description">D2</td><td>2024-02-02</td></tr>
      </table>`;
    const tenders = parseTenders(html, 'sell2wales');
    expect(tenders).to.have.length(2);
    expect(tenders[0].title).to.equal('S1');
    expect(tenders[1].date).to.equal('2024-02-02');
  });

  it('parses UKRI article listings', () => {
    const html = `
      <article><h2><a href="/u1">U1</a></h2><time>2024-03-03</time><p>DU1</p></article>
      <article><a href="/u2">U2</a><time>2024-04-04</time><p>DU2</p></article>`;
    const tenders = parseTenders(html, 'ukri');
    expect(tenders).to.have.length(2);
    expect(tenders[0].link).to.equal('/u1');
    expect(tenders[1].date).to.equal('2024-04-04');
  });
});
