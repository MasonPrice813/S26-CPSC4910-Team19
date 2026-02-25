async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function loadProducts() {
  const grid = document.getElementById("productGrid");

  try {
    const products = await getJSON("https://fakestoreapi.com/products");

    grid.innerHTML = "";

    products.forEach(product => {
      const card = document.createElement("div");
      card.className = "card product-card";

      card.innerHTML = `
        <div class="card-header">
          <h3>${product.title}</h3>
        </div>
        <div style="padding: 16px;">
          <img src="${product.image}" 
               alt="${product.title}" 
               style="width:100%; height:200px; object-fit:contain; margin-bottom:12px;" />

          <p class="muted small" style="min-height:60px;">
            ${product.description.substring(0, 100)}...
          </p>

          <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
            <strong>$${product.price}</strong>
            <button class="btn btn-primary">Redeem</button>
          </div>
        </div>
      `;

      grid.appendChild(card);
    });

  } catch (err) {
    console.error("Failed to load products:", err);
    grid.innerHTML = "<p>Failed to load catalog items.</p>";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const meBadge = document.getElementById("meBadge");
  const manageUsersBtn = document.getElementById("manageUsersBtn");
  const pendingBtn = document.getElementById("pendingAppsBtn");
  const createSponsorBtn = document.getElementById("createSponsorBtn");

  try {
    const me = await getJSON("/api/me");
    const sponsorText = me.sponsor ? ` • ${me.sponsor}` : "";
    meBadge.textContent = `Logged in as: ${me.role}${sponsorText}`;

    if (me.role === "Admin") {
      manageUsersBtn.style.display = "inline-block";
      manageUsersBtn.addEventListener("click", () => {
        window.location.href = "/Website/admin-users.html";
      });
    }

    if (me.role === "Sponsor") {
      pendingBtn.style.display = "inline-block";
      pendingBtn.addEventListener("click", () => {
        window.location.href = "/Website/sponsor-applications.html";
      });

      createSponsorBtn.style.display = "inline-block";
      createSponsorBtn.addEventListener("click", () => {
        window.location.href = "/Website/sponsor-create.html";
      });
    }

  } catch (err) {
    console.error(err);
    meBadge.textContent = "Not logged in";
    window.location.href = "/Website/login.html";
  }

  document.getElementById("profileBtn").addEventListener("click", () => {
    window.location.href = "/Website/profile.html";
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin"
      });

      window.location.href = "/Website/login.html";

    } catch (err) {
      console.error("Logout failed:", err);
      window.location.href = "/Website/login.html";
    }
  });

  //Load Fake Store Products
  loadProducts();
});