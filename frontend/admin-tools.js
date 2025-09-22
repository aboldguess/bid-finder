/**
 * @file admin-tools.js
 * @description Client-side controller for the administration console. Handles
 *   destructive database actions, dynamic statistics refreshes and user
 *   management operations with friendly status updates and confirmation
 *   dialogues.
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
    currentUser: initial.currentUser || null
  };
  state.counts.users = state.users.length;

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.content : '';
  const dbStatus = document.getElementById('dbStatus');
  const userStatus = document.getElementById('userStatus');
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

  updateStatCards();
  renderTenderBreakdown();
  renderUsers();

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
