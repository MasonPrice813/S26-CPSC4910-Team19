async function getJSON(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `${url} -> ${res.status}`);
    return data;
}

async function postJSON(url, body) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `${url} -> ${res.status}`);
    return data;
}

document.addEventListener("DOMContentLoaded", async () => {
    const sponsorBadge = document.getElementById("sponsorBadge");
    const sponsorNameEl = document.getElementById("sponsorName");
    const msg = document.getElementById("msg");

    document.getElementById("backBtn").addEventListener("click", () => {
        window.location.href = "/Website/catalog.html";
    });

    //Require sponsor session
    let me;
    try {
        me = await getJSON("/api/me");
        if (me.role !== "Sponsor") {
            window.location.href = "/Website/catalog.html";
            return;
        }
        sponsorBadge.textContent = `Logged in as: Sponsor • ${me.sponsor || ""}`;
        sponsorNameEl.textContent = me.sponsor || "(missing sponsor)";
    } catch (e) {
        window.location.href = "/Website/login.html";
        return;
    }

    document.getElementById("createForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        msg.textContent = "Creating…";

        const payload = {
            first_name: document.getElementById("first_name").value.trim(),
            last_name: document.getElementById("last_name").value.trim(),
            username: document.getElementById("username").value.trim(),
            email: document.getElementById("email").value.trim(),
            phone_number: document.getElementById("phone_number").value.trim(),
            password: document.getElementById("password").value
        };

        try {
            await postJSON("/api/sponsor/sponsor-users", payload);
            msg.textContent = "Created! Returning to catalog…";
            setTimeout(() => (window.location.href = "/Website/catalog.html"), 900);
        } catch (err) {
            msg.textContent = err.message || "Failed to create sponsor user.";
        }
    });
});
