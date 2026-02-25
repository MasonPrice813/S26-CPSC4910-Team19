async function getJSON(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || data?.message || `${url} -> ${res.status}`);
    return data;
}

async function sendJSON(url, method, body) {
    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || data?.message || `${url} -> ${res.status}`);
    return data;
}

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
}

function rowHTML(u) {
    return `
        <div class="card" style="padding:14px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div>
                <div><strong>${esc(u.first_name)} ${esc(u.last_name)}</strong> <span class="muted">(#${u.id})</span></div>
                <div class="muted small">${esc(u.username || "")} • ${esc(u.email || "")}</div>
                <div class="muted small">Role: <strong>${esc(u.role)}</strong>${u.sponsor ? ` • Sponsor Org: ${esc(u.sponsor)}` : ""}</div>
            </div>

            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <select class="input roleSelect" data-id="${u.id}">
                    <option value="Driver" ${u.role === "Driver" ? "selected" : ""}>Driver</option>
                    <option value="Sponsor" ${u.role === "Sponsor" ? "selected" : ""}>Sponsor</option>
                    <option value="Admin" ${u.role === "Admin" ? "selected" : ""}>Admin</option>
                </select>
                <button class="btn btn-primary saveRoleBtn" data-id="${u.id}">Save Role</button>
                <button class="btn btn-primary deleteBtn" data-id="${u.id}">Delete</button>
            </div>
        </div>
        <p class="muted small" id="msg-${u.id}" style="margin-top:10px;"></p>
        </div>
    `;
}

let ME_ID = null

async function loadMe() {
    const me = await getJSON("/api/me");
    ME_ID = me.id;
    const meBadge = document.getElementById("meBadge");
    const sponsorText = me.sponsor ? ` • ${me.sponsor}` : "";
    meBadge.textContent = `Logged in as: ${me.role}${sponsorText}`;

    //Enforce admin-only
    if (me.role !== "Admin") {
        window.location.href = "/Website/catalog.html";
    }
}

async function searchUsers() {
    const status = document.getElementById("statusMsg");
    const results = document.getElementById("results");
    const q = document.getElementById("searchInput").value.trim();
    const role = document.getElementById("roleFilter").value;

    status.textContent = "Searching...";
    results.innerHTML = "";

    try {
        const data = await getJSON(`/api/admin/users?search=${encodeURIComponent(q)}&role=${encodeURIComponent(role)}`);
        const users = (data.users || []).filter(u => u.id !== ME_ID);
        status.textContent = `${users.length} result(s).`;

        results.innerHTML = users.map(rowHTML).join("") || `<p class="muted">No users found.</p>`;
    } catch (err) {
        console.error(err);
        status.textContent = String(err.message || err);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadMe();

    document.getElementById("backBtn").addEventListener("click", () => {
        window.location.href = "/Website/catalog.html";
    });

    document.getElementById("logoutBtn").addEventListener("click", async () => {
        await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
        window.location.href = "/Website/login.html";
    });

    document.getElementById("searchBtn").addEventListener("click", searchUsers);

    document.addEventListener("click", async (e) => {
        const saveBtn = e.target.closest(".saveRoleBtn");
        const delBtn = e.target.closest(".deleteBtn");

        if (saveBtn) {
        const id = saveBtn.dataset.id;
        const sel = document.querySelector(`.roleSelect[data-id="${id}"]`);
        const newRole = sel.value;
        const msg = document.getElementById(`msg-${id}`);
        msg.textContent = "Saving...";

        try {
            await sendJSON(`/api/admin/users/${id}/role`, "PATCH", { role: newRole });
            msg.textContent = "Role updated.";
            await searchUsers(); // refresh list
        } catch (err) {
            msg.textContent = err.message || "Failed to update role.";
        }
        }

        if (delBtn) {
        const id = delBtn.dataset.id;
        const ok = confirm("Delete this user? This cannot be undone.");
        if (!ok) return;

        const msg = document.getElementById(`msg-${id}`);
        msg.textContent = "Deleting...";

        try {
            await fetch(`/api/admin/users/${id}`, { method: "DELETE", credentials: "same-origin" })
            .then(async r => {
                const data = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(data?.error || "Delete failed");
                return data;
            });

            msg.textContent = "User deleted.";
            await searchUsers();
        } catch (err) {
            msg.textContent = err.message || "Failed to delete user.";
        }
        }
    });

    // initial load
    searchUsers();
});