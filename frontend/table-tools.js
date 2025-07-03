// Generic table utilities adding per-column search, filter and sort.
// This script scans for all <table> elements on the page and augments their
// headers with a text input for searching and click based sorting.
// Each column header becomes interactive without needing any external library.

/**
 * Enables searching, filtering and sorting on a table.
 * @param {HTMLTableElement} table Target table element.
 */
function enhanceTable(table) {
  // Only consider header cells from the first row so nested tables are ignored
  const headerRow = table.rows[0];
  if (!headerRow) return;
  const headers = Array.from(headerRow.cells);

  // Build a list of data rows and store references to accompanying detail rows
  // (if present). These pairs are used for filtering, sorting and pagination so
  // detail rows remain attached to their parent record.
  const pairs = [];
  // Grab only direct child rows after the header. querySelectorAll('tr') would
  // also return rows from nested tables which corrupts the layout when
  // filtered or sorted.
  const allRows = Array.from(table.rows).slice(1); // skip header
  for (let i = 0; i < allRows.length; i++) {
    const main = allRows[i];
    if (main.classList.contains('detailRow')) continue;
    const next = allRows[i + 1];
    const detail = next && next.classList.contains('detailRow') ? next : null;
    if (detail) i++;
    pairs.push({ main, detail });
  }

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
      // Build option list from unique values in the column. Only consider the
      // main row of each pair so detail rows don't pollute the options.
      const unique = new Set(
        pairs.map(p => p.main.children[idx].textContent.trim())
      );
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

  // Pagination state: how many rows to show per page and the current page.
  // Larger tables can slow down the browser when rendered in full, so we
  // cap the number of visible rows at 100. Adjust pageSize here to change the
  // default across all tables.
  const pageSize = 100;
  let currentPage = 0;
  let filteredCount = pairs.length;

  // Navigation controls inserted after the table.
  const pager = document.createElement('div');
  pager.className = 'pagination';
  const prevBtn = document.createElement('button');
  prevBtn.textContent = 'Prev';
  const info = document.createElement('span');
  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next';
  pager.append(prevBtn, info, nextBtn);
  table.parentNode.insertBefore(pager, table.nextSibling);

  prevBtn.addEventListener('click', () => {
    if (currentPage > 0) showPage(currentPage - 1);
  });
  nextBtn.addEventListener('click', () => {
    if (currentPage < Math.ceil(filteredCount / pageSize) - 1) {
      showPage(currentPage + 1);
    }
  });

  // Apply initial filters and show the first page.
  applyFilters();

  /**
   * Filters rows so only those matching all column search terms remain visible.
   */
  function applyFilters() {
    filteredCount = 0;
    pairs.forEach(p => {
      const visible = filters.every(fn => fn(p.main));
      p.main.dataset.visible = visible ? '1' : '0';
      if (visible) filteredCount++;
    });
    showPage(0);
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

    pairs.sort((a, b) => {
      const aText = a.main.children[idx].textContent.trim();
      const bText = b.main.children[idx].textContent.trim();
      if (type === 'date') {
        return (new Date(aText) - new Date(bText)) * sortDir;
      }
      return aText.localeCompare(bText, undefined, { numeric: true }) * sortDir;
    });

    // Re-append sorted rows to the table keeping each detail row with its main row
    pairs.forEach(p => {
      table.appendChild(p.main);
      if (p.detail) table.appendChild(p.detail);
    });

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
    // After sorting redisplay the current page so ordering takes effect
    showPage(currentPage);
  }

  /**
   * Display a specific page of results based on the current filter set.
   * @param {number} page Page index starting from 0
   */
  function showPage(page) {
    currentPage = page;
    const start = page * pageSize;
    let index = 0;
    pairs.forEach(p => {
      const show = p.main.dataset.visible === '1';
      if (!show) {
        p.main.style.display = 'none';
        if (p.detail) p.detail.style.display = 'none';
        return;
      }
      if (index >= start && index < start + pageSize) {
        p.main.style.display = '';
      } else {
        p.main.style.display = 'none';
        if (p.detail) p.detail.style.display = 'none';
      }
      index++;
    });
    const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
    info.textContent = `Page ${currentPage + 1} of ${totalPages}`;
    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = currentPage >= totalPages - 1;
  }
}

// Automatically enhance all tables on the page once the DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('table').forEach(enhanceTable);
});
