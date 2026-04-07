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
                <div class="muted small">
                    Role: <strong>${esc(u.role)}</strong>
                    ${u.sponsors ? ` • Sponsors: ${esc(u.sponsors)}` : ""}
                </div>
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
            ${u.role === "Driver" ? `
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;">
                    <select class="input addSponsorSelect" data-id="${u.id}">
                    <option value="">Assign sponsor...</option>
                    <option value="Sponsor 1">Sponsor 1</option>
                    <option value="Sponsor 2">Sponsor 2</option>
                    <option value="Sponsor 3">Sponsor 3</option>
                    <option value="Sponsor 4">Sponsor 4</option>
                    </select>
                    <button class="btn btn-primary assignSponsorBtn" data-id="${u.id}">
                    Add Sponsor
                    </button>
                </div>
            ` : ""}
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

function bugCardHTML(bug) {
    return `
    <div class="bug-card" style="border:1px solid #ddd; padding:16px; border-radius:8px;">

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
                <strong>Bug ID:</strong> <span>#${bug.id}</span><br>
                <strong>Submitted by User ID:</strong> <span>${esc(bug.user_id)}</span>
            </div>

            <div style="display:flex; align-items:center; gap:8px;">
                <label class="small muted">Status:</label>
                <select class="input statusSelect" data-id="${bug.id}">
                    ${["New","Received","In Progress","Resolved"]
                        .map(s => `<option value="${s}" ${bug.status === s ? "selected" : ""}>${s}</option>`)
                        .join("")}
                </select>
                <button class="btn btn-primary save-status-btn" data-id="${bug.id}">Update</button>
            </div>
        </div>

        <div style="margin-top:14px;">
            <strong>Description:</strong>
            <div class="muted" style="margin-top:6px;">
                ${esc(bug.description)}
            </div>

            <textarea class="input bug-description-input" data-id="${bug.id}"
                placeholder="Edit description..."
                style="margin-top:8px; width:100%; min-height:80px;"></textarea>

            <button class="btn btn-primary save-description-btn" data-id="${bug.id}" style="margin-top:6px;">
                Save Description
            </button>
        </div>

        <div style="margin-top:18px;">
            <strong>Comments:</strong>

            <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">
                ${(bug.comments || []).map(c => `
                    <div style="background:#f5f5f5; color:#000; padding:8px; border-radius:6px;">
                        ${esc(c.comment)}
                    </div>
                `).join("")}
            </div>

            <textarea class="input add-comment-input" data-id="${bug.id}"
                placeholder="Add a comment..."
                style="margin-top:10px; width:100%; min-height:60px;"></textarea>

            <button class="btn btn-primary add-comment-btn" data-id="${bug.id}" style="margin-top:6px;">
                Add Comment
            </button>
        </div>

    </div>
    `;
}

async function loadBugReports() {
    const container = document.getElementById("bugReportsContainer");
    container.innerHTML = "Loading bugs...";

    try {
        const data = await getJSON("/api/bugs")
        const bugs = data.bugs || [];

        container.innerHTML =
            bugs.map(bugCardHTML).join("") ||
            `<p class="muted">No bug reports found.</p>`;
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p class="muted">Failed to load bugs.</p>`;
    }
}

async function createAdminUser() {
    const msg = document.getElementById("createAdminMsg");
    const btn = document.getElementById("createAdminBtn");

    const first_name = document.getElementById("adminFirstName").value.trim();
    const last_name = document.getElementById("adminLastName").value.trim();
    const username = document.getElementById("adminUsername").value.trim();
    const email = document.getElementById("adminEmail").value.trim();
    const password = document.getElementById("adminPassword").value;
    const phone_number = document.getElementById("adminPhone").value.trim();

    if (!first_name || !last_name || !username || !email || !password || !phone_number) {
        msg.textContent = "Please fill in all fields.";
        return;
    }

    btn.disabled = true;
    msg.textContent = "Creating admin user...";

    try {
        await sendJSON("/api/admin/users/admin", "POST", {
            first_name,
            last_name,
            username,
            email,
            password,
            phone_number
        });

        msg.textContent = "Admin user created.";

        document.getElementById("adminFirstName").value = "";
        document.getElementById("adminLastName").value = "";
        document.getElementById("adminUsername").value = "";
        document.getElementById("adminEmail").value = "";
        document.getElementById("adminPassword").value = "";
        document.getElementById("adminPhone").value = "";

        await searchUsers();
    } catch (err) {
        console.error(err);
        msg.textContent = err.message || "Failed to create admin user.";
    } finally {
        btn.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    loadMe().catch(console.warn);
    loadBugReports().catch(console.error);
    document.getElementById("backBtn").addEventListener("click", () => {
        window.location.href = "/Website/catalog.html";
    });

    document.getElementById("logoutBtn").addEventListener("click", async () => {
        await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
        window.location.href = "/Website/login.html";
    });

    document.getElementById("searchBtn").addEventListener("click", searchUsers);
    document.getElementById("createAdminBtn")?.addEventListener("click", createAdminUser);

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
        const assignSponsorBtn = e.target.closest(".assignSponsorBtn");

        if (assignSponsorBtn) {
            const id = assignSponsorBtn.dataset.id;
            const sel = document.querySelector(`.addSponsorSelect[data-id="${id}"]`);
            const sponsorName = sel?.value;
            const msg = document.getElementById(`msg-${id}`);

            if (!sponsorName) {
                msg.textContent = "Please select a sponsor.";
                return;
            }

            msg.textContent = "Assigning sponsor...";

            try {
                await sendJSON(`/api/admin/users/${id}/sponsors`, "POST", { sponsor_name: sponsorName });
                msg.textContent = "Sponsor assigned.";
                await searchUsers();
            } catch (err) {
                msg.textContent = err.message || "Failed to assign sponsor.";
            }
        }

    });

    // initial load
    searchUsers();
});