/*
 * File: tenders-hub.js
 * Overview: Client-side coordinator for the Tenders explorer. It wires filter
 *   controls to the /api/tenders endpoint, provides CPV-assisted filtering and
 *   renders a paginated results table.
 * Structure:
 *   - Builds UI components (source checkboxes, CPV favourites, suggestions).
 *   - Maintains a state object representing the active filters.
 *   - Fetches tender data and updates pagination/status text.
 */
(function () {
  const prefill = window.__TENDER_PREFILL__ || {};
  const sources = Array.isArray(prefill.sources) ? prefill.sources : [];
  const favouriteCpv = Array.isArray(prefill.favourites) ? prefill.favourites : [];

  const searchInput = document.getElementById('tenderSearch');
  const sourceContainer = document.getElementById('sourceSelect');
  const scrapedFromInput = document.getElementById('scrapedFrom');
  const scrapedToInput = document.getElementById('scrapedTo');
  const openFromInput = document.getElementById('openFrom');
  const openToInput = document.getElementById('openTo');
  const closeFromInput = document.getElementById('closeFrom');
  const closeToInput = document.getElementById('closeTo');
  const sortField = document.getElementById('sortField');
  const sortDirection = document.getElementById('sortDirection');
  const applyBtn = document.getElementById('applyFilters');
  const resetBtn = document.getElementById('resetFilters');
  const tenderStatus = document.getElementById('tenderStatus');
  const tableBody = document.getElementById('tendersTableBody');
  const pageInfo = document.getElementById('tenderPageInfo');
  const prevBtn = document.getElementById('tenderPrev');
  const nextBtn = document.getElementById('tenderNext');
  const cpvModeInputs = document.querySelectorAll('input[name="cpvMode"]');
  const cpvFavouriteContainer = document.getElementById('cpvFilterFavourites');
  const cpvSearchInput = document.getElementById('cpvFilterSearch');
  const cpvSuggestions = document.getElementById('cpvFilterSuggestions');
  const cpvSelectionList = document.getElementById('cpvFilterSelection');

  const state = {
    page: 1,
    pageSize: 25,
    total: 0,
    query: '',
    sources: new Set(),
    scrapedFrom: null,
    scrapedTo: null,
    openFrom: null,
    openTo: null,
    closeFrom: null,
    closeTo: null,
    cpv: new Map(),
    cpvMode: 'or',
    sort: 'scraped_at',
    direction: 'desc'
  };

  function renderSourceOptions() {
    if (!sourceContainer) return;
    sourceContainer.innerHTML = '';
    if (!sources.length) {
      const empty = document.createElement('p');
      empty.className = 'form-hint';
      empty.textContent = 'No sources recorded yet. Run a scrape to populate this list.';
      sourceContainer.appendChild(empty);
      return;
    }
    sources.forEach((source, idx) => {
      const id = `source_${idx}`;
      const wrapper = document.createElement('label');
      wrapper.className = 'multiselect__option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = source;
      checkbox.id = id;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.sources.add(source);
        } else {
          state.sources.delete(source);
        }
        scheduleFetch();
      });
      const span = document.createElement('span');
      span.textContent = source;
      wrapper.append(checkbox, span);
      sourceContainer.appendChild(wrapper);
    });
  }

  function renderFavouriteCpvButtons() {
    if (!cpvFavouriteContainer) return;
    cpvFavouriteContainer.innerHTML = '';
    if (!favouriteCpv.length) {
      const empty = document.createElement('p');
      empty.className = 'form-hint';
      empty.textContent = 'Favourite CPV codes will appear here once saved in the CPV Explorer tab.';
      cpvFavouriteContainer.appendChild(empty);
      return;
    }
    favouriteCpv.forEach(entry => {
      if (!entry || typeof entry.code !== 'string') return;
      const code = entry.code.trim();
      if (!/^\d{8}$/.test(code)) return;
      const description = entry.description || '';
      const button = document.createElement('button');
      button.type = 'button';
      // Present the favourite using both the code and its label so users can
      // recognise it without relying on the tooltip alone.
      const label = description ? `${code} – ${description}` : code;
      button.textContent = label;
      button.title = description || code;
      button.className = 'outline';
      const updateState = () => {
        if (state.cpv.has(code)) {
          button.classList.add('active');
        } else {
          button.classList.remove('active');
        }
      };
      button.addEventListener('click', () => {
        if (state.cpv.has(code)) {
          state.cpv.delete(code);
        } else {
          state.cpv.set(code, description);
        }
        updateState();
        renderSelectedCpv();
        scheduleFetch(true);
      });
      updateState();
      cpvFavouriteContainer.appendChild(button);
    });
  }

  function renderSelectedCpv() {
    if (!cpvSelectionList) return;
    cpvSelectionList.innerHTML = '';
    if (!state.cpv.size) {
      const empty = document.createElement('li');
      empty.className = 'form-hint';
      empty.textContent = 'No CPV filters selected.';
      cpvSelectionList.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    state.cpv.forEach((description, code) => {
      const li = document.createElement('li');
      const info = document.createElement('span');
      info.innerHTML = `<strong>${code}</strong> – ${description || 'No description'}`;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'outline';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        state.cpv.delete(code);
        renderSelectedCpv();
        renderFavouriteCpvButtons();
        scheduleFetch(true);
      });
      li.append(info, removeBtn);
      fragment.appendChild(li);
    });
    cpvSelectionList.appendChild(fragment);
    renderFavouriteCpvButtons();
  }

  function collectFilterValues() {
    state.query = searchInput ? searchInput.value.trim() : '';
    state.scrapedFrom = scrapedFromInput && scrapedFromInput.value ? new Date(scrapedFromInput.value).toISOString() : null;
    state.scrapedTo = scrapedToInput && scrapedToInput.value ? new Date(scrapedToInput.value).toISOString() : null;
    state.openFrom = openFromInput ? openFromInput.value : null;
    state.openTo = openToInput ? openToInput.value : null;
    state.closeFrom = closeFromInput ? closeFromInput.value : null;
    state.closeTo = closeToInput ? closeToInput.value : null;
    state.sort = sortField ? sortField.value : 'scraped_at';
    state.direction = sortDirection ? sortDirection.value : 'desc';
    const mode = Array.from(cpvModeInputs).find(r => r.checked);
    state.cpvMode = mode ? mode.value : 'or';
  }

  let fetchTimer = null;
  function scheduleFetch(immediate = false) {
    if (fetchTimer) {
      clearTimeout(fetchTimer);
    }
    fetchTimer = setTimeout(() => {
      fetchTimer = null;
      state.page = 1;
      collectFilterValues();
      fetchTenders();
    }, immediate ? 0 : 250);
  }

  function updateStatus(message) {
    if (tenderStatus) {
      tenderStatus.textContent = message;
    }
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  function renderTable(results) {
    tableBody.innerHTML = '';
    if (!results.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.textContent = 'No tenders matched the selected filters.';
      row.appendChild(cell);
      tableBody.appendChild(row);
      return;
    }
    const fragment = document.createDocumentFragment();
    results.forEach(item => {
      const row = document.createElement('tr');

      const titleCell = document.createElement('td');
      const titleLink = document.createElement('a');
      titleLink.href = item.link || '#';
      titleLink.target = '_blank';
      titleLink.rel = 'noopener';
      titleLink.textContent = item.title || 'Untitled tender';
      titleCell.appendChild(titleLink);
      if (item.description) {
        const desc = document.createElement('div');
        desc.className = 'table-subtext';
        desc.textContent = item.description;
        titleCell.appendChild(desc);
      }

      const sourceCell = document.createElement('td');
      sourceCell.textContent = item.source || '';

      const scrapedCell = document.createElement('td');
      scrapedCell.textContent = formatDateTime(item.scrapedAt);

      const openCell = document.createElement('td');
      openCell.textContent = formatDate(item.openDate);

      const closeCell = document.createElement('td');
      closeCell.textContent = formatDate(item.closingDate);

      const valueCell = document.createElement('td');
      valueCell.textContent = item.value || '';

      const cpvCell = document.createElement('td');
      cpvCell.textContent = (item.cpvCodes || []).join(', ');

      const tagsCell = document.createElement('td');
      tagsCell.textContent = (item.tags || []).join(', ');

      row.append(titleCell, sourceCell, scrapedCell, openCell, closeCell, valueCell, cpvCell, tagsCell);
      fragment.appendChild(row);
    });
    tableBody.appendChild(fragment);
  }

  function updatePaginationControls() {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    pageInfo.textContent = `Page ${state.page} of ${totalPages}`;
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= totalPages;
  }

  async function fetchTenders() {
    updateStatus('Loading tenders…');
    const params = new URLSearchParams();
    params.set('page', String(state.page));
    params.set('pageSize', String(state.pageSize));
    if (state.query) params.set('q', state.query);
    if (state.sources.size) {
      state.sources.forEach(src => params.append('sources', src));
    }
    if (state.scrapedFrom) params.set('scrapedFrom', state.scrapedFrom);
    if (state.scrapedTo) params.set('scrapedTo', state.scrapedTo);
    if (state.openFrom) params.set('openFrom', state.openFrom);
    if (state.openTo) params.set('openTo', state.openTo);
    if (state.closeFrom) params.set('closeFrom', state.closeFrom);
    if (state.closeTo) params.set('closeTo', state.closeTo);
    if (state.cpv.size) {
      state.cpv.forEach((_, code) => params.append('cpv', code));
      params.set('cpvMode', state.cpvMode);
    }
    params.set('sort', state.sort);
    params.set('direction', state.direction);

    try {
      const response = await fetch(`/api/tenders?${params.toString()}`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const payload = await response.json();
      state.total = payload.total || 0;
      const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
      if (state.page > totalPages) {
        state.page = totalPages;
        updatePaginationControls();
        fetchTenders();
        return;
      }
      renderTable(payload.results || []);
      updatePaginationControls();
      if (payload.results && payload.results.length) {
        updateStatus(`Showing ${payload.results.length} tenders (of ${payload.total || 0}).`);
      } else {
        updateStatus('No tenders matched the selected filters.');
      }
    } catch (err) {
      console.error('Failed to load tenders', err);
      updateStatus('Unable to load tenders. Please review the filters or retry shortly.');
    }
  }

  function resetFilters() {
    if (searchInput) searchInput.value = '';
    [scrapedFromInput, scrapedToInput, openFromInput, openToInput, closeFromInput, closeToInput].forEach(input => {
      if (input) input.value = '';
    });
    if (sortField) sortField.value = 'scraped_at';
    if (sortDirection) sortDirection.value = 'desc';
    state.sources.clear();
    if (sourceContainer) {
      sourceContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });
    }
    state.cpv.clear();
    if (cpvModeInputs.length) {
      cpvModeInputs.forEach(input => {
        input.checked = input.value === 'or';
      });
    }
    renderSelectedCpv();
    scheduleFetch(true);
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      collectFilterValues();
      state.page = 1;
      fetchTenders();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', resetFilters);
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => scheduleFetch());
  }

  [
    scrapedFromInput,
    scrapedToInput,
    openFromInput,
    openToInput,
    closeFromInput,
    closeToInput
  ].forEach(input => {
    if (input) {
      input.addEventListener('change', () => scheduleFetch(true));
    }
  });

  if (sortField) {
    sortField.addEventListener('change', () => scheduleFetch(true));
  }

  if (sortDirection) {
    sortDirection.addEventListener('change', () => scheduleFetch(true));
  }

  prevBtn.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      collectFilterValues();
      fetchTenders();
    }
  });

  nextBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page < totalPages) {
      state.page += 1;
      collectFilterValues();
      fetchTenders();
    }
  });

  cpvModeInputs.forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) {
        state.cpvMode = input.value;
        scheduleFetch(true);
      }
    });
  });

  let suggestionTimer = null;
  let suggestionRequestId = 0;
  if (cpvSearchInput) {
    cpvSearchInput.addEventListener('input', () => {
      const query = cpvSearchInput.value.trim();
      if (suggestionTimer) clearTimeout(suggestionTimer);
      if (!query) {
        cpvSuggestions.innerHTML = '';
        return;
      }
      suggestionTimer = setTimeout(() => {
        loadCpvSuggestions(query);
      }, 250);
    });
  }

  async function loadCpvSuggestions(query) {
    const requestId = ++suggestionRequestId;
    cpvSuggestions.textContent = 'Searching CPV codes…';
    try {
      const params = new URLSearchParams({ search: query, limit: '10' });
      const response = await fetch(`/api/cpv-codes?${params.toString()}`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const payload = await response.json();
      if (requestId !== suggestionRequestId) {
        return;
      }
      cpvSuggestions.innerHTML = '';
      if (!payload.results || !payload.results.length) {
        cpvSuggestions.textContent = 'No matching CPV codes found.';
        return;
      }
      payload.results.forEach(result => {
        const button = document.createElement('button');
        button.type = 'button';
        const desc = result.description ? result.description : 'No description available';
        button.textContent = `${result.code} – ${desc}`;
        button.className = 'cpv-suggestion';
        button.addEventListener('click', () => {
          state.cpv.set(result.code, result.description || '');
          cpvSearchInput.value = '';
          cpvSuggestions.innerHTML = '';
          renderSelectedCpv();
          scheduleFetch(true);
        });
        cpvSuggestions.appendChild(button);
      });
    } catch (err) {
      console.error('Failed to load CPV suggestions', err);
      if (requestId !== suggestionRequestId) return;
      cpvSuggestions.textContent = 'Unable to load CPV suggestions.';
    }
  }

  renderSourceOptions();
  renderSelectedCpv();
  collectFilterValues();
  fetchTenders();
})();
