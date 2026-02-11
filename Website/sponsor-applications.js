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
  div.className = "card";

  const createdAt = app.created_at ? new Date(app.created_at).toLocaleString() : "";

  div.innerHTML = `
    <div class="row">
        <div>
        <div><strong>${app.first_name} ${app.last_name}</strong> <span class="muted">(${app.email})</span></div>
        <div class="muted">Application ID: <code>${app.id}</code></div>
        </div>
        <div class="actions">
        <button class="btn primary" data-action="approve">Approve</button>
        <button class="btn danger" data-action="reject">Reject</button>
        </div>
    </div>

    <div class="field"><strong>Username:</strong> ${app.username || "<span class='muted'>n/a</span>"}</div>
    <div class="field"><strong>Phone:</strong> ${app.phone_number || "<span class='muted'>n/a</span>"}</div>
    <div class="field"><strong>Sponsor:</strong> ${app.sponsor || "<span class='muted'>n/a</span>"}</div>

    <hr />

    <div class="field"><strong>SSN (last 4):</strong> ${app.ssn_last4 || "<span class='muted'>n/a</span>"}</div>
    <div class="field"><strong>Age:</strong> ${app.age ?? "<span class='muted'>n/a</span>"}</div>
    <div class="field"><strong>DOB:</strong> ${app.dob || "<span class='muted'>n/a</span>"}</div>

    <div class="field"><strong>DL Number:</strong> ${app.dl_num || "<span class='muted'>n/a</span>"}</div>
    <div class="field"><strong>DL Expiration:</strong> ${app.dl_expiration || "<span class='muted'>n/a</span>"}</div>

    <div class="field"><strong>Driving Record:</strong><br/>${app.driving_record ? `<pre>${escapeHtml(app.driving_record)}</pre>` : "<span class='muted'>n/a</span>"}</div>
    <div class="field"><strong>Criminal History:</strong><br/>${app.criminal_history ? `<pre>${escapeHtml(app.criminal_history)}</pre>` : "<span class='muted'>n/a</span>"}</div>
    `;


  div.querySelector('[data-action="approve"]').addEventListener("click", async () => {
    if (!confirm(`Approve application ${app.id}? This will move them to users + drivers and remove from applications.`)) return;
    await postJSON(`/api/sponsor/applications/${app.id}/approve`);
    div.remove();
  });

  div.querySelector('[data-action="reject"]').addEventListener("click", async () => {
    if (!confirm(`Reject application ${app.id}? This will delete it from applications.`)) return;
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