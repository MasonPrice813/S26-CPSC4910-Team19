(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────
  let currentPage = 1;
  let totalPages  = 1;
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
  const tbody               = document.getElementById('logTableBody');
  const emptyState          = document.getElementById('emptyState');
  const loadingState        = document.getElementById('loadingState');
  const errorState          = document.getElementById('errorState');
  const errorMsg            = document.getElementById('errorMsg');
  const totalCount          = document.getElementById('totalCount');
  const paginationEl        = document.getElementById('pagination');
  const pageInfo            = document.getElementById('pageInfo');
  const customDateRow       = document.getElementById('customDateRow');
  const filterFrom          = document.getElementById('filterFrom');
  const filterTo            = document.getElementById('filterTo');
  const filterSearch        = document.getElementById('filterSearch');
  const btnApply            = document.getElementById('btnApply');
  const btnReset            = document.getElementById('btnReset');
  const btnPrev             = document.getElementById('btnPrev');
  const btnNext             = document.getElementById('btnNext');
  const accessPanel         = document.getElementById('accessPanel');
  const accessDeniedBox     = document.getElementById('accessDeniedBox');
  const filterPanel         = document.getElementById('filterPanel');
  const tableSection        = document.getElementById('tableSection');
  const scopeNotice         = document.getElementById('scopeNotice');
  const sponsorFilterSection  = document.getElementById('sponsorFilterSection');
  const sponsorFilterDivider2 = document.getElementById('sponsorFilterDivider2');
  const btnExportPdf        = document.getElementById('btnExportPdf');
  const btnExportCsv        = document.getElementById('btnExportCsv');

  // ── Chip group helper ────────────────────────────────────────
  function initChipGroup(rowId, dataAttr, onSelect) {
    document.getElementById(rowId).addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.getElementById(rowId).querySelectorAll('.chip')
        .forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      onSelect(chip.dataset[dataAttr]);
    });
  }

  // ── Wire filter chips ────────────────────────────────────────
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

  // Multi-select event type chips
  const chipEventRow = document.getElementById('chipEvent');
  chipEventRow.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const value   = chip.dataset.event || '';
    const allChip = chipEventRow.querySelector('.chip[data-event=""]');

    if (value === '') {
      filters.events = [];
      chipEventRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      allChip.classList.add('active');
      return;
    }

    allChip.classList.remove('active');
    chip.classList.toggle('active');

    filters.events = Array.from(
      chipEventRow.querySelectorAll('.chip.active[data-event]')
    ).map(c => c.dataset.event).filter(v => v);

    if (filters.events.length === 0) allChip.classList.add('active');
  });

  initChipGroup('chipStatus', 'status', value => { filters.status = value; });

  // ── Access control panel ─────────────────────────────────────
  function setAccessChip(role, level) {
    const row = document.getElementById(`accessChip${role.charAt(0).toUpperCase() + role.slice(1)}`);
    if (!row) return;
    row.querySelectorAll('.access-chip').forEach(c => {
      c.classList.remove('active-all', 'active-own', 'active-none');
      if (c.dataset.level === level) c.classList.add(`active-${level}`);
    });
  }

  async function loadAccessSettings() {
    try {
      const res = await fetch('/api/admin/audit-access-settings');
      if (!res.ok) return;
      const settings = await res.json();
      setAccessChip('sponsor', settings.sponsor);
      setAccessChip('driver',  settings.driver);
    } catch (_) {}
  }

  function flashSaved(indicatorId) {
    const el = document.getElementById(indicatorId);
    if (!el) return;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
  }

  ['Sponsor', 'Driver'].forEach(role => {
    const row = document.getElementById(`accessChip${role}`);
    if (!row) return;
    row.addEventListener('click', async e => {
      const chip = e.target.closest('.access-chip');
      if (!chip) return;
      setAccessChip(chip.dataset.role, chip.dataset.level);
      try {
        const res = await fetch('/api/admin/audit-access-settings', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ role_type: chip.dataset.role, access_level: chip.dataset.level }),
        });
        if (res.ok) flashSaved(`saveIndicator${role}`);
      } catch (_) {}
    });
  });

  // ── Sponsor chips — load dynamically (admin only) ────────────
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
    } catch (_) {}
  }

  // ── Range → date params ──────────────────────────────────────
  function rangeToDateParams() {
    if (filters.range === 'custom') return { date_from: filters.from, date_to: filters.to };
    if (filters.range === 'all')    return {};
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

  function buildQuery(page) {
    const p = new URLSearchParams();
    const { date_from, date_to } = rangeToDateParams();
    if (filters.events.length) p.set('event_types', filters.events.join(','));
    if (filters.sponsor)       p.set('sponsor',     filters.sponsor);
    if (filters.status)        p.set('status',      filters.status);
    if (date_from)             p.set('date_from',   date_from);
    if (date_to)               p.set('date_to',     date_to);
    const search = filterSearch.value.trim();
    if (search) p.set('search', search);
    p.set('page', page);
    p.set('limit', PAGE_SIZE);
    return p.toString();
  }

  // ── Render ───────────────────────────────────────────────────
  const EVENT_LABELS = {
    login: 'Login', login_failed: 'Login Failed', purchase: 'Purchase',
    driver_application: 'Application', account_created: 'Account Created',
  };
  const EVENT_CLASSES = {
    login: 'badge-login', login_failed: 'badge-login-failed', purchase: 'badge-purchase',
    driver_application: 'badge-application', account_created: 'badge-account',
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

  function renderPoints(row) {
    if (row.event_type !== 'purchase') return '<span class="points-na">—</span>';
    const pts = row.metadata?.points_spent;
    if (pts == null) return '<span class="points-na">—</span>';
    return `<span class="points-spent">${Number(pts).toLocaleString()} pts</span>`;
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

  function renderRows(rows) {
    tbody.innerHTML = '';
    if (!rows.length) { emptyState.hidden = false; paginationEl.hidden = true; return; }
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

  function renderPagination({ total, page, pages, limit }) {
    totalPages = Math.max(1, Number(pages || 1));
    if (total <= PAGE_SIZE || totalPages <= 1) {
      paginationEl.hidden       = true;
      btnPrev.style.display     = 'none';
      btnNext.style.display     = 'none';
      return;
    }
    paginationEl.hidden       = false;
    btnPrev.style.display     = 'inline-block';
    btnNext.style.display     = 'inline-block';
    const from = Math.min((page - 1) * limit + 1, total);
    const to   = Math.min(page * limit, total);
    pageInfo.textContent  = `${from}–${to} of ${total.toLocaleString()}`;
    btnPrev.disabled = page <= 1;
    btnNext.disabled = page >= totalPages;
  }

  // ── Fetch ────────────────────────────────────────────────────
  async function fetchLogs(page = 1) {
    currentPage = page;
    tbody.innerHTML     = '';
    loadingState.hidden = false;
    emptyState.hidden   = true;
    errorState.hidden   = true;
    paginationEl.hidden = true;
    btnPrev.disabled    = true;
    btnNext.disabled    = true;

    try {
      const res = await fetch(`/api/admin/audit-logs?${buildQuery(page)}`);
      loadingState.hidden = true;

      // 403 means admin has disabled access for this role
      if (res.status === 403) {
        filterPanel.style.display  = 'none';
        tableSection.style.display = 'none';
        accessDeniedBox.style.display = 'block';
        totalCount.textContent = '';
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const json  = await res.json();
      const pages = Math.max(1, Number(json?.pagination?.pages || 1));

      if (page > pages) {
        currentPage = pages;
        await fetchLogs(pages);
        return;
      }

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

  // ── Buttons ──────────────────────────────────────────────────
  btnApply.addEventListener('click', () => fetchLogs(1));

  btnReset.addEventListener('click', () => {
    filters.range = '7d'; filters.from = null; filters.to = null;
    filters.sponsor = ''; filters.events = []; filters.status = '';
    filterSearch.value = ''; filterFrom.value = ''; filterTo.value = '';
    customDateRow.style.display = 'none';
    [
      { rowId: 'chipRange',   attr: 'range',   val: '7d' },
      { rowId: 'chipSponsor', attr: 'sponsor', val: ''   },
      { rowId: 'chipEvent',   attr: 'event',   val: ''   },
      { rowId: 'chipStatus',  attr: 'status',  val: ''   },
    ].forEach(({ rowId, attr, val }) => {
      document.getElementById(rowId).querySelectorAll('.chip')
        .forEach(c => c.classList.toggle('active', c.dataset[attr] === val));
    });
    fetchLogs(1);
  });

  btnPrev.addEventListener('click', () => { if (currentPage > 1) fetchLogs(currentPage - 1); });
  btnNext.addEventListener('click', () => { if (currentPage < totalPages) fetchLogs(currentPage + 1); });
  filterSearch.addEventListener('keydown', e => { if (e.key === 'Enter') fetchLogs(1); });
  btnExportPdf?.addEventListener("click", exportAuditLogsPdf);
  btnExportCsv?.addEventListener("click", exportAuditLogsCsv);

  // ── Init ─────────────────────────────────────────────────────
  async function init() {
    try {
      const meRes = await fetch('/api/me', { credentials: 'same-origin' });
      if (!meRes.ok) { window.location.href = '/Website/login.html'; return; }
      const me = await meRes.json();

      if (me.role === 'Admin') {
        // Show access control panel + sponsor filter
        accessPanel.style.display           = 'block';
        sponsorFilterSection.style.display  = 'block';
        sponsorFilterDivider2.style.display = 'block';
        await loadAccessSettings();
        await loadSponsorChips();

      } else if (me.role === 'Sponsor') {
        // Check what access level admin has granted sponsors
        const settingsRes = await fetch('/api/admin/audit-access-settings');
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          if (settings.sponsor === 'none') {
            // Will be handled by 403 from fetchLogs, but show denied early
            filterPanel.style.display  = 'none';
            tableSection.style.display = 'none';
            accessDeniedBox.style.display = 'block';
            totalCount.textContent = '';
            document.body.classList.add('authorized');
            return;
          }
          if (settings.sponsor === 'own') {
            scopeNotice.style.display   = 'block';
            scopeNotice.textContent     = `Showing logs for your organization (${me.sponsor}) only.`;
          }
        }

      } else if (me.role === 'Driver') {
        const settingsRes = await fetch('/api/admin/audit-access-settings');
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          if (settings.driver === 'none') {
            filterPanel.style.display  = 'none';
            tableSection.style.display = 'none';
            accessDeniedBox.style.display = 'block';
            totalCount.textContent = '';
            document.body.classList.add('authorized');
            return;
          }
          if (settings.driver === 'own') {
            scopeNotice.style.display = 'block';
            scopeNotice.textContent   = 'Showing your own activity only.';
          }
        }

      } else {
        // Unknown role — redirect
        window.location.href = '/Website/catalog.html';
        return;
      }

      document.body.classList.add('authorized');
      await fetchLogs(1);
    } catch (err) {
      console.error('audit-logs init error:', err);
      window.location.href = '/Website/login.html';
    }
  }
    async function exportAuditLogsPdf() {
    try {
      const payload = {
        event_types: Array.isArray(filters.events) ? filters.events : [],
        sponsor: filters.sponsor || "",
        status: filters.status || "",
        search: (filterSearch?.value || "").trim(),
        ...rangeToDateParams()
      };

      const response = await fetch("/api/admin/audit-logs/pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        alert(err.error || "Failed to generate PDF report.");
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-log-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Audit log PDF export error:", err);
      alert("Failed to generate PDF report.");
    }
  }

  async function exportAuditLogsCsv() {
    try {
      const payload = {
        event_types: Array.isArray(filters.events) ? filters.events : [],
        sponsor: filters.sponsor || "",
        status: filters.status || "",
        search: (filterSearch?.value || "").trim(),
        ...rangeToDateParams()
      };

      const response = await fetch("/api/admin/audit-logs/csv", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        alert(err.error || "Failed to generate CSV report.");
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-log-report.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Audit log CSV export error:", err);
      alert("Failed to generate CSV report.");
    }
  }

  init();

})();