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
  const select = document.getElementById("driverFilter");

  let url = "/api/admin/drivers";
  if (sponsor) {
    url += `?sponsor=${encodeURIComponent(sponsor)}`;
  }

  const drivers = await getJSON(url);

  select.innerHTML = `<option value="">All Drivers</option>`;

  drivers.forEach(d => {
    const option = document.createElement("option");
    option.value = d.user_id;
    option.textContent = `${d.first_name} ${d.last_name}`;
    select.appendChild(option);
  });
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
    await loadDrivers();
    await loadTransactions();
  });

  document.getElementById("driverFilter").addEventListener("change", loadTransactions);
  document.getElementById("rangeFilter").addEventListener("change", loadTransactions);

  try {
    await loadSponsors();
    await loadDrivers();
    await loadTransactions();
  } catch (err) {
    console.error(err);
    document.getElementById("statusMsg").textContent = "Failed to initialize admin reports.";
  }
});