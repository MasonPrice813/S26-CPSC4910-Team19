(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────
  let currentPage = 1;
  const PAGE_SIZE = 50;

  const filters = {
    range:   '7d',
    from:    null,
    to:      null,
    sponsor: '',
    events:  [],
    status:  '',
    search:  '',
  };

  // ── DOM refs ─────────────────────────────────────────────────
  const tbody         = document.getElementById('logTableBody');
  const emptyState    = document.getElementById('emptyState');
  const loadingState  = document.getElementById('loadingState');
  const errorState    = document.getElementById('errorState');
  const errorMsg      = document.getElementById('errorMsg');
  const totalCount    = document.getElementById('totalCount');
  const paginationEl  = document.getElementById('pagination');
  const pageInfo      = document.getElementById('pageInfo');
  const customDateRow = document.getElementById('customDateRow');
  const filterFrom    = document.getElementById('filterFrom');
  const filterTo      = document.getElementById('filterTo');
  const filterSearch  = document.getElementById('filterSearch');
  const btnApply      = document.getElementById('btnApply');
  const btnReset      = document.getElementById('btnReset');
  const btnPrev       = document.getElementById('btnPrev');
  const btnNext       = document.getElementById('btnNext');

  // ── Chip group helper ────────────────────────────────────────
  function initChipGroup(rowId, dataAttr, onSelect) {
    document.getElementById(rowId).addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.getElementById(rowId)
        .querySelectorAll('.chip')
        .forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      onSelect(chip.dataset[dataAttr]);
    });
  }

  // ── Wire chip groups ─────────────────────────────────────────
  initChipGroup('chipRange', 'range', value => {
    filters.range = value;
    filters.from  = null;
    filters.to    = null;
    filterFrom.value = '';
    filterTo.value   = '';
    customDateRow.style.display = value === 'custom' ? 'flex' : 'none';
  });

  filterFrom.addEventListener('change', () => { filters.from = filterFrom.value || null; });
  filterTo.addEventListener('change',   () => { filters.to   = filterTo.value   || null; });

  initChipGroup('chipSponsor', 'sponsor', value => { filters.sponsor = value; });

  const chipEventRow = document.getElementById('chipEvent');

  chipEventRow.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;

    const value = chip.dataset.event || '';
    const allChip = chipEventRow.querySelector('.chip[data-event=""]');

    //Clicking "All"
    if (value === '') {
      filters.events = [];
      chipEventRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      allChip.classList.add('active');
      return;
    }

    //Turn off "All" when selecting specific types
    allChip.classList.remove('active');
    chip.classList.toggle('active');

    const activeSpecific = Array.from(
      chipEventRow.querySelectorAll('.chip.active[data-event]')
    )
      .map(c => c.dataset.event)
      .filter(v => v);

    filters.events = activeSpecific;

    //If nothing selected, fall back to All
    if (filters.events.length === 0) {
      allChip.classList.add('active');
    }
  });

  initChipGroup('chipStatus',  'status',  value => { filters.status  = value; });

  // ── Preset range → date params ───────────────────────────────
  function rangeToDateParams() {
    if (filters.range === 'custom') {
      return { date_from: filters.from, date_to: filters.to };
    }
    if (filters.range === 'all') return {};

    const now   = new Date();
    const pad   = n => String(n).padStart(2, '0');
    const fmt   = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const start = new Date(now);

    if (filters.range === '1d')  start.setDate(start.getDate() - 1);
    if (filters.range === '7d')  start.setDate(start.getDate() - 7);
    if (filters.range === '30d') start.setDate(start.getDate() - 30);
    if (filters.range === '6m')  start.setMonth(start.getMonth() - 6);

    return { date_from: fmt(start), date_to: fmt(now) };
  }

  // ── Build query string ───────────────────────────────────────
  function buildQuery(page) {
    const p = new URLSearchParams();
    const { date_from, date_to } = rangeToDateParams();

    if (filters.events.length) { p.set('event_types', filters.events.join(',')); }
    if (filters.sponsor) p.set('sponsor',    filters.sponsor);
    if (filters.status)  p.set('status',     filters.status);
    if (date_from)       p.set('date_from',  date_from);
    if (date_to)         p.set('date_to',    date_to);

    const search = filterSearch.value.trim();
    if (search) p.set('search', search);

    p.set('page',  page);
    p.set('limit', PAGE_SIZE);
    return p.toString();
  }

  // ── Load sponsor chips ───────────────────────────────────────
  // Queries user_sponsors for distinct sponsor names via the API.
  async function loadSponsorChips() {
    try {
      const res  = await fetch('/api/admin/audit-logs/sponsors');
      if (!res.ok) return;
      const list = await res.json();
      const row  = document.getElementById('chipSponsor');

      list.forEach(name => {
        const btn = document.createElement('button');
        btn.className       = 'chip';
        btn.dataset.sponsor = name;
        btn.textContent     = name;
        row.appendChild(btn);
      });
    } catch (_) { /* non-critical — chips just won't show */ }
  }

  // ── Render helpers ───────────────────────────────────────────
  const EVENT_LABELS = {
    login: 'Login',
    login_failed: 'Login Failed',
    purchase: 'Purchase',
    driver_application: 'Application',
    account_created: 'Account Created',
  };

  const EVENT_CLASSES = {
    login: 'badge-login',
    login_failed: 'badge-login-failed',
    purchase: 'badge-purchase',
    driver_application: 'badge-application',
    account_created: 'badge-account',
  };
  
  const STATUS_CLASSES = {
    success: 'status-success', failure: 'status-failure', pending: 'status-pending',
  };

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // Render points spent cell — only meaningful for purchases
  function renderPoints(row) {
    if (row.event_type !== 'purchase') {
      return '<span class="points-na">—</span>';
    }
    const pts = row.metadata?.points_spent;
    if (pts == null) return '<span class="points-na">—</span>';
    return `<span class="points-spent">${Number(pts).toLocaleString()} pts</span>`;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

  // ── Render rows ──────────────────────────────────────────────
  function renderRows(rows) {
    tbody.innerHTML = '';

    if (!rows.length) {
      emptyState.hidden   = false;
      paginationEl.hidden = true;
      return;
    }
    emptyState.hidden = true;

    rows.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Date">${fmtDate(row.created_at)}</td>
        <td data-label="Event">
          <span class="badge ${EVENT_CLASSES[row.event_type] ?? ''}">
            ${EVENT_LABELS[row.event_type] ?? esc(row.event_type)}
          </span>
        </td>
        <td data-label="User">
          <span class="user-name">${esc((row.user_name || '').trim() || '—')}</span>
          <span class="user-email">${esc(row.user_email || '—')}</span>
        </td>
        <td data-label="Sponsor">${esc(row.sponsor_name || '—')}</td>
        <td data-label="Description">${esc(row.description || '—')}</td>
        <td data-label="Points Spent">${renderPoints(row)}</td>
        <td data-label="Status">
          <span class="status-dot ${STATUS_CLASSES[row.status] ?? ''}">
            ${cap(row.status)}
          </span>
        </td>
        <td data-label="IP">${esc(row.ip_address || '—')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Render pagination ────────────────────────────────────────
  function renderPagination({ total, page, pages, limit }) {
    if (pages <= 1) { paginationEl.hidden = true; return; }
    paginationEl.hidden = false;
    const from = Math.min((page - 1) * limit + 1, total);
    const to   = Math.min(page * limit, total);
    pageInfo.textContent = `${from}–${to} of ${total.toLocaleString()}`;
    btnPrev.disabled = page <= 1;
    btnNext.disabled = page >= pages;
  }

  // ── Fetch ────────────────────────────────────────────────────
  async function fetchLogs(page = 1) {
    currentPage = page;
    tbody.innerHTML     = '';
    loadingState.hidden = false;
    emptyState.hidden   = true;
    errorState.hidden   = true;
    paginationEl.hidden = true;

    try {
      const res = await fetch(`/api/admin/audit-logs?${buildQuery(page)}`);
      loadingState.hidden = true;

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const json = await res.json();
      totalCount.textContent =
        `${json.pagination.total.toLocaleString()} event${json.pagination.total === 1 ? '' : 's'}`;
      renderRows(json.data);
      renderPagination(json.pagination);
    } catch (err) {
      loadingState.hidden = true;
      errorState.hidden   = false;
      errorMsg.textContent = err.message;
      console.error('audit-logs fetch error:', err);
    }
  }

  // ── Apply / Reset / Pagination / Search enter ────────────────
  btnApply.addEventListener('click', () => fetchLogs(1));

  btnReset.addEventListener('click', () => {
    filters.range   = '7d';
    filters.from    = null;
    filters.to      = null;
    filters.sponsor = '';
    filters.events  = [];
    filters.status  = '';
    filterSearch.value = '';
    filterFrom.value   = '';
    filterTo.value     = '';
    customDateRow.style.display = 'none';

    [
      { rowId: 'chipRange',   attr: 'range',   val: '7d' },
      { rowId: 'chipSponsor', attr: 'sponsor', val: ''   },
      { rowId: 'chipEvent',   attr: 'event',   val: ''   },
      { rowId: 'chipStatus',  attr: 'status',  val: ''   },
    ].forEach(({ rowId, attr, val }) => {
      document.getElementById(rowId)
        .querySelectorAll('.chip')
        .forEach(c => c.classList.toggle('active', c.dataset[attr] === val));
    });

    fetchLogs(1);
  });

  btnPrev.addEventListener('click', () => fetchLogs(currentPage - 1));
  btnNext.addEventListener('click', () => fetchLogs(currentPage + 1));
  filterSearch.addEventListener('keydown', e => { if (e.key === 'Enter') fetchLogs(1); });

  // ── Init ─────────────────────────────────────────────────────
  async function init() {
    try {
      const meRes = await fetch('/api/me', { credentials: 'same-origin' });

      if (!meRes.ok) {
        window.location.href = '/Website/login.html';
        return;
      }

      const me = await meRes.json();

      if (me.role !== 'Admin') {
        alert('This page is only accessible to admin users.');
        window.location.href = '/Website/catalog.html';
        return;
      }
      document.body.classList.add('authorized');
      await loadSponsorChips();
      await fetchLogs(1);
    } catch (err) {
      console.error('audit-logs init error:', err);
      window.location.href = '/Website/login.html';
    }
  }

  init();

})();
