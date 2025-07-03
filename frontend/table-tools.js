// Generic table utilities adding per-column search, filter and sort.
// This script scans for all <table> elements on the page and augments their
// headers with a text input for searching and click based sorting.
// Each column header becomes interactive without needing any external library.

/**
 * Enables searching, filtering and sorting on a table.
 * @param {HTMLTableElement} table Target table element.
 */
function enhanceTable(table) {
  const headers = Array.from(table.querySelectorAll('th'));
  const rows = Array.from(table.querySelectorAll('tr')).slice(1); // exclude header

  // Track the current filter text for each column
  const filters = new Array(headers.length).fill('');

  let sortColumn = -1;
  let sortDir = 1; // 1 = ascending, -1 = descending

  headers.forEach((th, idx) => {
    // Create a small input box under the header text for searching
    const input = document.createElement('input');
    input.placeholder = 'Search...';
    input.dataset.index = idx;
    input.style.width = '90%';
    input.addEventListener('input', applyFilters);

    th.appendChild(document.createElement('br'));
    th.appendChild(input);

    th.style.cursor = 'pointer';
    th.addEventListener('click', () => sortByColumn(idx));
  });

  /**
   * Filters rows so only those matching all column search terms remain visible.
   */
  function applyFilters() {
    filters[this.dataset.index] = this.value.toLowerCase();

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      const visible = filters.every((text, i) => {
        return !text || (cells[i] && cells[i].textContent.toLowerCase().includes(text));
      });
      row.style.display = visible ? '' : 'none';
    });
  }

  /**
   * Sorts the table rows by the specified column index. Repeated clicks toggle
   * between ascending and descending order.
   * @param {number} idx Column index to sort by
   */
  function sortByColumn(idx) {
    sortDir = sortColumn === idx ? -sortDir : 1;
    sortColumn = idx;

    rows.sort((a, b) => {
      const aText = a.children[idx].textContent.trim();
      const bText = b.children[idx].textContent.trim();
      return aText.localeCompare(bText, undefined, { numeric: true }) * sortDir;
    });

    rows.forEach(r => table.appendChild(r));
  }
}

// Automatically enhance all tables on the page once the DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('table').forEach(enhanceTable);
});
