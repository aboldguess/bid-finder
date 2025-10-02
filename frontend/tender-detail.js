/*
 * File: tender-detail.js
 * Overview: Client-side controller for the tender detail view. Handles
 *   bookmarking, note creation and inline editing so account holders can
 *   maintain personalised reminders against a tender.
 * Structure:
 *   - Helper utilities for status messaging and API calls.
 *   - Rendering functions updating the bookmark button and note list.
 *   - Event listeners wiring buttons and forms to the REST API.
 */
(function () {
  const context = window.__TENDER_CONTEXT__ || {};
  const tender = context.tender || {};
  const tenderId = tender.id;
  if (!tenderId) {
    return;
  }

  const currentUser = context.user || null;
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.content : '';

  const bookmarkButton = document.getElementById('detailBookmarkButton');
  const noteForm = document.getElementById('noteCreateForm');
  const noteText = document.getElementById('noteText');
  const noteDate = document.getElementById('noteDate');
  const noteList = document.getElementById('noteList');
  const noteStatus = document.getElementById('noteStatus');
  const bookmarkBanner = document.getElementById('bookmarkBanner');

  let bookmark = context.bookmark || null;

  function buildHeaders(includeJson = false) {
    const headers = { Accept: 'application/json' };
    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }
    if (csrfToken) {
      headers['CSRF-Token'] = csrfToken;
    }
    return headers;
  }

  function showStatus(element, message, type = 'info') {
    if (!element) return;
    element.classList.remove('error', 'success', 'info');
    if (!message) {
      element.hidden = true;
      element.textContent = '';
      return;
    }
    element.hidden = false;
    element.textContent = message;
    element.classList.add(type);
  }

  function formatDate(value) {
    if (!value) return 'No due date';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleDateString();
  }

  function renderBookmarkState() {
    if (bookmarkButton) {
      if (!currentUser) {
        bookmarkButton.disabled = true;
        bookmarkButton.textContent = 'Login to bookmark';
      } else {
        bookmarkButton.disabled = false;
        bookmarkButton.textContent = bookmark ? 'Remove bookmark' : 'Bookmark tender';
      }
    }
    if (bookmarkBanner) {
      if (!currentUser) {
        showStatus(bookmarkBanner, 'Sign in to save bookmarks and notes to your account.', 'info');
      } else if (!bookmark) {
        showStatus(bookmarkBanner, 'Bookmark this tender to track reminders and dashboard alerts.', 'info');
      } else {
        showStatus(bookmarkBanner, '', 'info');
      }
    }
    if (noteForm) {
      const controls = Array.from(noteForm.querySelectorAll('textarea, input, button'));
      controls.forEach(el => {
        if (el) {
          el.disabled = !currentUser;
        }
      });
    }
  }

  function renderNotes() {
    if (!noteList) return;
    noteList.innerHTML = '';
    if (!bookmark || !Array.isArray(bookmark.notes) || !bookmark.notes.length) {
      const empty = document.createElement('li');
      empty.className = 'form-hint';
      empty.textContent = bookmark
        ? 'No notes captured yet. Use the form above to add your first reminder.'
        : 'Bookmark the tender to begin recording personal notes.';
      noteList.appendChild(empty);
      return;
    }

    bookmark.notes.forEach(note => {
      const li = document.createElement('li');
      li.className = 'note-item';

      const main = document.createElement('div');
      main.className = 'note-main';
      const text = document.createElement('p');
      text.textContent = note.note || 'No note text provided.';
      const due = document.createElement('span');
      due.className = 'note-date';
      due.textContent = formatDate(note.dueDate);
      main.append(text, due);

      const actions = document.createElement('div');
      actions.className = 'note-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'outline';
      deleteBtn.textContent = 'Delete';
      actions.append(editBtn, deleteBtn);

      const editForm = document.createElement('form');
      editForm.className = 'note-edit hidden';
      const editLabel = document.createElement('label');
      editLabel.textContent = 'Note';
      const editField = document.createElement('textarea');
      editField.value = note.note || '';
      const dateLabel = document.createElement('label');
      dateLabel.textContent = 'Follow-up date';
      const dateField = document.createElement('input');
      dateField.type = 'date';
      if (note.dueDate) {
        dateField.value = note.dueDate;
      }
      const buttonRow = document.createElement('div');
      buttonRow.className = 'note-edit-actions';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'submit';
      saveBtn.textContent = 'Save';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'outline';
      cancelBtn.textContent = 'Cancel';
      buttonRow.append(saveBtn, cancelBtn);
      editForm.append(editLabel, editField, dateLabel, dateField, buttonRow);

      editBtn.addEventListener('click', () => {
        editForm.classList.remove('hidden');
        actions.classList.add('hidden');
      });
      cancelBtn.addEventListener('click', () => {
        editForm.classList.add('hidden');
        actions.classList.remove('hidden');
      });
      editForm.addEventListener('submit', evt => {
        evt.preventDefault();
        updateNote(note.id, {
          note: editField.value.trim(),
          dueDate: dateField.value
        })
          .then(() => {
            showStatus(noteStatus, 'Note updated.', 'success');
          })
          .catch(err => {
            console.error('Failed to update note', err);
            showStatus(noteStatus, 'Unable to update the note right now. Please retry shortly.', 'error');
          });
      });

      deleteBtn.addEventListener('click', () => {
        if (!window.confirm('Delete this note?')) {
          return;
        }
        deleteNote(note.id)
          .then(() => {
            showStatus(noteStatus, 'Note deleted.', 'success');
          })
          .catch(err => {
            console.error('Failed to delete note', err);
            showStatus(noteStatus, 'Unable to delete the note. Please retry shortly.', 'error');
          });
      });

      li.append(main, actions, editForm);
      noteList.appendChild(li);
    });
  }

  async function ensureBookmark() {
    const response = await fetch(`/api/tenders/${tenderId}/bookmark`, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({})
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Server responded with ${response.status}`);
    }
    const data = await response.json();
    bookmark = data.bookmark;
    renderBookmarkState();
    renderNotes();
    showStatus(noteStatus, 'Tender bookmarked. Add notes as needed.', 'success');
  }

  async function removeBookmark() {
    const response = await fetch(`/api/tenders/${tenderId}/bookmark`, {
      method: 'DELETE',
      headers: buildHeaders()
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Server responded with ${response.status}`);
    }
    bookmark = null;
    renderBookmarkState();
    renderNotes();
    showStatus(noteStatus, 'Bookmark removed.', 'success');
  }

  async function addNote(payload) {
    const response = await fetch(`/api/tenders/${tenderId}/notes`, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Server responded with ${response.status}`);
    }
    const data = await response.json();
    bookmark = data.bookmark;
    renderBookmarkState();
    renderNotes();
  }

  async function updateNote(noteId, payload) {
    const response = await fetch(`/api/bookmark-notes/${noteId}`, {
      method: 'PUT',
      headers: buildHeaders(true),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Server responded with ${response.status}`);
    }
    const data = await response.json();
    bookmark = data.bookmark;
    renderBookmarkState();
    renderNotes();
  }

  async function deleteNote(noteId) {
    const response = await fetch(`/api/bookmark-notes/${noteId}`, {
      method: 'DELETE',
      headers: buildHeaders()
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Server responded with ${response.status}`);
    }
    const data = await response.json();
    bookmark = data.bookmark;
    renderBookmarkState();
    renderNotes();
  }

  if (bookmarkButton) {
    bookmarkButton.addEventListener('click', () => {
      if (!currentUser) {
        showStatus(noteStatus, 'Sign in to manage bookmarks.', 'error');
        return;
      }
      if (!csrfToken) {
        showStatus(noteStatus, 'CSRF token missing. Refresh the page and try again.', 'error');
        return;
      }
      const action = bookmark ? removeBookmark() : ensureBookmark();
      action.catch(err => {
        console.error('Bookmark toggle failed', err);
        showStatus(noteStatus, 'Unable to update bookmark at this time.', 'error');
      });
    });
  }

  if (noteForm) {
    noteForm.addEventListener('submit', evt => {
      evt.preventDefault();
      if (!currentUser) {
        showStatus(noteStatus, 'Sign in to record personal notes.', 'error');
        return;
      }
      const text = noteText ? noteText.value.trim() : '';
      const due = noteDate ? noteDate.value : '';
      if (!text && !due) {
        showStatus(noteStatus, 'Provide a note or a follow-up date before saving.', 'error');
        return;
      }
      addNote({ note: text, dueDate: due })
        .then(() => {
          if (noteText) noteText.value = '';
          if (noteDate) noteDate.value = '';
          showStatus(noteStatus, 'Note saved.', 'success');
        })
        .catch(err => {
          console.error('Failed to add note', err);
          showStatus(noteStatus, 'Unable to save the note. Please retry shortly.', 'error');
        });
    });
  }

  renderBookmarkState();
  renderNotes();
})();
