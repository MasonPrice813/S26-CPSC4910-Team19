let PRODUCT_NAME_MAP = new Map();

async function getJSON(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
}

async function loadProductNames() {
    try {
        const res = await fetch("https://dummyjson.com/products?limit=0");
        if (!res.ok) {
        throw new Error(`Product API failed: ${res.status}`);
        }

        const data = await res.json();
        const products = Array.isArray(data.products) ? data.products : [];

        PRODUCT_NAME_MAP = new Map(
        products.map((product) => [Number(product.id), String(product.title || "")])
        );
    } catch (err) {
        console.error("Failed to load product names:", err);
        PRODUCT_NAME_MAP = new Map();
    }
}

function getProductName(productId) {
    const name = PRODUCT_NAME_MAP.get(Number(productId));
    return name && name.trim() ? name : `Product #${productId}`;
}

function formatMoney(value) {
    const n = Number(value || 0);
    return `$${n.toFixed(2)}`;
}

function formatDateTime(value) {
    const d = new Date(value);
    return d.toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function formatDateOnly(value) {
    const d = new Date(value);
    return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function renderTransactions(transactions) {
    const container = document.getElementById("transactionsContainer");
    if (!container) return;

    container.innerHTML = "";

    if (!Array.isArray(transactions) || transactions.length === 0) {
        container.innerHTML = `
        <div class="content-box">
            <p class="muted" style="margin:0;">No transactions found for this time range.</p>
        </div>
        `;
        return;
    }

    transactions.forEach((tx) => {
        const card = document.createElement("div");
        card.className = "content-box";
        card.style.marginTop = "16px";

        const itemsHtml = tx.items.map((item) => {
            const productName = getProductName(item.product_id);

            return `
                <li style="padding:10px 0; border-bottom:1px solid rgba(0,0,0,0.08);">
                    <div><strong>${productName}</strong></div>
                    <div class="muted small" style="margin-top:4px;">
                        Product ID: ${item.product_id}
                    </div>
                    <div class="muted small" style="margin-top:4px;">
                        ${item.point_cost} points • ${formatMoney(item.dollar_cost)}
                    </div>
                </li>
            `;
            }).join("");

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap;">
                <div>
                    <h3 style="margin:0 0 6px 0;">Transaction ${tx.group_id}</h3>
                    <div class="muted small">Placed: ${formatDateTime(tx.transaction_date)}</div>
                </div>

                <div style="text-align:right;">
                    <div><strong>${tx.total_points} points</strong></div>
                    <div class="muted small">${formatMoney(tx.total_dollars)}</div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px; margin-top:16px;">
                <div><strong>Shipping:</strong> ${tx.shipping_method}</div>
                <div><strong>Expected delivery:</strong> ${formatDateOnly(tx.expected_delivery_date)}</div>
                <div><strong>Items:</strong> ${tx.item_count}</div>
            </div>

            <div style="margin-top:18px;">
                <strong>Items in this transaction</strong>
                <ul style="list-style:none; padding:0; margin:10px 0 0 0;">
                    ${itemsHtml}
                </ul>
            </div>
        `;

        container.appendChild(card);
    });
}

async function loadTransactions() {
    const range = document.getElementById("rangeSelect")?.value || "1m";
    const data = await getJSON(`/api/orders/history?range=${encodeURIComponent(range)}`);
    renderTransactions(data.transactions || []);
}

document.addEventListener("DOMContentLoaded", async () => {
    const meBadge = document.getElementById("meBadge");
    const rangeSelect = document.getElementById("rangeSelect");
    const exportBtn = document.getElementById("exportBtn");

    try {
        const me = await getJSON("/api/me");

        if (me.role !== "Driver") {
            window.location.href = "/Website/catalog.html";
            return;
        }

        if (meBadge) {
            meBadge.textContent = `Logged in as ${me.username || "Driver"}`;
        }

        await loadProductNames();
        await loadTransactions();
    } catch (err) {
        console.error("Failed to load transaction history page:", err);
        const container = document.getElementById("transactionsContainer");
        if (container) {
            container.innerHTML = `
                <div class="content-box">
                    <p style="margin:0;">Failed to load transaction history.</p>
                </div>
            `;
        }
    }

    rangeSelect?.addEventListener("change", async () => {
        try {
            await loadTransactions();
        } catch (err) {
            console.error(err);
        }
    });

    exportBtn?.addEventListener("click", () => {
        const range = document.getElementById("rangeSelect")?.value || "1m";
        window.location.href = `/api/orders/history/export?range=${encodeURIComponent(range)}`;
    });

    document.getElementById("backToCatalogBtn")?.addEventListener("click", () => {
        window.location.href = "/Website/catalog.html";
    });

    document.getElementById("profileBtn")?.addEventListener("click", () => {
        window.location.href = "/Website/profile.html";
    });

    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
        try {
        await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin"
        });
        } catch (err) {
            console.error("Logout failed:", err);
        }

        window.location.href = "/Website/login.html";
    });
});