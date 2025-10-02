/**
 * @file admin-tools.js
 * @description Client-side controller for the administration console. Handles
 *   destructive database actions, dynamic statistics refreshes, cron schedule
 *   management, feed source configuration and user management operations with
 *   friendly status updates and confirmation dialogues.
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const dataEl = document.getElementById('adminData');
  let initial = {};
  try {
    initial = dataEl ? JSON.parse(dataEl.textContent) : {};
  } catch (err) {
    console.error('Failed to parse initial admin data payload', err);
  }

  const state = {
    counts: Object.assign(
      {
        tenders: 0,
        awards: 0,
        customers: 0,
        suppliers: 0,
        totalSources: 0,
        totalAwardSources: 0,
        users: 0
      },
      initial.counts || {}
    ),
    lastScraped: initial.lastScraped || null,
    tenderBreakdown: initial.tenderBreakdown || [],
    users: (initial.users || []).map(user => ({
      id: user.id,
      username: user.username,
      isAdmin: Boolean(user.isAdmin)
    })),
    adminUsersConfigured: Boolean(initial.adminUsersConfigured),
    adminUsernames: initial.adminUsernames || [],
    currentUser: initial.currentUser || null,
    sources: Object.assign({}, initial.sources || {}),
    awardSources: Object.assign({}, initial.awardSources || {}),
    sourceStats: Object.assign({}, initial.sourceStats || {}),
    sourceStatus: Object.assign({}, initial.sourceStatus || {}),
    parserCatalogue: Array.isArray(initial.parserCatalogue)
      ? initial.parserCatalogue.map(option => ({ ...option }))
      : [],
    defaultParser: initial.defaultParser || 'contractsFinder',
    cron: typeof initial.cron === 'string' ? initial.cron : '0 6 * * *',
    editing: {
      tender: null,
      award: null
    }
  };
  state.counts.users = state.users.length;
  Object.keys(state.sources || {}).forEach(key => {
    if (!state.sourceStatus[key]) {
      state.sourceStatus[key] = 'unknown';
    }
  });
  Object.keys(state.awardSources || {}).forEach(key => {
    if (!state.sourceStatus[key]) {
      state.sourceStatus[key] = 'unknown';
    }
  });

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.content : '';
  const dbStatus = document.getElementById('dbStatus');
  const userStatus = document.getElementById('userStatus');
  const cronStatus = document.getElementById('cronStatus');
  const tenderBody = document.getElementById('tenderBreakdownBody');
  const userBody = document.getElementById('userTableBody');
  const lastScrapedEl = document.getElementById('lastScraped');
  const wipeButton = document.getElementById('wipeDatabase');
  const refreshButton = document.getElementById('refreshBreakdown');
  const createForm = document.getElementById('createUserForm');
  const confirmDialog = document.getElementById('confirmWipeDialog');
  const confirmForm = document.getElementById('confirmWipeForm');
  const passwordDialog = document.getElementById('passwordDialog');
  const passwordForm = document.getElementById('passwordForm');
  const passwordUserId = document.getElementById('passwordUserId');
  const passwordInput = document.getElementById('passwordInput');
  const passwordConfirmInput = document.getElementById('passwordConfirmInput');
  const tenderSourceBody = document.getElementById('tenderSourceTableBody');
  const awardSourceBody = document.getElementById('awardSourceTableBody');
  const tenderSourceBanner = document.getElementById('tenderSourceStatus');
  const awardSourceBanner = document.getElementById('awardSourceStatus');
  const tenderSourceForm = document.getElementById('tenderSourceForm');
  const awardSourceForm = document.getElementById('awardSourceForm');
  const cronForm = document.getElementById('cronForm');
  const cronPreview = document.getElementById('cronPreview');
  const previewDialog = document.getElementById('sourcePreviewDialog');
  const previewBody = document.getElementById('sourcePreviewBody');
  const previewSummary = document.getElementById('sourcePreviewSummary');
  const cancelEditButtons = Array.from(document.querySelectorAll('[data-action="cancel-edit"]'));
  const cronControls = cronForm
    ? {
        minute: document.getElementById('cronMin'),
        hour: document.getElementById('cronHour'),
        day: document.getElementById('cronDom'),
        month: document.getElementById('cronMon'),
        weekday: document.getElementById('cronDow')
      }
    : null;
  const formControls = {
    tender: tenderSourceForm
      ? {
          form: tenderSourceForm,
          inputs: {
            key: tenderSourceForm.querySelector('input[name="key"]'),
            label: tenderSourceForm.querySelector('input[name="label"]'),
            url: tenderSourceForm.querySelector('input[name="url"]'),
            base: tenderSourceForm.querySelector('input[name="base"]'),
            parser: tenderSourceForm.querySelector('[name="parser"]')
          },
          submit: tenderSourceForm.querySelector('button[type="submit"]'),
          cancel: tenderSourceForm.querySelector('[data-action="cancel-edit"]')
        }
      : null,
    award: awardSourceForm
      ? {
          form: awardSourceForm,
          inputs: {
            key: awardSourceForm.querySelector('input[name="key"]'),
            label: awardSourceForm.querySelector('input[name="label"]'),
            url: awardSourceForm.querySelector('input[name="url"]'),
            base: awardSourceForm.querySelector('input[name="base"]'),
            parser: awardSourceForm.querySelector('[name="parser"]')
          },
          submit: awardSourceForm.querySelector('button[type="submit"]'),
          cancel: awardSourceForm.querySelector('[data-action="cancel-edit"]')
        }
      : null
  };
  const tableBodies = { tender: tenderSourceBody, award: awardSourceBody };
  const sourceBanners = { tender: tenderSourceBanner, award: awardSourceBanner };
  const defaultParserKey = state.defaultParser || 'contractsFinder';
  const parserLookup = Array.isArray(state.parserCatalogue)
    ? state.parserCatalogue.reduce((acc, option) => {
        if (option && option.key) {
          acc[option.key] = option.label || option.key;
        }
        return acc;
      }, {})
    : {};
  const defaultParser = {
    tender:
      formControls.tender && formControls.tender.inputs.parser
        ? formControls.tender.inputs.parser.value || defaultParserKey
        : defaultParserKey,
    award:
      formControls.award && formControls.award.inputs.parser
        ? formControls.award.inputs.parser.value || defaultParserKey
        : defaultParserKey
  };
  const apiRoutes = { tender: '/sources', award: '/award-sources' };
  const testRoutes = { tender: '/test-source', award: '/test-award-source' };
  const scrapeRoutes = { tender: '/scrape-stream', award: '/scrape-awarded-stream' };

  /**
   * Display a status message within the supplied banner element.
   *
   * @param {HTMLElement} el - Target banner element
   * @param {string} message - Human friendly message
   * @param {'info'|'success'|'error'} type - Visual style to apply
   */
  function announce(el, message, type = 'info') {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('info', 'success', 'error');
    el.classList.add(type);
    el.hidden = false;
  }

  /** Hide the supplied status banner. */
  function hideStatus(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  /**
   * Populate a select element with the supplied cron values.
   *
   * @param {HTMLSelectElement|null} select - Target select element.
   * @param {Array<{value: string, label: string}>} values - Options to insert.
   */
  function populateCronSelect(select, values) {
    if (!select) return;
    select.innerHTML = '';
    values.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
  }

  /** Ensure the select contains a given value, adding a synthetic option if required. */
  function ensureCronValue(select, value) {
    if (!select || typeof value !== 'string' || !value) return;
    const exists = Array.from(select.options).some(opt => opt.value === value);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = `${value} (custom)`;
      opt.dataset.custom = 'true';
      select.appendChild(opt);
    }
    select.value = value;
  }

  /**
   * Parse a cron expression into its five constituent parts.
   *
   * @param {string} expr - Cron expression.
   * @returns {string[]} Array of five string segments.
   */
  function parseCron(expr) {
    const fallback = ['0', '6', '*', '*', '*'];
    if (typeof expr !== 'string') return fallback;
    const parts = expr.trim().split(/\s+/);
    return parts.length === 5 ? parts : fallback;
  }

  /** Build a cron string from the current dropdown selections. */
  function buildCronExpression() {
    if (!cronControls) return state.cron;
    const sequence = [
      cronControls.minute,
      cronControls.hour,
      cronControls.day,
      cronControls.month,
      cronControls.weekday
    ];
    return sequence
      .map(sel => (sel ? sel.value : '*'))
      .join(' ');
  }

  /** Update the on-screen preview with the selected cron expression. */
  function updateCronPreview() {
    const expr = buildCronExpression();
    if (cronPreview) {
      cronPreview.textContent = `Current expression: ${expr}`;
    }
    return expr;
  }

  /**
   * Create a sequential range of cron options.
   * @param {number} start - Starting integer (inclusive).
   * @param {number} end - Ending integer (inclusive).
   * @param {function(number): string} labelBuilder - Optional label formatter.
   * @param {string} wildcardLabel - Label for the wildcard option.
   * @returns {Array<{value: string, label: string}>}
   */
  function createCronOptions(start, end, labelBuilder, wildcardLabel) {
    const options = [{ value: '*', label: wildcardLabel }];
    for (let i = start; i <= end; i++) {
      const label = labelBuilder ? labelBuilder(i) : String(i);
      options.push({ value: String(i), label });
    }
    return options;
  }

  /** Initialise the cron schedule form when present on the page. */
  function initialiseCronSchedule() {
    if (!cronForm || !cronControls) return;

    const minuteOptions = createCronOptions(0, 59, i => i.toString().padStart(2, '0'), 'Every minute (*)');
    const hourOptions = createCronOptions(0, 23, i => i.toString().padStart(2, '0'), 'Every hour (*)');
    const dayOptions = createCronOptions(1, 31, i => String(i), 'Every day (*)');
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ];
    const monthOptions = [
      { value: '*', label: 'Every month (*)' },
      ...monthNames.map((name, index) => ({ value: String(index + 1), label: `${name} (${index + 1})` }))
    ];
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdayOptions = [
      { value: '*', label: 'Every weekday (*)' },
      ...weekdayNames.map((name, index) => ({ value: String(index), label: `${name} (${index})` }))
    ];

    populateCronSelect(cronControls.minute, minuteOptions);
    populateCronSelect(cronControls.hour, hourOptions);
    populateCronSelect(cronControls.day, dayOptions);
    populateCronSelect(cronControls.month, monthOptions);
    populateCronSelect(cronControls.weekday, weekdayOptions);

    const parts = parseCron(state.cron);
    ensureCronValue(cronControls.minute, parts[0]);
    ensureCronValue(cronControls.hour, parts[1]);
    ensureCronValue(cronControls.day, parts[2]);
    ensureCronValue(cronControls.month, parts[3]);
    ensureCronValue(cronControls.weekday, parts[4]);
    updateCronPreview();

    Object.values(cronControls).forEach(select => {
      if (!select) return;
      select.addEventListener('change', () => {
        hideStatus(cronStatus);
        updateCronPreview();
      });
    });

    cronForm.addEventListener('submit', async event => {
      event.preventDefault();
      const schedule = updateCronPreview();
      try {
        announce(cronStatus, 'Updating schedule…', 'info');
        const res = await fetch('/admin/cron', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'CSRF-Token': csrfToken
          },
          body: JSON.stringify({ schedule })
        });

        if (res.status === 401) {
          announce(cronStatus, 'Session expired. Please log in again.', 'error');
          window.location.assign('/login');
          return;
        }

        const data = await res.json().catch(() => null);
        if (res.ok && data && data.success) {
          state.cron = schedule;
          announce(cronStatus, 'Schedule updated successfully.', 'success');
        } else {
          const message = (data && data.error) || 'Failed to update schedule.';
          announce(cronStatus, message, 'error');
        }
      } catch (err) {
        console.error('Failed to update cron schedule', err);
        announce(cronStatus, 'Unexpected error while updating schedule. Check logs for details.', 'error');
      }
    });
  }

  /** Update the numeric stat cards from the current state. */
  function updateStatCards() {
    const entries = [
      ['statTenders', state.counts.tenders],
      ['statAwards', state.counts.awards],
      ['statCustomers', state.counts.customers],
      ['statSuppliers', state.counts.suppliers],
      ['statSources', state.counts.totalSources],
      ['statAwardSources', state.counts.totalAwardSources],
      ['statUsers', state.counts.users]
    ];
    entries.forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = typeof value === 'number' ? value : '0';
    });
    if (lastScrapedEl) {
      const val = state.lastScraped || lastScrapedEl.dataset.empty;
      lastScrapedEl.textContent = val;
    }
  }

  /** Render the tender breakdown table using state.tenderBreakdown. */
  function renderTenderBreakdown() {
    if (!tenderBody) return;
    tenderBody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    if (!state.tenderBreakdown.length) {
      const row = document.createElement('tr');
      row.className = 'table-empty';
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.textContent = 'No tenders stored yet.';
      row.appendChild(cell);
      fragment.appendChild(row);
    } else {
      state.tenderBreakdown.forEach(entry => {
        const row = document.createElement('tr');
        const source = document.createElement('td');
        source.textContent = entry.source;
        const count = document.createElement('td');
        count.textContent = entry.count;
        row.append(source, count);
        fragment.appendChild(row);
      });
    }
    tenderBody.appendChild(fragment);
  }

  /** Render the user table from the current state. */
  function renderUsers() {
    if (!userBody) return;
    userBody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    if (!state.users.length) {
      const row = document.createElement('tr');
      row.className = 'table-empty';
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.textContent = 'No users registered.';
      row.appendChild(cell);
      fragment.appendChild(row);
    } else {
      const current = state.currentUser ? state.currentUser.toLowerCase() : null;
      state.users
        .slice()
        .sort((a, b) => a.username.localeCompare(b.username))
        .forEach(account => {
          const row = document.createElement('tr');
          row.dataset.userId = account.id;

          const nameCell = document.createElement('td');
          const nameSpan = document.createElement('span');
          nameSpan.className = 'username-cell';
          nameSpan.textContent = account.username;
          nameCell.appendChild(nameSpan);

          const roleCell = document.createElement('td');
          const badge = document.createElement('span');
          badge.className = `badge ${account.isAdmin ? 'badge-admin' : 'badge-user'}`;
          badge.textContent = account.isAdmin ? 'Administrator' : 'Standard';
          roleCell.appendChild(badge);

          const actionCell = document.createElement('td');
          const resetBtn = document.createElement('button');
          resetBtn.type = 'button';
          resetBtn.className = 'secondary reset-password';
          resetBtn.textContent = 'Reset password';
          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'danger delete-user';
          deleteBtn.textContent = 'Delete';

          const isSelf = current && account.username.toLowerCase() === current;
          if (isSelf) {
            deleteBtn.disabled = true;
            deleteBtn.title = 'You cannot delete the account currently in use';
          }

          actionCell.append(resetBtn, deleteBtn);
          row.append(nameCell, roleCell, actionCell);
          fragment.appendChild(row);
        });
    }
    userBody.appendChild(fragment);
  }

  function getSourceCollection(kind) {
    return kind === 'tender' ? state.sources : state.awardSources;
  }

  function normaliseStatus(value) {
    switch (value) {
      case 'ok':
        return 'Healthy';
      case 'error':
        return 'Error';
      case 'running':
        return 'Running…';
      case 'unknown':
      default:
        return 'Unknown';
    }
  }

  function formatTimestamp(value) {
    if (!value) return 'Never';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
      return value;
    }
    const date = dt.toLocaleDateString();
    const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  }

  function highlightSourceRow(kind, key) {
    const body = tableBodies[kind];
    if (!body) return;
    body.querySelectorAll('tr').forEach(row => row.classList.remove('editing-row'));
    if (!key) return;
    const row = body.querySelector(`tr[data-key="${key}"]`);
    if (row) row.classList.add('editing-row');
  }

  function renderSourceTable(kind) {
    const body = tableBodies[kind];
    if (!body) return;
    body.innerHTML = '';
    const entries = Object.entries(getSourceCollection(kind));
    if (!entries.length) {
      const empty = document.createElement('tr');
      empty.className = 'table-empty';
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = 'No sources configured yet.';
      empty.appendChild(cell);
      body.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    entries
      .slice()
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([key, src]) => {
        const stats = state.sourceStats[key] || {};
        const row = document.createElement('tr');
        row.dataset.key = key;
        row.dataset.kind = kind;
        if (state.editing[kind] === key) {
          row.classList.add('editing-row');
        }

        const keyCell = document.createElement('td');
        keyCell.textContent = key;

        const labelCell = document.createElement('td');
        const labelTitle = document.createElement('div');
        labelTitle.className = 'source-label';
        labelTitle.textContent = src && src.label ? src.label : key;
        labelCell.appendChild(labelTitle);
        const metaBits = [];
        if (src && src.base) metaBits.push(src.base);
        if (src && src.parser) {
          const label = parserLookup[src.parser];
          const parserMeta =
            label && label !== src.parser
              ? `Parser: ${src.parser} (${label})`
              : `Parser: ${src.parser}`;
          metaBits.push(parserMeta);
        }
        if (metaBits.length) {
          const meta = document.createElement('div');
          meta.className = 'source-meta';
          meta.textContent = metaBits.join(' · ');
          labelCell.appendChild(meta);
        }

        const statusCell = document.createElement('td');
        statusCell.className = 'source-status';
        statusCell.textContent = normaliseStatus(state.sourceStatus[key]);

        const lastScrapedCell = document.createElement('td');
        lastScrapedCell.textContent = formatTimestamp(stats.last_scraped);

        const lastAddedCell = document.createElement('td');
        const lastAdded = typeof stats.last_added === 'number' ? stats.last_added : 0;
        lastAddedCell.textContent = lastAdded;

        const totalCell = document.createElement('td');
        const total = typeof stats.total === 'number' ? stats.total : 0;
        totalCell.textContent = total;

        const actions = document.createElement('td');
        actions.className = 'source-actions';
        const scrapeBtn = document.createElement('button');
        scrapeBtn.type = 'button';
        scrapeBtn.className = 'scrape-now source-scrape';
        scrapeBtn.textContent = 'Scrape now';
        scrapeBtn.addEventListener('click', () => triggerSourceScrape(kind, key));

        const testBtn = document.createElement('button');
        testBtn.type = 'button';
        testBtn.className = 'secondary source-test';
        testBtn.textContent = 'Test feed';
        testBtn.addEventListener('click', () => testSource(kind, key));

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'secondary source-edit';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => beginSourceEdit(kind, key));

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'danger source-delete';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => confirmDeleteSource(kind, key));

        actions.append(scrapeBtn, testBtn, editBtn, deleteBtn);

        row.append(keyCell, labelCell, statusCell, lastScrapedCell, lastAddedCell, totalCell, actions);
        fragment.appendChild(row);
      });
    body.appendChild(fragment);
  }

  function renderSources() {
    renderSourceTable('tender');
    renderSourceTable('award');
  }

  /** Disable or enable all action buttons within a source table row. */
  function setRowDisabled(row, disabled) {
    if (!row) return;
    row.querySelectorAll('button').forEach(btn => {
      btn.disabled = disabled;
    });
  }

  /**
   * Fetch the latest scraping statistics from the server and re-render both
   * tender and award tables so timestamps stay current after a manual run.
   *
   * @returns {Promise<void>}
   */
  async function refreshSourceStatsData() {
    const res = await fetch('/admin/source-stats', {
      headers: { Accept: 'application/json' }
    });
    if (res.status === 401) {
      redirectToLogin();
      throw new Error('Session expired');
    }
    if (res.status === 403) {
      throw new Error('Administrator access required to refresh source statistics.');
    }
    if (!res.ok) {
      throw new Error(`Failed to refresh source statistics (status ${res.status})`);
    }
    const rows = await res.json();
    const next = {};
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (row && row.key) {
        next[row.key] = row;
      }
    });
    state.sourceStats = next;
    renderSourceTable('tender');
    renderSourceTable('award');
  }

  /**
   * Trigger a live scrape for a single source via the SSE endpoint so
   * administrators can debug a feed without touching others.
   *
   * @param {'tender'|'award'} kind - Source type.
   * @param {string} key - Source identifier.
   */
  function triggerSourceScrape(kind, key) {
    const route = scrapeRoutes[kind];
    if (!route) return;
    const banner = sourceBanners[kind];
    const collection = getSourceCollection(kind);
    const source = collection[key] || {};
    const label = source.label || key;
    const row = tableBodies[kind]
      ? tableBodies[kind].querySelector(`tr[data-key="${key}"]`)
      : null;
    const statusCell = row ? row.querySelector('.source-status') : null;

    hideStatus(banner);
    announce(banner, `Scraping ${label}…`, 'info');
    state.sourceStatus[key] = 'running';
    if (statusCell) statusCell.textContent = 'Running…';
    setRowDisabled(row, true);

    const url = new URL(route, window.location.origin);
    url.searchParams.set('source', key);
    const es = new EventSource(url.toString());

    es.onmessage = evt => {
      let payload;
      try {
        payload = JSON.parse(evt.data);
      } catch (err) {
        console.error('Invalid payload from scrape stream', err);
        return;
      }

      if (payload.step === 'tender' && payload.total) {
        const total = Number(payload.total) || 0;
        const index = Number(payload.index) || 0;
        if (statusCell) {
          statusCell.textContent = total
            ? `Processing ${index}/${total}`
            : 'Processing feed…';
        }
      }

      if (payload.done) {
        es.close();
        setRowDisabled(row, false);

        if (payload.error) {
          state.sourceStatus[key] = 'error';
          if (statusCell) statusCell.textContent = 'Error';
          announce(
            banner,
            `Scrape failed for ${label}: ${payload.error}`,
            'error'
          );
          return;
        }

        state.sourceStatus[key] = 'ok';
        if (statusCell) statusCell.textContent = 'Refreshing statistics…';
        const noun = kind === 'award' ? 'awards' : 'tenders';
        const added = Number(payload.added) || 0;
        const successMessage =
          added > 0
            ? `Scrape completed. Added ${added} new ${noun}.`
            : `Scrape completed. No new ${noun} were stored.`;

        refreshSourceStatsData()
          .then(() => {
            announce(banner, successMessage, 'success');
          })
          .catch(err => {
            console.error('Unable to refresh source statistics', err);
            announce(
              banner,
              `${successMessage} Statistics refresh failed; check connectivity.`,
              'info'
            );
          });
      }
    };

    es.onerror = err => {
      console.error('Stream error while scraping source', err);
      es.close();
      setRowDisabled(row, false);
      state.sourceStatus[key] = 'error';
      if (statusCell) statusCell.textContent = 'Error';
      announce(
        banner,
        `Connection lost while scraping ${label}. Check server logs for details.`,
        'error'
      );
    };
  }

  function resetSourceForm(kind, focus = false) {
    const control = formControls[kind];
    if (!control) return;
    control.form.reset();
    control.inputs.key.disabled = false;
    if (control.inputs.parser) {
      control.inputs.parser.value = defaultParser[kind];
    }
    control.submit.textContent = kind === 'tender' ? 'Add source' : 'Add award source';
    if (control.cancel) {
      control.cancel.hidden = true;
    }
    state.editing[kind] = null;
    highlightSourceRow(kind, null);
    if (focus) {
      control.inputs.key.focus();
    }
  }

  function beginSourceEdit(kind, key) {
    const control = formControls[kind];
    const collection = getSourceCollection(kind);
    const data = collection[key];
    if (!control || !data) return;
    control.inputs.key.value = key;
    control.inputs.key.disabled = true;
    control.inputs.label.value = data.label || '';
    control.inputs.url.value = data.url || '';
    control.inputs.base.value = data.base || '';
    if (control.inputs.parser) {
      control.inputs.parser.value = data.parser || defaultParser[kind];
    }
    control.submit.textContent = kind === 'tender' ? 'Update source' : 'Update award source';
    if (control.cancel) {
      control.cancel.hidden = false;
    }
    state.editing[kind] = key;
    highlightSourceRow(kind, key);
    hideStatus(sourceBanners[kind]);
  }

  function confirmDeleteSource(kind, key) {
    const collection = getSourceCollection(kind);
    const label = collection[key] && collection[key].label ? collection[key].label : key;
    const typeLabel = kind === 'tender' ? 'tender' : 'award';
    const confirmed = window.confirm(`Delete ${typeLabel} source "${label}"? This cannot be undone.`);
    if (!confirmed) return;
    deleteSource(kind, key);
  }

  function updateSourceCount(kind, delta) {
    if (kind === 'tender') {
      state.counts.totalSources = Math.max(0, (state.counts.totalSources || 0) + delta);
    } else {
      state.counts.totalAwardSources = Math.max(0, (state.counts.totalAwardSources || 0) + delta);
    }
    updateStatCards();
  }

  function setRowStatus(kind, key, status) {
    state.sourceStatus[key] = status;
    const body = tableBodies[kind];
    if (!body) return;
    const row = body.querySelector(`tr[data-key="${key}"]`);
    if (!row) return;
    const statusCell = row.querySelector('.source-status');
    if (statusCell) {
      statusCell.textContent = normaliseStatus(status);
    }
  }

  function openSourcePreview(kind, key, latest, count = 0) {
    if (!previewDialog || !previewBody || !previewSummary) return;
    previewBody.innerHTML = '';
    const collection = getSourceCollection(kind);
    const label = collection[key] && collection[key].label ? collection[key].label : key;
    const typeLabel = kind === 'tender' ? 'tender' : 'award';
    if (count > 0) {
      previewSummary.textContent = `Showing the newest ${typeLabel} entry from ${label}.`;
    } else {
      previewSummary.textContent = `No entries were returned for ${label}. Double-check the feed URL and try again.`;
    }

    if (!latest) {
      const message = document.createElement('p');
      message.textContent = 'No preview was available from that feed.';
      previewBody.appendChild(message);
    } else {
      const title = document.createElement('h4');
      title.textContent = latest.title || 'Untitled entry';
      previewBody.appendChild(title);

      if (latest.date) {
        const date = document.createElement('p');
        date.className = 'preview-date';
        date.textContent = formatTimestamp(latest.date);
        previewBody.appendChild(date);
      }

      if (latest.link) {
        const linkPara = document.createElement('p');
        const link = document.createElement('a');
        let resolvedLink = latest.link;
        const baseUrl = collection[key] && collection[key].base;
        try {
          resolvedLink = new URL(latest.link, baseUrl || window.location.origin).href;
        } catch (err) {
          resolvedLink = latest.link;
        }
        link.href = resolvedLink;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = resolvedLink;
        linkPara.appendChild(link);
        previewBody.appendChild(linkPara);
      }

      if (latest.desc) {
        const desc = document.createElement('p');
        desc.textContent = latest.desc.replace(/\s+/g, ' ').trim();
        previewBody.appendChild(desc);
      }
    }

    try {
      previewDialog.showModal();
    } catch (err) {
      console.warn('Browser does not support showModal; falling back to open attribute', err);
      previewDialog.setAttribute('open', 'open');
    }
  }

  async function testSource(kind, key) {
    const collection = getSourceCollection(kind);
    const label = collection[key] && collection[key].label ? collection[key].label : key;
    const banner = sourceBanners[kind];
    hideStatus(banner);
    setRowStatus(kind, key, 'testing…');
    announce(banner, `Testing ${kind === 'tender' ? 'tender' : 'award'} source ${label}…`, 'info');
    try {
      const res = await fetch(`${testRoutes[kind]}?key=${encodeURIComponent(key)}`, {
        headers: { Accept: 'application/json' }
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (res.status === 403) {
        announce(banner, 'Administrator access required to test feeds.', 'error');
        setRowStatus(kind, key, 'forbidden');
        return;
      }
      if (!res.ok || !data) {
        const message = (data && (data.error || data.message)) || 'Feed test failed.';
        announce(banner, message, 'error');
        setRowStatus(kind, key, 'error');
        return;
      }
      const status = data.status || 'ok';
      const count = typeof data.count === 'number' ? data.count : 0;
      setRowStatus(kind, key, status);
      announce(
        banner,
        count
          ? `Feed responded successfully with ${count} entr${count === 1 ? 'y' : 'ies'}. Preview opened below.`
          : 'Feed responded successfully but returned no entries.',
        status === 'ok' ? 'success' : 'info'
      );
      openSourcePreview(kind, key, data.latest || null, count);
    } catch (err) {
      console.error('Failed to test source', err);
      announce(banner, 'Unexpected error testing source. See console for details.', 'error');
      setRowStatus(kind, key, 'error');
    }
  }

  async function handleSourceSubmit(kind, evt) {
    evt.preventDefault();
    const control = formControls[kind];
    if (!control) return;
    hideStatus(sourceBanners[kind]);
    const keyInput = control.inputs.key.value.trim();
    const label = control.inputs.label.value.trim();
    const url = control.inputs.url.value.trim();
    const base = control.inputs.base.value.trim();
    const parser = control.inputs.parser
      ? control.inputs.parser.value.trim() || defaultParser[kind]
      : defaultParser[kind];

    if (!keyInput || !label || !url || !base) {
      announce(sourceBanners[kind], 'Please complete every field before saving the feed.', 'info');
      return;
    }

    const payload = { key: keyInput, label, url, base, parser };
    const isUpdate = Boolean(state.editing[kind]);
    const endpointKey = isUpdate ? state.editing[kind] : keyInput;
    const endpoint = isUpdate
      ? `${apiRoutes[kind]}/${encodeURIComponent(endpointKey)}`
      : apiRoutes[kind];
    const method = isUpdate ? 'PUT' : 'POST';
    const typeLabel = kind === 'tender' ? 'tender' : 'award';

    announce(
      sourceBanners[kind],
      `${isUpdate ? 'Updating' : 'Creating'} ${typeLabel} source ${label}…`,
      'info'
    );

    try {
      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'CSRF-Token': csrfToken
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (res.status === 403) {
        announce(sourceBanners[kind], 'Administrator access required to modify feeds.', 'error');
        return;
      }
      if (!res.ok || !data || !data.success) {
        const message = (data && data.error) || 'Failed to save feed configuration.';
        announce(sourceBanners[kind], message, 'error');
        return;
      }

      const saved = data.source || payload;
      const collection = getSourceCollection(kind);
      collection[saved.key] = {
        label: saved.label,
        url: saved.url,
        base: saved.base,
        parser: saved.parser
      };
      state.sourceStatus[saved.key] = 'unknown';
      if (!state.sourceStats[saved.key]) {
        state.sourceStats[saved.key] = { last_scraped: null, last_added: 0, total: 0 };
      }
      if (!isUpdate) {
        updateSourceCount(kind, 1);
      }
      renderSourceTable(kind);
      resetSourceForm(kind, true);
      announce(
        sourceBanners[kind],
        `${isUpdate ? 'Updated' : 'Added'} ${typeLabel} source ${saved.label || saved.key}.`,
        'success'
      );
    } catch (err) {
      console.error('Failed to save source', err);
      announce(sourceBanners[kind], 'Unexpected error saving feed configuration.', 'error');
    }
  }

  async function deleteSource(kind, key) {
    const collection = getSourceCollection(kind);
    const label = collection[key] && collection[key].label ? collection[key].label : key;
    const banner = sourceBanners[kind];
    hideStatus(banner);
    announce(banner, `Deleting ${kind === 'tender' ? 'tender' : 'award'} source ${label}…`, 'info');
    try {
      const res = await fetch(`${apiRoutes[kind]}/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json', 'CSRF-Token': csrfToken }
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (res.status === 403) {
        announce(banner, 'Administrator access required to delete feeds.', 'error');
        return;
      }
      if (!res.ok || !data || !data.success) {
        const message = (data && data.error) || 'Failed to delete feed configuration.';
        announce(banner, message, 'error');
        return;
      }
      delete collection[key];
      delete state.sourceStatus[key];
      delete state.sourceStats[key];
      if (state.editing[kind] === key) {
        resetSourceForm(kind, false);
      }
      updateSourceCount(kind, -1);
      renderSourceTable(kind);
      announce(banner, `${label} removed.`, 'success');
    } catch (err) {
      console.error('Failed to delete source', err);
      announce(banner, 'Unexpected error deleting feed configuration.', 'error');
    }
  }

  initialiseCronSchedule();
  updateStatCards();
  renderTenderBreakdown();
  renderUsers();
  renderSources();

  if (formControls.tender) {
    formControls.tender.form.addEventListener('submit', evt => handleSourceSubmit('tender', evt));
  }
  if (formControls.award) {
    formControls.award.form.addEventListener('submit', evt => handleSourceSubmit('award', evt));
  }
  cancelEditButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.kind === 'award' ? 'award' : 'tender';
      resetSourceForm(kind, true);
    });
  });

  function redirectToLogin() {
    window.location.href = '/login';
  }

  async function performWipe() {
    hideStatus(dbStatus);
    announce(dbStatus, 'Clearing stored data…', 'info');
    console.info('Administrator triggered full database wipe');
    try {
      const res = await fetch('/admin/delete-all', {
        method: 'POST',
        headers: { Accept: 'application/json', 'CSRF-Token': csrfToken }
      });
      const body = await res.json().catch(() => null);
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (res.status === 403) {
        announce(dbStatus, 'Administrator access required to wipe the database.', 'error');
        return;
      }
      if (!res.ok || !body || !body.success) {
        announce(dbStatus, 'Failed to wipe stored data. Check server logs for details.', 'error');
        return;
      }
      const summary = body.summary || {};
      state.counts.tenders = 0;
      state.counts.awards = 0;
      state.counts.customers = 0;
      state.counts.suppliers = 0;
      state.tenderBreakdown = [];
      state.lastScraped = null;
      updateStatCards();
      renderTenderBreakdown();
      const removedTenders = summary.tenders || 0;
      announce(
        dbStatus,
        removedTenders
          ? `Database wiped successfully. Removed ${removedTenders} tender records along with related award and organisation data.`
          : 'Database wipe completed. No tender records were present.',
        'success'
      );
    } catch (err) {
      console.error('Wipe request failed', err);
      announce(dbStatus, 'Unexpected error wiping data. See browser console for details.', 'error');
    }
  }

  async function refreshStats() {
    hideStatus(dbStatus);
    announce(dbStatus, 'Refreshing statistics…', 'info');
    console.info('Refreshing admin statistics view');
    try {
      const res = await fetch('/admin/db-info', { headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (res.status === 403) {
        announce(dbStatus, 'Administrator access required to read database statistics.', 'error');
        return;
      }
      const data = await res.json();
      state.tenderBreakdown = data.counts || [];
      state.counts.tenders = data.total || 0;
      state.counts.awards = data.awardCount || 0;
      state.counts.customers = data.customerCount || 0;
      state.counts.suppliers = data.supplierCount || 0;
      state.counts.totalSources = data.sourceCount || 0;
      state.counts.totalAwardSources = data.awardSourceCount || 0;
      state.lastScraped = data.lastScraped || null;
      updateStatCards();
      renderTenderBreakdown();
      announce(dbStatus, 'Statistics updated.', 'success');
    } catch (err) {
      console.error('Failed to refresh statistics', err);
      announce(dbStatus, 'Could not refresh statistics. Check connectivity.', 'error');
    }
  }

  if (wipeButton && confirmDialog && confirmForm) {
    wipeButton.addEventListener('click', () => {
      confirmDialog.showModal();
    });
    const cancelBtn = confirmDialog.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        confirmDialog.close();
      });
    }
    confirmForm.addEventListener('submit', evt => {
      evt.preventDefault();
      confirmDialog.close();
      performWipe();
    });
  }

  if (refreshButton) {
    refreshButton.addEventListener('click', refreshStats);
  }

  if (createForm) {
    createForm.addEventListener('submit', async evt => {
      evt.preventDefault();
      hideStatus(userStatus);
      const formData = new FormData(createForm);
      const username = formData.get('username').trim();
      const password = formData.get('password');
      if (!username || !password) {
        announce(userStatus, 'Provide both a username and password.', 'info');
        return;
      }
      announce(userStatus, `Creating account for ${username}…`, 'info');
      console.info('Creating user via admin console', username);
      try {
        const res = await fetch('/admin/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'CSRF-Token': csrfToken
          },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json().catch(() => null);
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (res.status === 403) {
          announce(userStatus, 'Administrator access required to create users.', 'error');
          return;
        }
        if (res.status === 409) {
          announce(userStatus, 'That username is already taken. Choose another.', 'error');
          return;
        }
        if (!res.ok || !data || !data.user) {
          announce(userStatus, 'Failed to create user. Check server logs.', 'error');
          return;
        }
        state.users.push({
          id: data.user.id,
          username: data.user.username,
          isAdmin: Boolean(data.user.isAdmin)
        });
        state.counts.users = state.users.length;
        updateStatCards();
        renderUsers();
        createForm.reset();
        announce(userStatus, `User ${username} created. Share credentials securely.`, 'success');
      } catch (err) {
        console.error('Failed to create user', err);
        announce(userStatus, 'Unexpected error creating user.', 'error');
      }
    });
  }

  if (userBody) {
    userBody.addEventListener('click', evt => {
      const row = evt.target.closest('tr[data-user-id]');
      if (!row) return;
      const userId = Number.parseInt(row.dataset.userId, 10);
      const username = row.querySelector('.username-cell').textContent;
      if (evt.target.classList.contains('reset-password')) {
        passwordUserId.value = String(userId);
        passwordInput.value = '';
        passwordConfirmInput.value = '';
        passwordDialog.showModal();
        passwordDialog.dataset.username = username;
      } else if (evt.target.classList.contains('delete-user')) {
        if (!confirm(`Delete user ${username}? This cannot be undone.`)) return;
        deleteUser(userId, username);
      }
    });
  }

  if (passwordDialog) {
    const cancelBtn = passwordDialog.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => passwordDialog.close());
    }
  }

  if (passwordForm) {
    passwordForm.addEventListener('submit', async evt => {
      evt.preventDefault();
      const id = Number.parseInt(passwordUserId.value, 10);
      const password = passwordInput.value;
      const confirm = passwordConfirmInput.value;
      if (!password || password !== confirm) {
        announce(userStatus, 'Passwords must match and be at least 8 characters.', 'error');
        return;
      }
      try {
        console.info('Resetting password via admin console for', passwordDialog.dataset.username);
        const res = await fetch(`/admin/users/${id}/password`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'CSRF-Token': csrfToken
          },
          body: JSON.stringify({ password })
        });
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (res.status === 403) {
          announce(userStatus, 'Administrator access required to reset passwords.', 'error');
          return;
        }
        if (!res.ok) {
          announce(userStatus, 'Failed to reset password. Try again.', 'error');
          return;
        }
        passwordDialog.close();
        announce(userStatus, `Password reset for ${passwordDialog.dataset.username}.`, 'success');
      } catch (err) {
        console.error('Failed to reset password', err);
        announce(userStatus, 'Unexpected error resetting password.', 'error');
      }
    });
  }

  async function deleteUser(id, username) {
    hideStatus(userStatus);
    announce(userStatus, `Deleting user ${username}…`, 'info');
    console.info('Deleting user via admin console', username);
    try {
      const res = await fetch(`/admin/users/${id}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json', 'CSRF-Token': csrfToken }
      });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (res.status === 403) {
        announce(userStatus, 'Administrator access required to delete users.', 'error');
        return;
      }
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        announce(userStatus, data.error || 'Cannot delete that account.', 'error');
        return;
      }
      if (res.status === 404) {
        announce(userStatus, 'User not found. Refresh the page.', 'error');
        return;
      }
      if (!res.ok) {
        announce(userStatus, 'Failed to delete user. Check logs.', 'error');
        return;
      }
      state.users = state.users.filter(user => user.id !== id);
      state.counts.users = state.users.length;
      updateStatCards();
      renderUsers();
      announce(userStatus, `User ${username} deleted.`, 'success');
    } catch (err) {
      console.error('Failed to delete user', err);
      announce(userStatus, 'Unexpected error deleting user.', 'error');
    }
  }
});
