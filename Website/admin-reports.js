const adminChartCtx = document.getElementById("adminPointsChart")?.getContext("2d");
let adminPointsChart = null;
let adminDriversCache = [];

const pointsAnalyticsSection = document.getElementById("pointsAnalyticsSection");
const pointsTimeView = document.getElementById("pointsTimeView");
const pointsDriverFilter = document.getElementById("pointsDriverFilter");
const pointsChartHint = document.getElementById("pointsChartHint");

async function getJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `${url} -> ${res.status}`);
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

async function loadMe() {
  const me = await getJSON("/api/me");
  const meBadge = document.getElementById("meBadge");
  const sponsorText = me.sponsor ? ` • ${me.sponsor}` : "";
  meBadge.textContent = `Logged in as: ${me.role}${sponsorText}`;

  if (me.role !== "Admin") {
    window.location.href = "/Website/catalog.html";
  }
}

async function loadSponsors() {
  const select = document.getElementById("sponsorFilter");
  const sponsors = await getJSON("/api/admin/sponsors");

  select.innerHTML = `<option value="">All Sponsors</option>`;

  sponsors.forEach(s => {
    const option = document.createElement("option");
    option.value = s.sponsor;
    option.textContent = s.sponsor;
    select.appendChild(option);
  });
}

async function loadDrivers() {
  const sponsor = document.getElementById("sponsorFilter").value;
  const transactionDriverSelect = document.getElementById("driverFilter");

  let url = "/api/admin/drivers";
  if (sponsor) {
    url += `?sponsor=${encodeURIComponent(sponsor)}`;
  }

  const drivers = await getJSON(url);
  adminDriversCache = Array.isArray(drivers) ? drivers : [];

  transactionDriverSelect.innerHTML = `<option value="">All Drivers</option>`;

  adminDriversCache.forEach(d => {
    const option = document.createElement("option");
    option.value = d.user_id;
    option.textContent = `${d.first_name} ${d.last_name}`;
    transactionDriverSelect.appendChild(option);
  });

  populatePointsDriverFilter(adminDriversCache);
}

async function loadTransactions() {
  const sponsor = document.getElementById("sponsorFilter").value;
  const driver = document.getElementById("driverFilter").value;
  const range = document.getElementById("rangeFilter").value;
  const tbody = document.getElementById("tableBody");
  const status = document.getElementById("statusMsg");

  status.textContent = "Loading transactions...";
  tbody.innerHTML = "";

  try {
    const params = new URLSearchParams();
    if (sponsor) params.append("sponsor", sponsor);
    if (driver) params.append("driver_id", driver);
    if (range) params.append("range", range);

    const url = `/api/admin/transactions${params.toString() ? `?${params.toString()}` : ""}`;
    const data = await getJSON(url);

    status.textContent = `${data.length} transaction(s) found.`;

    if (!data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="padding:12px 10px;" class="muted">No transactions found.</td>
        </tr>
      `;
      return;
    }

    data.forEach(t => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td style="padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.10);">${esc(t.sponsor)}</td>
        <td style="padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.10);">${esc(t.first_name)} ${esc(t.last_name)}</td>
        <td style="padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.10);">${esc(t.product_id)}</td>
        <td style="padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.10);">${esc(t.point_cost)}</td>
        <td style="padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.10);">$${t.dollar_cost ? Number(t.dollar_cost).toFixed(2) : "—"}</td>
        <td style="padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.10);">${new Date(t.date_ordered).toLocaleDateString()}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    status.textContent = err.message || "Failed to load transactions.";
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding:12px 10px;" class="muted">Failed to load transactions.</td>
      </tr>
    `;
  }
}

async function loadDriverSponsorAffiliations() {
  const tbody = document.getElementById("driverSponsorsTableBody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="3" style="padding:12px 10px;" class="muted">Loading driver sponsor affiliations...</td>
    </tr>
  `;

  try {
    const rows = await getJSON("/api/admin/driver-sponsors");

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" style="padding:12px 10px;" class="muted">No driver sponsor affiliations found.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = "";

    rows.forEach(row => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.10);">
          ${esc(row.first_name)} ${esc(row.last_name)}
        </td>
        <td style="padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.10);">
          ${esc(row.email)}
        </td>
        <td style="padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.10);">
          ${esc(row.sponsors || "—")}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="padding:12px 10px;" class="muted">Failed to load driver sponsor affiliations.</td>
      </tr>
    `;
  }
}

function populatePointsDriverFilter(drivers) {
  if (!pointsDriverFilter) return;

  pointsDriverFilter.innerHTML = `<option value="all">All Drivers (Average)</option>`;

  drivers.forEach(d => {
    const option = document.createElement("option");
    option.value = d.driver_id;
    option.textContent = `${d.first_name} ${d.last_name}`;
    pointsDriverFilter.appendChild(option);
  });
}

async function fetchAdminPointsData(view, driverId, sponsor) {
  if (!sponsor) return [];

  const params = new URLSearchParams({
    view,
    driver: driverId,
    sponsor
  });

  try {
    return await getJSON(`/api/admin/points?${params.toString()}`);
  } catch (err) {
    console.error("Failed to load admin points data:", err);
    return [];
  }
}

async function renderAdminPointsChart() {
  if (!adminChartCtx || !pointsTimeView || !pointsDriverFilter) return;

  const sponsor = document.getElementById("sponsorFilter").value;
  if (!sponsor) {
    if (adminPointsChart) {
      adminPointsChart.destroy();
      adminPointsChart = null;
    }
    if (pointsAnalyticsSection) pointsAnalyticsSection.style.display = "none";
    if (pointsChartHint) {
      pointsChartHint.textContent = "Select a sponsor to view the points history chart.";
    }
    return;
  }

  if (pointsAnalyticsSection) pointsAnalyticsSection.style.display = "block";
  if (pointsChartHint) {
    pointsChartHint.textContent = `Viewing point history for ${sponsor}.`;
  }

  const view = pointsTimeView.value;
  const driverId = pointsDriverFilter.value || "all";

  const data = await fetchAdminPointsData(view, driverId, sponsor);
  const labels = data.map(d => d.label);
  const values = data.map(d => d.value);

  if (adminPointsChart) {
    adminPointsChart.destroy();
  }

  adminPointsChart = new Chart(adminChartCtx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: driverId === "all"
          ? `Average Points (${sponsor})`
          : `Driver Points (${sponsor})`,
        data: values,
        borderWidth: 3,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  loadMe().catch(console.warn);

  document.getElementById("backBtn").addEventListener("click", () => {
    window.location.href = "/Website/catalog.html";
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "/Website/login.html";
  });

  document.getElementById("sponsorFilter").addEventListener("change", async () => {
    document.getElementById("driverFilter").value = "";
    await loadDrivers();
    await loadTransactions();
    await renderAdminPointsChart();
  });

  document.getElementById("driverFilter").addEventListener("change", loadTransactions);
  document.getElementById("rangeFilter").addEventListener("change", loadTransactions);

  pointsTimeView?.addEventListener("change", renderAdminPointsChart);
  pointsDriverFilter?.addEventListener("change", renderAdminPointsChart);

  try {
    await loadSponsors();
    await loadDrivers();
    await loadTransactions();
    await renderAdminPointsChart();
    await loadDriverSponsorAffiliations();
  } catch (err) {
    console.error(err);
    document.getElementById("statusMsg").textContent = "Failed to initialize admin reports.";
  }
});