// Tacks keyboard shortcuts
// Global shortcuts fire only when focus is not inside an input, textarea, or select.

(function () {
  'use strict';

  // --- Theme toggle ---

  function getEffectiveTheme() {
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit) return explicit;
    // Fall back to system preference
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function updateToggleButton(btn, currentTheme) {
    // Use innerHTML so HTML entities (sun/moon characters) render correctly
    btn.innerHTML = currentTheme === 'dark' ? '&#9728; Light mode' : '&#9790; Dark mode';
  }

  function initThemeToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    updateToggleButton(btn, getEffectiveTheme());

    btn.addEventListener('click', function () {
      var current = getEffectiveTheme();
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      updateToggleButton(btn, next);
      // Close the settings menu after toggling
      var menu = document.getElementById('settings-menu');
      var gear = document.getElementById('settings-gear');
      if (menu) menu.setAttribute('hidden', '');
      if (gear) gear.setAttribute('aria-expanded', 'false');
    });
  }

  // --- Settings gear dropdown ---

  function initSettingsDropdown() {
    var gear = document.getElementById('settings-gear');
    var menu = document.getElementById('settings-menu');
    if (!gear || !menu) return;

    gear.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = !menu.hasAttribute('hidden');
      if (isOpen) {
        menu.setAttribute('hidden', '');
        gear.setAttribute('aria-expanded', 'false');
      } else {
        menu.removeAttribute('hidden');
        gear.setAttribute('aria-expanded', 'true');
      }
    });

    // Close when clicking outside
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#settings-dropdown')) {
        menu.setAttribute('hidden', '');
        gear.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // --- Nav active tab highlight ---

  function initNavActive() {
    var path = window.location.pathname;
    // Normalise trailing slash: /tasks/ -> /tasks
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    var navMap = {
      'nav-issues': '/tasks',
      'nav-board': '/board',
      'nav-epics': '/epics',
      'nav-graph': '/graph',
    };
    Object.keys(navMap).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var base = navMap[id];
      var isActive = path === base || path.startsWith(base + '/') || path.startsWith(base + '?');
      if (isActive) {
        el.classList.add('nav-active');
        el.setAttribute('aria-current', 'page');
      } else {
        el.classList.remove('nav-active');
        el.removeAttribute('aria-current');
      }
    });
  }

  // Run after DOM is ready (script is deferred)
  document.addEventListener('DOMContentLoaded', function () {
    initThemeToggle();
    initSettingsDropdown();
    initNavActive();
  });

  // Re-run nav active highlight after HTMX navigates (hx-push-url updates location).
  // htmx:afterSettle is the most reliable: fires after content is swapped AND
  // window.location.pathname is already updated by hx-push-url.
  document.addEventListener('htmx:afterSettle', initNavActive);
  // Keep pushUrl/replaceUrl as belt-and-suspenders for immediate URL feedback
  document.addEventListener('htmx:pushUrl', initNavActive);
  document.addEventListener('htmx:replaceUrl', initNavActive);
  document.addEventListener('htmx:historyRestore', initNavActive);

  // --- Help overlay ---

  function createOverlay() {
    var dlg = document.getElementById('help-overlay');
    if (dlg) return dlg;

    dlg = document.createElement('dialog');
    dlg.id = 'help-overlay';
    dlg.innerHTML = [
      '<article>',
      '  <header>',
      '    <button aria-label="Close" rel="prev" id="help-close"></button>',
      '    <h3>Keyboard Shortcuts</h3>',
      '  </header>',
      '  <table>',
      '    <tbody>',
      '      <tr><td><kbd>n</kbd></td><td>New task</td></tr>',
      '      <tr><td><kbd>/</kbd></td><td>Focus issue search</td></tr>',
      '      <tr><td><kbd>?</kbd></td><td>Show / hide this help</td></tr>',
      '      <tr><td><kbd>j</kbd> / <kbd>&darr;</kbd></td><td>Next row (task list)</td></tr>',
      '      <tr><td><kbd>k</kbd> / <kbd>&uarr;</kbd></td><td>Previous row (task list)</td></tr>',
      '      <tr><td><kbd>Enter</kbd></td><td>Open focused issue</td></tr>',
      '      <tr><td><kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd></td><td>Move the focused board card</td></tr>',
      '      <tr><td><kbd>Esc</kbd></td><td>Close this overlay / blur focus</td></tr>',
      '    </tbody>',
      '  </table>',
      '</article>',
    ].join('\n');
    document.body.appendChild(dlg);

    document.getElementById('help-close').addEventListener('click', function () {
      dlg.close();
    });

    return dlg;
  }

  function toggleHelp() {
    var dlg = createOverlay();
    if (dlg.open) {
      dlg.close();
    } else {
      dlg.showModal();
    }
  }

  // --- Toast notifications ---

  /**
   * Show a transient toast notification.
   *
   * @param {string} message - The text to display.
   * @param {string} [type='error'] - One of 'error', 'success', or 'info'.
   * @param {number} [duration=4000] - Milliseconds before auto-dismiss.
   */
  function showToast(message, type, duration) {
    type = type || 'error';
    duration = duration !== undefined ? duration : 4000;

    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;

    container.appendChild(toast);

    // Auto-hide after duration: add the hiding class, then remove from DOM
    var hideTimer = setTimeout(function () {
      toast.classList.add('toast-hiding');
      // Remove after CSS transition completes (400 ms)
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 450);
    }, duration);

    // Clicking dismisses immediately
    toast.addEventListener('click', function () {
      clearTimeout(hideTimer);
      toast.classList.add('toast-hiding');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 450);
    });
  }

  // --- Utilities ---

  function isTypingTarget(el) {
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function currentPath() {
    return window.location.pathname;
  }

  // --- Task list navigation ---

  function getListRows() {
    var tbody = document.querySelector('table tbody');
    if (!tbody) return [];
    return Array.from(tbody.querySelectorAll('tr[data-href]'));
  }

  function getFocusedRowIndex(rows) {
    var active = document.activeElement;
    return rows.indexOf(active);
  }

  function focusRow(rows, index) {
    if (rows.length === 0) return;
    var clamped = Math.max(0, Math.min(index, rows.length - 1));
    // Remove tabindex from all, set on target
    rows.forEach(function (r) { r.setAttribute('tabindex', '-1'); });
    rows[clamped].setAttribute('tabindex', '0');
    rows[clamped].focus();
  }

  function openFocusedRow(rows) {
    var idx = getFocusedRowIndex(rows);
    if (idx === -1) return;
    var href = rows[idx].getAttribute('data-href');
    if (!href) return;
    var dlg = document.getElementById('task-modal');
    if (dlg) {
      htmx.ajax('GET', href, { target: '#task-modal', swap: 'innerHTML' });
    } else {
      window.location.href = href;
    }
  }

  // --- Board navigation ---

  function getBoardCards() {
    return Array.from(document.querySelectorAll('#content-area .board-card'));
  }

  function getFocusedCardIndex(cards) {
    return cards.indexOf(document.activeElement.closest('.board-card'));
  }

  function focusCard(cards, index) {
    if (cards.length === 0) return;
    var clamped = Math.max(0, Math.min(index, cards.length - 1));
    cards[clamped].focus();
  }

  // --- Filter form: strip empty params before submit ---

  // HTMX requests: remove empty-valued params before the request fires
  document.addEventListener('htmx:configRequest', function (e) {
    var params = e.detail.parameters;
    Object.keys(params).forEach(function (key) {
      if (params[key] === '') delete params[key];
    });
  });

  // Plain form submits (no-JS fallback): disable empty inputs
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.tagName !== 'FORM' || form.method !== 'get') return;
    Array.from(form.elements).forEach(function (el) {
      if (el.name && el.value === '') el.disabled = true;
    });
    setTimeout(function () {
      Array.from(form.elements).forEach(function (el) { el.disabled = false; });
    }, 0);
  });

  // --- Task modal ---

  // --- Modal focus trap (inert approach) ---
  // When any <dialog> opens via showModal(), set `inert` on the #main content wrapper
  // so background elements cannot receive keyboard focus or interaction.
  // Remove `inert` when the dialog closes.

  function setMainInert(inert) {
    var main = document.getElementById('main');
    if (!main) return;
    if (inert) {
      main.setAttribute('inert', '');
    } else {
      main.removeAttribute('inert');
    }
  }

  // Observe all <dialog> elements for open/close state changes.
  // We use a MutationObserver on <body> to catch dynamically-created dialogs too.
  function handleDialogToggle() {
    var anyOpen = Array.from(document.querySelectorAll('dialog')).some(function (d) {
      return d.open;
    });
    setMainInert(anyOpen);
  }

  // Watch the <dialog> elements' attributes for the `open` attribute changing
  var dialogObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.attributeName === 'open') {
        handleDialogToggle();
      }
    });
  });

  function observeDialogs() {
    document.querySelectorAll('dialog').forEach(function (dlg) {
      dialogObserver.observe(dlg, { attributes: true, attributeFilter: ['open'] });
    });
  }

  // Also observe <body> for new <dialog> elements being added
  var bodyObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType === 1 && node.tagName === 'DIALOG') {
          dialogObserver.observe(node, { attributes: true, attributeFilter: ['open'] });
        }
      });
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    observeDialogs();
    bodyObserver.observe(document.body, { childList: true });
  });

  // --- URL hash for task modals ---
  // When a task modal opens, push #task-<id> to the URL.
  // When it closes, remove the hash.
  // On page load, auto-open the modal if a matching hash is present.

  var TASK_HASH_PREFIX = '#task-';

  function getHashTaskId() {
    var hash = window.location.hash;
    if (hash && hash.startsWith(TASK_HASH_PREFIX)) {
      return hash.slice(TASK_HASH_PREFIX.length);
    }
    return null;
  }

  function pushTaskHash(taskId) {
    if (taskId && getHashTaskId() !== taskId) {
      history.pushState({ tacksModal: true }, '', TASK_HASH_PREFIX + taskId);
    }
  }

  function clearTaskHash() {
    if (!getHashTaskId()) return;
    if (history.state && history.state.tacksModal) history.back();
    else history.replaceState(history.state, '', window.location.pathname + window.location.search);

  }

  // Extract task ID from modal content — look for a data-task-id attribute or
  // a canonical link pattern like /tasks/<id> inside the modal.
  function extractModalTaskId() {
    var dlg = document.getElementById('task-modal');
    if (!dlg) return null;
    // Look for data-task-id on any element inside (article header, editable fields, etc.)
    var el = dlg.querySelector('[data-task-id]');
    if (el) return el.getAttribute('data-task-id');
    // Fallback: look for a /tasks/<id> link inside the modal
    var link = dlg.querySelector('a[href^="/tasks/"]');
    if (link) {
      var m = link.getAttribute('href').match(/^\/tasks\/(tk-[^/?#]+)/);
      if (m) return m[1];
    }
    return null;
  }

  // Open the modal after HTMX swaps content into it
  document.addEventListener('htmx:afterSwap', function (e) {
    if (e.detail.target.id === 'task-modal') {
      var dlg = document.getElementById('task-modal');
      if (dlg && !dlg.open) {
        dlg.showModal();
      }
      // Push URL hash after the modal content is in the DOM
      var taskId = extractModalTaskId();
      if (taskId) {
        pushTaskHash(taskId);
      }
    }
  });

  // Clear URL hash when the task modal closes
  document.addEventListener('close', function (e) {
    if (e.target && e.target.id === 'task-modal') {
      clearTaskHash();
    }
  }, true); // capture phase so we catch the native <dialog> close event

  // On back/forward navigation, open or close modal to match URL hash
  window.addEventListener('popstate', function () {
    var taskId = getHashTaskId();
    var dlg = document.getElementById('task-modal');
    if (taskId) {
      if (dlg && (!dlg.open || extractModalTaskId() !== taskId)) {
        htmx.ajax('GET', '/tasks/' + encodeURIComponent(taskId), { target: '#task-modal', swap: 'innerHTML' });
      }
    } else {
      if (dlg && dlg.open) {
        dlg.close();
      }
    }
  });

  // On page load: if there is a task hash, auto-open the modal
  document.addEventListener('DOMContentLoaded', function () {
    var taskId = getHashTaskId();
    if (taskId) {
      htmx.ajax('GET', '/tasks/' + encodeURIComponent(taskId), { target: '#task-modal', swap: 'innerHTML' });
    }
  });

  // Background refreshes leave focused controls, selections and pointer targets intact.
  var liveMarkup = new WeakMap();
  var pendingLiveMarkup = new WeakMap();

  function canRefresh(target) {
    var active = document.activeElement;
    var selection = window.getSelection();
    return !target.contains(active)
      && !target.querySelector('tr:hover, .board-card:hover, a:hover, button:hover, summary:hover')
      && !(selection && !selection.isCollapsed && target.contains(selection.anchorNode))
      && !document.querySelector('[data-editable].editing, .board-card.dragging, .board-card.drag-pending, dialog[open]');
  }

  document.addEventListener('htmx:beforeRequest', function (e) {
    var source = e.detail.elt;
    if (source && source.matches('[data-live]') && !canRefresh(source)) e.preventDefault();
  });

  document.addEventListener('htmx:beforeSwap', function (e) {
    var target = e.detail.target;
    if (!target || !target.matches('[data-live]')) return;
    var isPoll = target === e.detail.requestConfig.elt;
    if (isPoll && !canRefresh(target)) {
      e.detail.shouldSwap = false;
      return;
    }
    if (!e.detail.shouldSwap) return;
    var incoming = new DOMParser().parseFromString(e.detail.serverResponse, 'text/html')
      .getElementById(target.id);
    if (!incoming) return;
    var markup = incoming.innerHTML;
    if (isPoll && (liveMarkup.get(target) === markup || target.innerHTML === markup)) {
      liveMarkup.set(target, markup);
      e.detail.shouldSwap = false;
      return;
    }
    pendingLiveMarkup.set(e.detail.xhr, { id: target.id, markup: markup });
  });

  document.addEventListener('htmx:afterSwap', function (e) {
    var snapshot = pendingLiveMarkup.get(e.detail.xhr);
    if (!snapshot) return;
    pendingLiveMarkup.delete(e.detail.xhr);
    var replacement = document.getElementById(snapshot.id);
    if (replacement) liveMarkup.set(replacement, snapshot.markup);
  });

  function refreshResults() {
    var results = document.querySelector('#main [data-live]');
    if (results) htmx.trigger(results, 'refresh');
  }

  // Delegate close-button clicks inside the task modal
  document.addEventListener('click', function (e) {
    if (e.target.closest('#task-modal [aria-label="Close"]')) {
      var dlg = document.getElementById('task-modal');
      if (dlg) dlg.close();
    }
  });

  // Close task modal when user clicks the backdrop
  document.addEventListener('click', function (e) {
    var dlg = document.getElementById('task-modal');
    if (dlg && dlg.open && e.target === dlg) {
      dlg.close();
    }
  });

  // Handle create-task-form submission via JSON POST to /api/tasks
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.id !== 'create-task-form') return;
    e.preventDefault();

    var title = form.querySelector('[name="title"]');
    var description = form.querySelector('[name="description"]');
    var priority = form.querySelector('[name="priority"]');
    var status = form.querySelector('[name="status"]');
    var tags = form.querySelector('[name="tags"]');
    var assignee = form.querySelector('[name="assignee"]');
    var parentId = form.querySelector('[name="parent_id"]');

    // Parse tags: comma-separated string → array
    var tagsVal = tags && tags.value.trim() ? tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : null;

    var body = {
      title: title ? title.value : '',
      description: description && description.value.trim() ? description.value : null,
      priority: priority ? parseInt(priority.value, 10) : null,
      status: status ? status.value : null,
      tags: tagsVal,
      assignee: assignee && assignee.value.trim() ? assignee.value.trim() : null,
      parent_id: parentId && parentId.value ? parentId.value : null
    };

    var submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) {
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }

    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute('aria-busy');
        }
        if (r.status === 201) {
          var dlg = document.getElementById('task-modal');
          if (dlg) dlg.close();
          showToast('Task created', 'success');
          refreshResults();
        } else {
          showToast('Failed to create task', 'error');
        }
      })
      .catch(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute('aria-busy');
        }
        showToast('Failed to create task', 'error');
      });
  });

  // --- Tag multi-select dropdown ---

  function initTagMultiSelect() {
    var wrapper = document.getElementById('tag-multiselect');
    if (!wrapper || wrapper._tagsInitialized) return;
    wrapper._tagsInitialized = true;

    var trigger = document.getElementById('tag-multiselect-trigger');
    var dropdown = document.getElementById('tag-multiselect-dropdown');
    var pillsContainer = document.getElementById('tag-multiselect-pills');
    var placeholder = document.getElementById('tag-multiselect-placeholder');
    var hiddenInput = document.getElementById('tag-hidden-input');

    if (!trigger || !dropdown || !hiddenInput) return;

    // Collect currently selected tags from hidden input
    function getSelectedTags() {
      var val = hiddenInput.value;
      if (!val) return [];
      return val.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    }

    // Update the hidden input and fire change to trigger HTMX
    function setSelectedTags(tags) {
      hiddenInput.value = tags.join(',');
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Rebuild the pills display in the trigger area
    function renderPills(tags) {
      // Remove existing dynamic pills (keep static server-rendered ones cleared first)
      Array.from(pillsContainer.querySelectorAll('.filter-tag-pill')).forEach(function (p) {
        p.remove();
      });
      tags.forEach(function (tag) {
        var pill = document.createElement('span');
        pill.className = 'filter-tag-pill';
        pill.setAttribute('data-tag', tag);
        var text = document.createElement('span');
        text.className = 'filter-tag-pill-text';
        text.textContent = tag;
        var remove = document.createElement('button');
        remove.className = 'filter-tag-pill-remove';
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove ' + tag + ' filter');
        remove.dataset.removeTag = tag;
        remove.textContent = '×';
        pill.append(text, remove);
        pillsContainer.appendChild(pill);
      });
      // Show/hide placeholder
      if (placeholder) {
        placeholder.style.display = tags.length > 0 ? 'none' : '';
      }
    }

    // Update the checkmarks and selected class in the dropdown options
    function syncDropdownOptions(tags) {
      Array.from(dropdown.querySelectorAll('.tag-dropdown-option')).forEach(function (li) {
        var tag = li.getAttribute('data-tag');
        var isSelected = tags.indexOf(tag) !== -1;
        li.classList.toggle('selected', isSelected);
        li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        // Update or add checkmark
        var check = li.querySelector('.tag-check');
        if (isSelected) {
          if (!check) {
            check = document.createElement('span');
            check.className = 'tag-check';
            check.textContent = '\u2713';
            li.appendChild(check);
          }
        } else {
          if (check) check.remove();
        }
      });
    }

    function getTagOptions() {
      return Array.from(dropdown.querySelectorAll('.tag-dropdown-option'));
    }

    function getFocusedTagOptionIndex() {
      var options = getTagOptions();
      return options.indexOf(document.activeElement);
    }

    function focusTagOption(index) {
      var options = getTagOptions();
      if (options.length === 0) return;
      var clamped = Math.max(0, Math.min(index, options.length - 1));
      options[clamped].focus();
    }

    function openDropdown() {
      dropdown.removeAttribute('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      // Make options keyboard-focusable
      getTagOptions().forEach(function (li) { li.setAttribute('tabindex', '-1'); });
    }

    function closeDropdown() {
      dropdown.setAttribute('hidden', '');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function closeDropdownAndFocusTrigger() {
      closeDropdown();
      trigger.focus();
    }

    function toggleTag(tag) {
      var tags = getSelectedTags();
      var idx = tags.indexOf(tag);
      if (idx === -1) {
        tags.push(tag);
      } else {
        tags.splice(idx, 1);
      }
      setSelectedTags(tags);
      renderPills(tags);
      syncDropdownOptions(tags);
    }

    // Toggle dropdown open/close on trigger click
    trigger.addEventListener('click', function (e) {
      // Don't open if clicking a remove-pill button
      if (e.target.closest('.filter-tag-pill-remove')) return;
      if (dropdown.hasAttribute('hidden')) {
        openDropdown();
      } else {
        closeDropdown();
      }
    });

    // Keyboard: full navigation while trigger is focused
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (dropdown.hasAttribute('hidden')) {
          openDropdown();
        }
        focusTagOption(0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (dropdown.hasAttribute('hidden')) {
          openDropdown();
        }
        focusTagOption(getTagOptions().length - 1);
      } else if (e.key === 'Escape' && !dropdown.hidden) {
        e.preventDefault();
        closeDropdownAndFocusTrigger();
      } else if (e.key === 'Tab') {
        closeDropdown();
      }
    });

    // Click on dropdown option toggles that tag
    dropdown.addEventListener('mousedown', function (e) {
      // mousedown fires before blur on trigger; prevent blur from closing dropdown
      e.preventDefault();
    });

    dropdown.addEventListener('click', function (e) {
      var option = e.target.closest('.tag-dropdown-option');
      if (!option) return;
      var tag = option.getAttribute('data-tag');
      if (tag) toggleTag(tag);
    });

    // Keyboard navigation within tag dropdown options
    dropdown.addEventListener('keydown', function (e) {
      var idx = getFocusedTagOptionIndex();
      var options = getTagOptions();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusTagOption(idx + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (idx <= 0) {
          closeDropdownAndFocusTrigger();
        } else {
          focusTagOption(idx - 1);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (idx !== -1) {
          var tag = options[idx].getAttribute('data-tag');
          if (tag) toggleTag(tag);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDropdownAndFocusTrigger();
      } else if (e.key === 'Tab') {
        closeDropdown();
      }
    });

    // Click on remove button inside a pill (event bubbles from pillsContainer)
    wrapper.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-tag-pill-remove');
      if (!btn) return;
      e.stopPropagation();
      var tag = btn.getAttribute('data-remove-tag');
      if (tag) toggleTag(tag);
    });

    // On init: sync state from hidden input (handles server-rendered selections)
    var initialTags = getSelectedTags();
    renderPills(initialTags);
    syncDropdownOptions(initialTags);
  }

  // Initialize on DOMContentLoaded and after HTMX settles (full content swaps)
  document.addEventListener('DOMContentLoaded', initTagMultiSelect);
  document.addEventListener('htmx:historyRestore', initTagMultiSelect);
  document.addEventListener('htmx:afterSettle', function (e) {
    // Re-init only when the content-area or a parent was swapped (not tbody polling)
    var target = e.detail.target;
    if (
      target &&
      (target.id === 'content-area' ||
        target.id === 'main' ||
        (target.querySelector && target.querySelector('#tag-multiselect')))
    ) {
      initTagMultiSelect();
    }
  });

  // --- Filter multi-select widget ---

  /**
   * Initialize a filter multi-select widget.
   *
   * @param {HTMLElement} container - The `.filter-multiselect` element.
   *
   * The widget reads initial selection from the hidden input value (comma-separated).
   * On toggle, it updates the hidden input and dispatches a `change` event with
   * `bubbles: true` so HTMX's `change from:#<id>` trigger fires.
   */
  function initFilterMultiSelect(container) {
    if (!container || container._msInitialized) return;
    container._msInitialized = true;

    var trigger = container.querySelector('.filter-multiselect-trigger');
    var dropdown = container.querySelector('.filter-multiselect-dropdown');
    var pillsEl = container.querySelector('.filter-multiselect-pills');
    var placeholder = container.querySelector('.filter-multiselect-placeholder');
    var hiddenInput = container.querySelector('input[type="hidden"]');
    var items = Array.from(container.querySelectorAll('.filter-multiselect-dropdown li[role="option"]'));

    if (!trigger || !dropdown || !pillsEl || !placeholder || !hiddenInput) return;

    // --- State ---

    // Parse current hidden input value into a set of selected values
    function getSelected() {
      var val = hiddenInput.value;
      if (!val) return [];
      return val.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }

    var selected = getSelected();

    // --- Rendering ---

    function render() {
      // Update aria-selected on each option
      items.forEach(function (li) {
        var v = li.getAttribute('data-value');
        li.setAttribute('aria-selected', selected.indexOf(v) !== -1 ? 'true' : 'false');
      });

      // Rebuild pills
      pillsEl.innerHTML = '';
      selected.forEach(function (value) {
        var item = items.find(function (li) { return li.getAttribute('data-value') === value; });
        if (!item) return;
        var label = item.getAttribute('data-label') || value;
        var badgeClass = item.getAttribute('data-badge-class') || '';

        var pill = document.createElement('span');
        pill.className = 'filter-multiselect-pill badge ' + badgeClass;

        var text = document.createElement('span');
        text.textContent = label;

        var removeBtn = document.createElement('button');
        removeBtn.className = 'filter-multiselect-pill-remove';
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', 'Remove ' + label + ' filter');
        removeBtn.textContent = '\u00d7'; // ×

        removeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          toggleValue(value);
        });

        pill.appendChild(text);
        pill.appendChild(removeBtn);
        pillsEl.appendChild(pill);
      });

      // Show/hide placeholder
      placeholder.style.display = selected.length === 0 ? '' : 'none';

      // Update hidden input and notify HTMX
      var newVal = selected.join(',');
      if (hiddenInput.value !== newVal) {
        hiddenInput.value = newVal;
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // --- Toggle a value in/out of selected ---

    function toggleValue(value) {
      var idx = selected.indexOf(value);
      if (idx === -1) {
        selected.push(value);
      } else {
        selected.splice(idx, 1);
      }
      render();
    }

    // --- Dropdown open/close ---

    function openDropdown() {
      dropdown.removeAttribute('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      // Set tabindex on items so they are keyboard-focusable
      items.forEach(function (li) { li.setAttribute('tabindex', '-1'); });
    }

    function closeDropdown() {
      dropdown.setAttribute('hidden', '');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function closeDropdownAndFocusTrigger() {
      closeDropdown();
      trigger.focus();
    }

    function isOpen() {
      return !dropdown.hasAttribute('hidden');
    }

    // Focus a specific option item (by index among visible items)
    function focusItem(index) {
      if (items.length === 0) return;
      var clamped = Math.max(0, Math.min(index, items.length - 1));
      items[clamped].focus();
    }

    function getFocusedItemIndex() {
      return items.indexOf(document.activeElement);
    }

    // Trigger click: toggle dropdown
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen()) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    // Keyboard: Enter/Space/ArrowDown on trigger opens dropdown and focuses first item
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isOpen()) {
          openDropdown();
        }
        focusItem(0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen()) {
          openDropdown();
        }
        focusItem(items.length - 1);
      } else if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        closeDropdownAndFocusTrigger();
      } else if (e.key === 'Tab') {
        // Tab closes dropdown without returning focus so natural tab order proceeds
        closeDropdown();
      }
    });

    // Dropdown item clicks: use mousedown + preventDefault to avoid blur-before-click
    dropdown.addEventListener('mousedown', function (e) {
      e.preventDefault(); // prevent trigger blur before click fires
    });

    items.forEach(function (li) {
      li.setAttribute('role', 'option');

      li.addEventListener('click', function (e) {
        e.stopPropagation();
        var value = li.getAttribute('data-value');
        if (value) toggleValue(value);
      });

      // Keyboard navigation within dropdown options
      li.addEventListener('keydown', function (e) {
        var idx = getFocusedItemIndex();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusItem(idx + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (idx <= 0) {
            // Wrap back to trigger when arrowing up past first item
            closeDropdownAndFocusTrigger();
          } else {
            focusItem(idx - 1);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var value = li.getAttribute('data-value');
          if (value) toggleValue(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeDropdownAndFocusTrigger();
        } else if (e.key === 'Tab') {
          // Tab closes and lets focus move naturally
          closeDropdown();
        }
      });
    });

    // Initial render (reflects pre-selected values from URL params)
    render();
  }

  // --- Filter single-select widget ---

  /**
   * Initialize a filter single-select widget (done_since filter).
   *
   * @param {HTMLElement} container - The `.filter-singleselect` element.
   *
   * Like filter-multiselect but only one option can be selected at a time.
   * Selecting a new option deselects the previous one. The trigger shows the
   * selected option's label as placeholder text. The hidden input value is updated
   * and a `change` event is dispatched so HTMX triggers fire.
   */
  function initFilterSingleSelect(container) {
    if (!container || container._ssInitialized) return;
    container._ssInitialized = true;

    var trigger = container.querySelector('.filter-multiselect-trigger');
    var dropdown = container.querySelector('.filter-multiselect-dropdown');
    var placeholder = container.querySelector('.filter-multiselect-placeholder');
    var hiddenInput = container.querySelector('input[type="hidden"]');
    var items = Array.from(container.querySelectorAll('.filter-multiselect-dropdown li[role="option"]'));

    if (!trigger || !dropdown || !placeholder || !hiddenInput) return;

    // --- State ---

    function getSelected() {
      return hiddenInput.value || '';
    }

    var selected = getSelected();

    // --- Rendering ---

    function render() {
      // Update aria-selected on each option
      items.forEach(function (li) {
        var v = li.getAttribute('data-value');
        li.setAttribute('aria-selected', v === selected ? 'true' : 'false');
      });

      // Update placeholder label to show selected option's label
      var selectedItem = items.find(function (li) { return li.getAttribute('data-value') === selected; });
      var fallbackLabel = items.length > 0 ? (items[0].getAttribute('data-label') || items[0].getAttribute('data-value') || '') : '';
      placeholder.textContent = selectedItem
        ? (selectedItem.getAttribute('data-label') || selected)
        : fallbackLabel;
      placeholder.style.display = '';

      // Update hidden input and notify HTMX
      if (hiddenInput.value !== selected) {
        hiddenInput.value = selected;
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // --- Select a value (single: replaces previous) ---

    function selectValue(value) {
      selected = value;
      render();
    }

    // --- Dropdown open/close ---

    function openDropdown() {
      dropdown.removeAttribute('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      items.forEach(function (li) { li.setAttribute('tabindex', '-1'); });
    }

    function closeDropdown() {
      dropdown.setAttribute('hidden', '');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function closeDropdownAndFocusTrigger() {
      closeDropdown();
      trigger.focus();
    }

    function isOpen() {
      return !dropdown.hasAttribute('hidden');
    }

    function focusItem(index) {
      if (items.length === 0) return;
      var clamped = Math.max(0, Math.min(index, items.length - 1));
      items[clamped].focus();
    }

    function getFocusedItemIndex() {
      return items.indexOf(document.activeElement);
    }

    // Trigger click: toggle dropdown
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen()) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    // Keyboard on trigger
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isOpen()) openDropdown();
        focusItem(0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen()) openDropdown();
        focusItem(items.length - 1);
      } else if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        closeDropdownAndFocusTrigger();
      } else if (e.key === 'Tab') {
        closeDropdown();
      }
    });

    // Prevent trigger blur before click fires
    dropdown.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });

    items.forEach(function (li) {
      li.setAttribute('role', 'option');

      li.addEventListener('click', function (e) {
        e.stopPropagation();
        var value = li.getAttribute('data-value');
        if (value) {
          selectValue(value);
          closeDropdown();
        }
      });

      li.addEventListener('keydown', function (e) {
        var idx = getFocusedItemIndex();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusItem(idx + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (idx <= 0) {
            closeDropdownAndFocusTrigger();
          } else {
            focusItem(idx - 1);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var value = li.getAttribute('data-value');
          if (value) {
            selectValue(value);
            closeDropdown();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeDropdownAndFocusTrigger();
        } else if (e.key === 'Tab') {
          closeDropdown();
        }
      });
    });

    // Initial render (reflects pre-selected value from hidden input / URL params)
    render();
  }

  function initAllFilterMultiSelects() {
    document.querySelectorAll('.filter-multiselect:not(.filter-singleselect)').forEach(initFilterMultiSelect);
    document.querySelectorAll('.filter-singleselect').forEach(initFilterSingleSelect);
  }

  document.addEventListener('pointerdown', function (e) {
    document.querySelectorAll('.filter-multiselect-dropdown:not([hidden]), .tag-multiselect-dropdown:not([hidden])')
      .forEach(function (dropdown) {
        var wrapper = dropdown.parentElement;
        if (!wrapper.contains(e.target)) {
          dropdown.hidden = true;
          wrapper.querySelector('[aria-expanded]').setAttribute('aria-expanded', 'false');
        }
      });
  });

  document.addEventListener('DOMContentLoaded', initAllFilterMultiSelects);
  document.addEventListener('htmx:historyRestore', initAllFilterMultiSelects);
  document.addEventListener('htmx:afterSettle', function (e) {
    var target = e.detail.target;
    if (
      target &&
      (target.id === 'content-area' ||
        target.id === 'main' ||
        (target.querySelector && target.querySelector('.filter-multiselect')))
    ) {
      initAllFilterMultiSelects();
    }
  });

  // --- Column collapse toggle ---

  function setDoneCollapsed(button, collapsed) {
    var cards = button.closest('.board-column').querySelector('.column-cards');
    cards.hidden = collapsed;
    button.textContent = collapsed ? '▸' : '▾';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand done column' : 'Collapse done column');
  }

  function restoreColumnCollapse() {
    document.querySelectorAll('.column-collapse-toggle').forEach(function (button) {
      setDoneCollapsed(button, localStorage.getItem(button.dataset.storageKey) === 'true');
    });
  }

  document.addEventListener('click', function (e) {
    var button = e.target.closest('.column-collapse-toggle');
    if (!button) return;
    var collapsed = button.getAttribute('aria-expanded') === 'true';
    localStorage.setItem(button.dataset.storageKey, String(collapsed));
    setDoneCollapsed(button, collapsed);
  });

  document.addEventListener('DOMContentLoaded', restoreColumnCollapse);
  document.addEventListener('htmx:historyRestore', restoreColumnCollapse);
  document.addEventListener('htmx:afterSwap', restoreColumnCollapse);

  // --- Inline editing ---

  var editingState = new WeakMap();

  // Build a status badge HTML string for re-rendering after save
  function statusBadgeHtml(status) {
    var icons = { open: '○', in_progress: '◐', done: '✓', blocked: '⊘' };
    var labels = { open: 'Open', in_progress: 'In Progress', done: 'Done', blocked: 'Blocked' };
    var icon = icons[status] || '';
    var label = labels[status] || status.replace('_', ' ');
    return '<span class="badge status-' + status + '">' + icon + ' ' + label + '</span>';
  }

  // Build a priority badge HTML string for re-rendering after save
  function priorityBadgeHtml(priority) {
    var icons = { 0: '▲', 1: '▲', 2: '▬', 3: '▽', 4: '·' };
    var icon = icons[priority] || '';
    return '<span class="badge priority-' + priority + '">' + icon + ' P' + priority + '</span>';
  }

  function renderSavedValue(el, field, value) {
    if (field === 'status') {
      el.innerHTML = statusBadgeHtml(value);
    } else if (field === 'priority') {
      el.innerHTML = priorityBadgeHtml(value);
    } else if (field === 'tags') {
      el.replaceChildren();
      value.forEach(function (tag) {
        var pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.textContent = tag;
        el.append(pill, ' ');
      });
      if (!value.length && el.classList.contains('meta-item')) el.textContent = 'Add tags';
    } else {
      el.textContent = value;
    }
  }

  function finishEdit(el, restoreFocus) {
    var state = editingState.get(el);
    if (!state) return;
    state.keys.abort();
    editingState.delete(el);
    el.classList.remove('editing');
    el.removeAttribute('aria-busy');
    if (state.trigger) state.trigger.disabled = false;
    if (restoreFocus) (state.trigger || el).focus({ preventScroll: true });
  }

  function cancelEdit(el, restoreFocus) {
    var state = editingState.get(el);
    if (!state || state.saving) return;
    el.replaceChildren(...state.original);
    finishEdit(el, restoreFocus);
  }

  // Validate a field value before committing.
  // Returns { valid: true } on success, or { valid: false, message: string } on failure.
  // Side-effect: for 'tags', mutates rawValue into cleaned form (caller uses the returned cleaned value).
  function validateEdit(field, rawValue) {
    if (field === 'title') {
      if (!rawValue || rawValue.trim().length === 0) {
        return { valid: false, message: 'title cannot be empty' };
      }
    } else if (field === 'priority') {
      // Allow empty string (clears priority) or a number 1-4
      var trimmed = rawValue.trim();
      if (trimmed !== '') {
        var num = Number(trimmed);
        if (!Number.isInteger(num) || num < 0 || num > 4) {
          return { valid: false, message: 'priority must be a number between 0 and 4' };
        }
      }
    } else if (field === 'status') {
      var validStatuses = ['open', 'in_progress', 'done', 'blocked'];
      if (validStatuses.indexOf(rawValue) === -1) {
        return { valid: false, message: 'status must be one of: open, in_progress, done, blocked' };
      }
    }
    return { valid: true };
  }

  // Keep the editor and its contents available if the request fails.
  function commitEdit(el, field, rawValue) {
    var state = editingState.get(el);
    if (!state || state.saving) return;
    if (rawValue === state.value) {
      cancelEdit(el, el.contains(document.activeElement));
      return;
    }
    var validation = validateEdit(field, rawValue);
    var input = el.querySelector('input, textarea, select');
    if (!validation.valid) {
      showToast(validation.message, 'error');
      input.classList.add('edit-input-error');
      input.addEventListener('input', function () {
        input.classList.remove('edit-input-error');
      }, { once: true });
      return;
    }

    var value = rawValue;
    if (field === 'priority') value = Number(rawValue);
    if (field === 'tags') value = rawValue.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean);
    var payload = {};
    payload[field] = value;
    var description = field === 'description';
    var buttons = el.querySelectorAll('button');
    var hadFocus = el.contains(document.activeElement);
    state.saving = true;
    el.setAttribute('aria-busy', 'true');
    // Keep focus on the active control so a retry or successful save can return it.
    if (input.tagName !== 'SELECT') input.readOnly = true;
    buttons.forEach(function (button) { button.setAttribute('aria-disabled', 'true'); });

    fetch('/api/tasks/' + encodeURIComponent(el.dataset.taskId), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Accept': description ? 'text/html' : 'application/json'
      },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return description ? response.text() : response.json();
    }).then(function (saved) {
      var restore = el.contains(document.activeElement) || (hadFocus && document.activeElement === document.body);
      if (description) {
        el.dataset.markdown = value;
        el.innerHTML = saved || '<p class="muted">No description</p>';
      } else {
        renderSavedValue(el, field, saved[field]);
      }
      finishEdit(el, restore);
    }).catch(function () {
      state.saving = false;
      el.removeAttribute('aria-busy');
      input.readOnly = false;
      buttons.forEach(function (button) { button.removeAttribute('aria-disabled'); });
      if (input.tagName === 'SELECT') input.value = state.value;
      showToast('Could not save the change', 'error');
    });
  }

  // Create the appropriate input element for the given field
  function createInput(field, currentText) {
    var input;

    if (field === 'status') {
      input = document.createElement('select');
      input.className = 'inline-edit-select';
      var statusLabels = { open: '○ Open', in_progress: '◐ In Progress', done: '✓ Done', blocked: '⊘ Blocked' };
      ['open', 'in_progress', 'done', 'blocked'].forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt;
        o.textContent = statusLabels[opt] || opt.replace('_', ' ');
        // Strip leading icon character (non-ASCII) then spaces before matching
        var normalised = currentText.replace(/^[^\w]+/, '').trim().replace(/\s+/g, '_').toLowerCase();
        if (normalised === opt) {
          o.selected = true;
        }
        input.appendChild(o);
      });
    } else if (field === 'priority') {
      input = document.createElement('select');
      input.className = 'inline-edit-select';
      var priorityLabels = { 0: '▲ P0', 1: '▲ P1', 2: '▬ P2', 3: '▽ P3', 4: '· P4' };
      [0, 1, 2, 3, 4].forEach(function (p) {
        var o = document.createElement('option');
        o.value = String(p);
        o.textContent = priorityLabels[p] || 'P' + p;
        // currentText might be "▲ P1", "P1", or "1" — strip non-digits
        var numText = currentText.replace(/[^0-9]/g, '');
        if (numText === String(p)) o.selected = true;
        input.appendChild(o);
      });
    } else if (field === 'description') {
      input = document.createElement('textarea');
      input.className = 'inline-edit-textarea';
      input.value = currentText;
      // Auto-size based on content
      input.rows = Math.min(18, Math.max(6, currentText.split('\n').length + 1));
      input.spellcheck = false;
    } else {
      // title, assignee, tags — plain text input
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'inline-edit-input';
      input.value = currentText;
    }

    return input;
  }

  // Extract the "current value" from an editable element's inner text/content.
  // For badge/pill elements we parse the text content; for plain text we use textContent.
  function extractCurrentText(el, field) {
    if (field === 'tags') {
      // Tags are rendered as multiple .tag-pill spans — collect their text
      var pills = el.querySelectorAll('.tag-pill');
      return Array.from(pills).map(function (p) { return p.textContent.trim(); }).join(', ');
    }
    if (field === 'description') return el.dataset.markdown;
    return el.textContent.trim();
  }

  function createActionButtons(el, field, input) {
    var actions = document.createElement('span');
    actions.className = 'inline-edit-actions';
    var description = field === 'description';

    [['Save', '✓', 'save'], ['Cancel', '×', 'cancel']].forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = description ? 'quiet-button' : 'inline-edit-btn inline-edit-btn-' + action[2];
      button.setAttribute('aria-label', action[0]);
      button.textContent = description ? action[0] : action[1];
      button.addEventListener('mousedown', function (e) { e.preventDefault(); });
      button.addEventListener('click', function () {
        if (action[2] === 'save') commitEdit(el, field, input.value);
        else cancelEdit(el, true);
      });
      actions.appendChild(button);
    });
    return actions;
  }

  function beginEdit(el) {
    if (editingState.has(el)) return;
    var field = el.dataset.field;
    var description = field === 'description';
    var input = createInput(field, extractCurrentText(el, field));
    var trigger = description ? el.parentElement.querySelector('[data-edit-description]') : null;
    var select = input.tagName === 'SELECT';
    var state = {
      original: Array.from(el.childNodes),
      value: input.value,
      trigger: trigger,
      saving: false,
      keys: new AbortController()
    };
    editingState.set(el, state);
    input.setAttribute('aria-label', 'Edit ' + field);
    el.classList.add('editing');

    if (select) {
      el.replaceChildren(input);
      input.addEventListener('change', function () { commitEdit(el, field, input.value); });
      input.addEventListener('blur', function () { cancelEdit(el, false); });
    } else {
      var wrapper = document.createElement(description ? 'div' : 'span');
      wrapper.className = 'inline-edit-wrapper';
      wrapper.append(input, createActionButtons(el, field, input));
      el.replaceChildren(wrapper);
    }

    input.focus({ preventScroll: !description });
    if (!select && !description) input.select();
    if (trigger) trigger.disabled = true;

    el.addEventListener('keydown', function onEditKey(e) {
      if (editingState.get(el) !== state) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit(el, true);
      } else if (e.key === 'Enter' && e.target === input && !select
          && (!description || e.metaKey || e.ctrlKey) && !e.isComposing) {
        e.preventDefault();
        commitEdit(el, field, input.value);
      }
    }, { signal: state.keys.signal });

    if (!description && !select) {
      el.addEventListener('focusout', function (e) {
        if (editingState.get(el) === state && !el.contains(e.relatedTarget)) {
          commitEdit(el, field, input.value);
        }
      }, { signal: state.keys.signal });
    }
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-edit-description]');
    if (trigger) {
      beginEdit(trigger.closest('.description-section').querySelector('[data-editable]'));
      return;
    }
    if (e.target.closest('a, button, input, select, textarea')) return;
    var el = e.target.closest('[data-editable]:not([data-field="description"])');
    if (el && window.getSelection().isCollapsed) beginEdit(el);
  });

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (!e.target.matches('[data-editable][tabindex]')) return;
    e.preventDefault();
    beginEdit(e.target);
  });

  // --- Board drag-and-drop ---

  // Track the card being dragged and its original column for revert on failure.
  var dragState = null;

  // Find the nearest .board-column ancestor of an element (or null).
  function getBoardColumn(el) {
    return el ? el.closest('.board-column') : null;
  }

  // dragstart: capture source info and add .dragging class
  document.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.board-card[data-task-id]');
    if (!card || card.classList.contains('drag-pending')) return;

    var sourceColumn = getBoardColumn(card);
    if (!sourceColumn) return;

    dragState = {
      card: card,
      taskId: card.getAttribute('data-task-id'),
      sourceColumn: sourceColumn,
    };

    card.classList.add('dragging');
    // Store task ID in dataTransfer so it works across iframes/tabs if needed
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragState.taskId);
  });

  // dragover: allow drop and highlight the target column
  document.addEventListener('dragover', function (e) {
    if (!dragState) return;
    var col = getBoardColumn(e.target);
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Remove drag-over from all columns, add to current target
    document.querySelectorAll('.board-column.drag-over').forEach(function (c) {
      if (c !== col) c.classList.remove('drag-over');
    });
    col.classList.add('drag-over');
  });

  // dragleave: remove highlight when leaving a column
  document.addEventListener('dragleave', function (e) {
    if (!dragState) return;
    var col = getBoardColumn(e.target);
    if (!col) return;
    // Only remove if we've actually left the column (relatedTarget is outside it)
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove('drag-over');
    }
  });

  // dragend: always clean up .dragging and any leftover .drag-over classes
  document.addEventListener('dragend', function (e) {
    if (!dragState) return;
    dragState.card.classList.remove('dragging');
    document.querySelectorAll('.board-column.drag-over').forEach(function (c) {
      c.classList.remove('drag-over');
    });
    // dragState is cleared in drop handler or here if drop didn't fire
    dragState = null;
  });

  // drop: move the card and PATCH the API
  document.addEventListener('drop', function (e) {
    if (!dragState) return;
    e.preventDefault();

    var targetColumn = getBoardColumn(e.target);
    if (!targetColumn) {
      // Dropped outside a column — clean up and bail
      dragState.card.classList.remove('dragging');
      document.querySelectorAll('.board-column.drag-over').forEach(function (c) {
        c.classList.remove('drag-over');
      });
      dragState = null;
      return;
    }

    targetColumn.classList.remove('drag-over');

    var card = dragState.card;
    dragState = null;
    card.classList.remove('dragging');
    moveCard(card, targetColumn, false);
  });

  function updateColumnCount(column) {
    var cards = column.querySelector('.column-cards');
    var count = cards.querySelectorAll('.board-card').length;
    column.querySelector('.column-count').textContent = count;
    var empty = cards.querySelector('.column-empty');
    if (!empty && count === 0) {
      empty = document.createElement('p');
      empty.className = 'column-empty';
      empty.textContent = 'No issues';
      cards.appendChild(empty);
    }
    if (empty && count > 0) empty.remove();
  }

  function moveCard(card, targetColumn, keepFocus) {
    var sourceColumn = getBoardColumn(card);
    if (sourceColumn === targetColumn || card.classList.contains('drag-pending')) return;
    var sourceCards = card.parentNode;
    var nextCard = card.nextElementSibling;
    var targetStatus = targetColumn.dataset.status;
    targetColumn.querySelector('.column-cards').appendChild(card);
    card.classList.add('drag-pending');
    updateColumnCount(sourceColumn);
    updateColumnCount(targetColumn);
    if (keepFocus) card.focus();

    fetch('/api/tasks/' + encodeURIComponent(card.dataset.taskId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetStatus })
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      card.classList.remove('drag-pending');
    }).catch(function () {
      sourceCards.insertBefore(card, nextCard && nextCard.parentNode === sourceCards ? nextCard : null);
      card.classList.remove('drag-pending');
      updateColumnCount(sourceColumn);
      updateColumnCount(targetColumn);
      if (keepFocus) card.focus();
      card.classList.add('drag-error');
      setTimeout(function () { card.classList.remove('drag-error'); }, 700);
      showToast('Could not move the issue', 'error');
    });
  }

  // --- Global keydown handler ---

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;
    var key = e.key;

    // Always allow Escape to close overlay or blur
    if (key === 'Escape') {
      var taskModal = document.getElementById('task-modal');
      if (taskModal && taskModal.open) {
        taskModal.close();
        return;
      }
      var dlg = document.getElementById('help-overlay');
      if (dlg && dlg.open) {
        dlg.close();
        return;
      }
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      return;
    }

    if (isTypingTarget(document.activeElement)) return;
    if (key === '?') {
      toggleHelp();
      return;
    }

    if (document.querySelector('dialog[open]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var path = currentPath();

    if (key === 'n') {
      htmx.ajax('GET', '/tasks/new/modal', { target: '#task-modal', swap: 'innerHTML' });
      return;
    }

    if (key === '/') {
      e.preventDefault();
      var search = document.getElementById('search-input');
      if (search) search.focus();
      return;
    }

    // Task list navigation
    if (path === '/tasks' || path.startsWith('/tasks?')) {
      var rows = getListRows();
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        var idx = getFocusedRowIndex(rows);
        focusRow(rows, idx === -1 ? 0 : idx + 1);
        return;
      }
      if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        var idx2 = getFocusedRowIndex(rows);
        focusRow(rows, idx2 === -1 ? 0 : idx2 - 1);
        return;
      }
      if (key === 'Enter') {
        openFocusedRow(rows);
        return;
      }
    }

    // Board navigation
    if (path === '/board' || path.startsWith('/board?')) {
      var cards = getBoardCards();
      if (key === 'ArrowDown' || key === 'ArrowRight') {
        // Shift+Right is reserved for keyboard DnD (move card to next column)
        if (e.shiftKey) {
          // handled below in the board-card keydown section
        } else {
          e.preventDefault();
          var ci = getFocusedCardIndex(cards);
          focusCard(cards, ci === -1 ? 0 : ci + 1);
        }
        return;
      }
      if (key === 'ArrowUp' || key === 'ArrowLeft') {
        if (e.shiftKey) {
          // handled below in the board-card keydown section
        } else {
          e.preventDefault();
          var ci2 = getFocusedCardIndex(cards);
          focusCard(cards, ci2 === -1 ? 0 : ci2 - 1);
        }
        return;
      }
      if (key === 'Enter') {
        var ci3 = getFocusedCardIndex(cards);
        if (ci3 !== -1 && document.activeElement === cards[ci3]) {
          e.preventDefault();
          cards[ci3].querySelector('a').click();
        }
        return;
      }
    }
  });

  // --- Board keyboard drag-and-drop (Shift+Arrow) ---
  // When a .board-card has focus, Shift+Left/Right moves it to the adjacent status column.
  // Column order for keyboard moves: open → in_progress → done (skip blocked — set by deps).

  var KEYBOARD_DND_COLUMN_ORDER = ['open', 'in_progress', 'done'];

  document.addEventListener('keydown', function (e) {
    if (!e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

    var card = document.activeElement.closest('.board-card');
    if (!card) return;
    var column = getBoardColumn(card);
    var current = KEYBOARD_DND_COLUMN_ORDER.indexOf(column.dataset.status);
    if (current < 0) return;
    var direction = e.key === 'ArrowRight' ? 1 : -1;
    var status = KEYBOARD_DND_COLUMN_ORDER[current + direction];
    if (!status) return;
    e.preventDefault();
    var target = column.parentElement.querySelector('.board-column[data-status="' + status + '"]');
    if (target) moveCard(card, target, true);
  });
})();
