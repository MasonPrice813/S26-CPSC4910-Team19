async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`${url} -> ${res.status} ${msg}`);
  }
  return res.json().catch(() => ({}));
}

function card(app) {
  const div = document.createElement("div");
  div.className = "card app-card";

  const safe = (v) => (v === null || v === undefined || v === "" ? "<span class='muted'>n/a</span>" : escapeHtml(v));
  const safePlain = (v) => (v === null || v === undefined || v === "" ? "n/a" : String(v));

  const formatDateMaybe = (val) => {
    if (!val) return "<span class='muted'>n/a</span>";
    const d = new Date(val);
    if (!isNaN(d.getTime())) return escapeHtml(d.toLocaleDateString());
    return escapeHtml(String(val));
  };

  div.innerHTML = `
    <div class="app-header">
      <div>
        <div class="app-title">
          ${escapeHtml(app.first_name || "")} ${escapeHtml(app.last_name || "")}
          <span class="muted">(${escapeHtml(app.email || "n/a")})</span>
        </div>
        <div class="muted app-subtitle">Application ID: <code>${escapeHtml(app.id)}</code></div>
      </div>

      <div class="app-actions">
        <button class="btn btn-primary" data-action="approve">Approve</button>
        <button class="btn btn-primary" data-action="reject">Reject</button>
      </div>
    </div>

    <div class="app-grid">
      <div class="app-label">Username</div>
      <div class="app-value">${safe(app.username)}</div>

      <div class="app-label">Phone</div>
      <div class="app-value">${safe(app.phone_number)}</div>

      <div class="app-label">Sponsor</div>
      <div class="app-value">${safe(app.sponsor)}</div>

      <div class="app-section-divider"></div>

      <div class="app-label">SSN (last 4)</div>
      <div class="app-value">${safe(app.ssn_last4)}</div>

      <div class="app-label">Age</div>
      <div class="app-value">${app.age === 0 || app.age ? escapeHtml(app.age) : "<span class='muted'>n/a</span>"}</div>

      <div class="app-label">DOB</div>
      <div class="app-value">${formatDateMaybe(app.dob)}</div>

      <div class="app-label">DL Number</div>
      <div class="app-value">${safe(app.dl_num)}</div>

      <div class="app-label">DL Expiration</div>
      <div class="app-value">${formatDateMaybe(app.dl_expiration)}</div>

      <div class="app-block">
        <div class="app-label">Driving Record</div>
        ${
          app.driving_record
            ? `<pre class="app-pre">${escapeHtml(app.driving_record)}</pre>`
            : `<span class="muted">n/a</span>`
        }
      </div>

      <div class="app-block">
        <div class="app-label">Criminal History</div>
        ${
          app.criminal_history
            ? `<pre class="app-pre">${escapeHtml(app.criminal_history)}</pre>`
            : `<span class="muted">n/a</span>`
        }
      </div>
    </div>
  `;

  div.querySelector('[data-action="approve"]').addEventListener("click", async () => {
    if (!confirm(`Approve application ${safePlain(app.id)}? This will move them to users + drivers and remove from applications.`)) return;
    await postJSON(`/api/sponsor/applications/${app.id}/approve`);
    div.remove();
  });

  div.querySelector('[data-action="reject"]').addEventListener("click", async () => {
    if (!confirm(`Reject application ${safePlain(app.id)}? This will delete it from applications.`)) return;
    await postJSON(`/api/sponsor/applications/${app.id}/reject`);
    div.remove();
  });

  return div;
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("backBtn").addEventListener("click", () => {
    window.location.href = "/Website/catalog.html";
  });

  const meBadge = document.getElementById("meBadge");
  const status = document.getElementById("status");
  const list = document.getElementById("list");

  try {
    const me = await getJSON("/api/me");
    const sponsorText = me.sponsor ? ` • ${me.sponsor}` : "";
    meBadge.textContent = `Logged in as: ${me.role}${sponsorText}`;

    if (me.role !== "Sponsor") {
      status.textContent = "Forbidden: only sponsors can view this page.";
      return;
    }

    const data = await getJSON("/api/sponsor/applications");
    const apps = data.applications || [];

    if (apps.length === 0) {
      status.textContent = "No pending driver applications.";
      return;
    }

    status.textContent = `Pending applications: ${apps.length}`;
    apps.forEach((a) => list.appendChild(card(a)));
  } catch (err) {
    console.error(err);
    status.textContent = "Could not load applications. Check console + server logs.";
  }
});

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}