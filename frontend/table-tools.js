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
  const rows = Array.from(table.querySelectorAll('tr')).slice(1); // exclude header row

  // Each filters[i] is a function that returns true if a given row should be visible
  const filters = new Array(headers.length).fill(() => true);

  let sortColumn = -1;
  let sortDir = 1; // 1 = ascending, -1 = descending

  const types = [];
  headers.forEach((th, idx) => {
    const type = th.dataset.type || 'text';
    types[idx] = type;

    // Insert an element to show sort direction
    const icon = document.createElement('span');
    icon.className = 'sort-icon';
    th.appendChild(icon);

    th.appendChild(document.createElement('br'));

    if (type === 'date') {
      // From date input
      const from = document.createElement('input');
      from.type = 'date';
      from.dataset.index = idx;
      from.addEventListener('change', applyFilters);
      // To date input
      const to = document.createElement('input');
      to.type = 'date';
      to.dataset.index = idx;
      to.dataset.to = '1';
      to.addEventListener('change', applyFilters);
      th.appendChild(from);
      th.appendChild(to);

      filters[idx] = row => {
        const text = row.children[idx].textContent.trim();
        const cellDate = text ? new Date(text) : null;
        if (!cellDate) return false;
        const fromVal = from.value ? new Date(from.value) : null;
        const toVal = to.value ? new Date(to.value) : null;
        if (fromVal && cellDate < fromVal) return false;
        if (toVal && cellDate > toVal) return false;
        return true;
      };
    } else if (type === 'source') {
      const select = document.createElement('select');
      select.dataset.index = idx;
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'All';
      select.appendChild(blank);
      // Build option list from unique values in the column
      const unique = new Set(rows.map(r => r.children[idx].textContent.trim()));
      unique.forEach(val => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        select.appendChild(opt);
      });
      select.addEventListener('change', applyFilters);
      th.appendChild(select);
      filters[idx] = row => {
        const val = select.value;
        if (!val) return true;
        return row.children[idx].textContent.trim() === val;
      };
    } else {
      // Default free text input
      const input = document.createElement('input');
      input.placeholder = 'Search...';
      input.dataset.index = idx;
      input.style.width = '90%';
      input.addEventListener('input', applyFilters);
      th.appendChild(input);
      filters[idx] = row => {
        const val = input.value.toLowerCase();
        if (!val) return true;
        const cell = row.children[idx];
        return cell && cell.textContent.toLowerCase().includes(val);
      };
    }

    th.style.cursor = 'pointer';
    th.addEventListener('click', () => sortByColumn(idx));
  });

  // Apply initial filters to hide rows that don't match default controls
  applyFilters();

  /**
   * Filters rows so only those matching all column search terms remain visible.
   */
  function applyFilters() {
    rows.forEach(row => {
      const visible = filters.every(fn => fn(row));
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

    const type = types[idx];

    rows.sort((a, b) => {
      const aText = a.children[idx].textContent.trim();
      const bText = b.children[idx].textContent.trim();
      if (type === 'date') {
        return (new Date(aText) - new Date(bText)) * sortDir;
      }
      return aText.localeCompare(bText, undefined, { numeric: true }) * sortDir;
    });

    rows.forEach(r => table.appendChild(r));

    // Update sort icons
    headers.forEach((h, i) => {
      const icon = h.querySelector('.sort-icon');
      if (!icon) return;
      if (i === sortColumn) {
        icon.textContent = sortDir === 1 ? '▲' : '▼';
      } else {
        icon.textContent = '';
      }
    });
  }
}

// Automatically enhance all tables on the page once the DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('table').forEach(enhanceTable);
});
