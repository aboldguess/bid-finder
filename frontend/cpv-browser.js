/*
 * File: cpv-browser.js
 * Overview: Client-side controller for the CPV explorer tab. Handles search
 *   requests against the CPV catalogue, renders paginated results and manages
 *   the user's account-backed favourites list.
 * Structure:
 *   - Initialises UI references and local state from window.__CPV_PREFILL__.
 *   - Provides debounced search logic with pagination.
 *   - Synchronises favourite selections with the authenticated favourites API.
 */
(function () {
  const prefill = window.__CPV_PREFILL__ || {};
  const favouritesList = document.getElementById('cpvFavouritesList');
  const favouritesEmpty = document.getElementById('cpvFavouritesEmpty');
  const resultsBody = document.getElementById('cpvResultsBody');
  const searchInput = document.getElementById('cpvSearchInput');
  const statusEl = document.getElementById('cpvSearchStatus');
  const pageInfo = document.getElementById('cpvPageInfo');
  const prevBtn = document.getElementById('cpvPrevPage');
  const nextBtn = document.getElementById('cpvNextPage');

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken =
    (window.__CSRF_TOKEN__ && window.__CSRF_TOKEN__.toString()) ||
    (csrfMeta ? csrfMeta.getAttribute('content') : '');

  const state = {
    page: 1,
    pageSize: 25,
    total: 0,
    query: ''
  };

  const favourites = new Map();
  (prefill.favourites || []).forEach(entry => {
    if (!entry || typeof entry.code !== 'string') return;
    const code = entry.code.trim();
    if (!/^[0-9]{8}$/.test(code)) return;
    favourites.set(code, entry.description || '');
  });

  function updateFavouritesUI() {
    favouritesList.innerHTML = '';
    if (!favourites.size) {
      favouritesEmpty.classList.remove('hidden');
      return;
    }
    favouritesEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    favourites.forEach((description, code) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${code}</strong> — ${description || 'No description available'}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove';
      button.classList.add('outline');
      button.addEventListener('click', () => modifyFavourite(code, description, false));
      li.appendChild(button);
      fragment.appendChild(li);
    });
    favouritesList.appendChild(fragment);
  }

  function renderResults(results) {
    resultsBody.innerHTML = '';
    if (!results.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.textContent = 'No CPV codes matched the current search terms.';
      row.appendChild(cell);
      resultsBody.appendChild(row);
      return;
    }
    const fragment = document.createDocumentFragment();
    results.forEach(result => {
      const row = document.createElement('tr');
      const codeCell = document.createElement('td');
      codeCell.textContent = result.code;
      const descCell = document.createElement('td');
      descCell.textContent = result.description || 'No description provided.';
      const favCell = document.createElement('td');
      const isFav = favourites.has(result.code);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = isFav ? '★ Remove' : '☆ Favourite';
      button.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      button.addEventListener('click', () => modifyFavourite(result.code, result.description, !isFav));
      favCell.appendChild(button);
      row.append(codeCell, descCell, favCell);
      fragment.appendChild(row);
    });
    resultsBody.appendChild(fragment);
  }

  function updateStatus(message) {
    statusEl.textContent = message;
  }

  function updatePagination() {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    pageInfo.textContent = `Page ${state.page} of ${totalPages}`;
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= totalPages;
  }

  async function loadFavourites() {
    try {
      const response = await fetch('/api/cpv-favourites', {
        headers: {
          Accept: 'application/json'
        }
      });
      if (response.status === 401) {
        updateStatus('Please sign back in to view your saved CPV favourites.');
        return;
      }
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const payload = await response.json();
      if (Array.isArray(payload.favourites)) {
        favourites.clear();
        payload.favourites.forEach(entry => {
          if (!entry || typeof entry.code !== 'string') return;
          const code = entry.code.trim();
          if (!/^[0-9]{8}$/.test(code)) return;
          favourites.set(code, entry.description || '');
        });
        updateFavouritesUI();
      }
    } catch (err) {
      console.error('Failed to load CPV favourites', err);
      updateStatus('Unable to load favourites from the server.');
    }
  }

  let searchTimer = null;
  let latestSearchId = 0;

  async function performSearch() {
    const requestId = ++latestSearchId;
    const params = new URLSearchParams({
      search: state.query,
      page: String(state.page),
      limit: String(state.pageSize)
    });
    updateStatus('Searching the CPV catalogue…');
    try {
      const response = await fetch(`/api/cpv-codes?${params.toString()}`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const payload = await response.json();
      if (requestId !== latestSearchId) {
        return;
      }
      state.total = payload.total || 0;
      const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
      if (state.page > totalPages) {
        state.page = totalPages;
        updatePagination();
        performSearch();
        return;
      }
      renderResults(payload.results || []);
      updatePagination();
      if (payload.results && payload.results.length) {
        updateStatus(`Displaying ${payload.results.length} codes (of ${payload.total || 0}).`);
      } else {
        updateStatus('No CPV entries matched the current search.');
      }
    } catch (err) {
      console.error('CPV search failed', err);
      if (requestId !== latestSearchId) return;
      updateStatus('Unable to query the CPV catalogue. Please try again shortly.');
    }
  }

  async function modifyFavourite(code, description, shouldAdd) {
    if (!csrfToken) {
      updateStatus('Security token missing. Please refresh the page and try again.');
      return;
    }
    try {
      const payload = {
        code,
        action: shouldAdd ? 'add' : 'remove'
      };
      if (shouldAdd) {
        payload.description = description || '';
      }
      const response = await fetch('/api/cpv-favourites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'CSRF-Token': csrfToken
        },
        body: JSON.stringify(payload)
      });
      if (response.status === 401) {
        updateStatus('Your session has expired. Sign in again to manage favourites.');
        return;
      }
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || `Server responded with ${response.status}`);
      }
      favourites.clear();
      (json.favourites || []).forEach(entry => {
        if (!entry || typeof entry.code !== 'string') return;
        const favCode = entry.code.trim();
        if (!/^[0-9]{8}$/.test(favCode)) return;
        favourites.set(favCode, entry.description || '');
      });
      updateFavouritesUI();
      performSearch();
    } catch (err) {
      console.error('Failed to update favourite state', err);
      updateStatus(err.message || 'Unable to update favourites.');
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (searchTimer) {
        clearTimeout(searchTimer);
      }
      searchTimer = setTimeout(() => {
        state.page = 1;
        state.query = searchInput.value.trim();
        performSearch();
      }, 250);
    });
  }

  prevBtn.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      performSearch();
    }
  });

  nextBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page < totalPages) {
      state.page += 1;
      performSearch();
    }
  });

  updateFavouritesUI();
  loadFavourites().then(() => performSearch());
})();
