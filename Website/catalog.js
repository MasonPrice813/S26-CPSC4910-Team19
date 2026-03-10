async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

let showFavoritesOnly = false;
let currentPage = 1;
const limit = 18;
let totalPages = 1;

let allProducts = [];
let filteredProducts = [];

let CURRENT_USER_POINTS = 0;

const POINTS_PER_DOLLAR = 10; // 10 points = $1

function dollarsToPoints(priceDollars) {
  const p = Number(priceDollars);
  if (!Number.isFinite(p)) return 0;
  return Math.ceil(p * POINTS_PER_DOLLAR);
}

function formatDollars(priceDollars) {
  const p = Number(priceDollars);
  if (!Number.isFinite(p)) return "$0.00";
  return `$${p.toFixed(2)}`;
}

function getUserPoints() {
  const el = document.getElementById("pointsBalance");
  if (!el) return 0;
  const m = String(el.textContent || "").match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function normalizeNumber(val) {
  if (val === "" || val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function getFavorites() {
  try {
    const favs = localStorage.getItem("favorites");
    return favs ? JSON.parse(favs) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favs) {
  localStorage.setItem("favorites", JSON.stringify(favs));
}

function isFavorited(productId) {
  return getFavorites().includes(productId);
}

function toggleFavorite(productId) {
  const favs = getFavorites();
  if (favs.includes(productId)) {
    const idx = favs.indexOf(productId);
    favs.splice(idx, 1);
  } 
  else {
    favs.push(productId);
  }
  saveFavorites(favs);
}

function getFilters() {
  const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const category = document.getElementById("categorySelect")?.value || "all";
  const minPoints = normalizeNumber(document.getElementById("minPoints")?.value);
  const maxPoints = normalizeNumber(document.getElementById("maxPoints")?.value);
  const affordableOnly = !!document.getElementById("affordableOnly")?.checked;

  return { q, category, minPoints, maxPoints, affordableOnly };
}

function applyFilters() {
  const { q, category, minPoints, maxPoints, affordableOnly } = getFilters();
  const userPoints = CURRENT_USER_POINTS;

  filteredProducts = allProducts.filter((p) => {
    const title = String(p.title || "").toLowerCase();
    const cat = String(p.category || "");
    const dollars = Number(p.price);
    const pointsCost = dollarsToPoints(dollars);

    if (q && !title.includes(q)) return false;
    if (category !== "all" && cat !== category) return false;

    if (minPoints !== null && pointsCost < minPoints) return false;
    if (maxPoints !== null && pointsCost > maxPoints) return false;

    if (affordableOnly && pointsCost > userPoints) return false;
    if (showFavoritesOnly && !isFavorited(p.id)) return false;

    return true;
  });

  totalPages = Math.max(1, Math.ceil(filteredProducts.length / limit));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  const meta = document.getElementById("resultsMeta");

  if (!grid) return;

  const start = (currentPage - 1) * limit;
  const pageItems = filteredProducts.slice(start, start + limit);

  grid.innerHTML = "";

  if (meta) {
    meta.textContent = `Showing ${filteredProducts.length} result(s).`;
  }

  if (pageItems.length === 0) {
    grid.innerHTML = `<p class="muted">No products match your filters.</p>`;
  } else {
    pageItems.forEach((product) => {
      const card = document.createElement("div");
      card.className = "card product-card";

      const pointsCost = dollarsToPoints(product.price);
      const dollarsLabel = formatDollars(product.price);

      card.innerHTML = `
        <div class="card-header" style="position:relative;">
          <h3>${product.title}</h3>
          <button class="favorite-btn" 
            style="position:absolute; top:8px; right:14px; background:none; border:none; cursor:pointer; font-size:40px; color: ${isFavorited(product.id) ? 'red' : '#ccc'};"> ♥
          </button>
        </div>

        <div style="padding:16px;">

          <img src="${product.thumbnail}"
              alt="${product.title}"
              style="width:100%; height:200px; object-fit:contain; margin-bottom:12px;" />

          <p class="muted small" style="min-height:60px;">
            ${String(product.description || "").substring(0, 100)}...
          </p>

          <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <strong>${pointsCost} points</strong>
              <div class="muted small" style="margin-top:2px;">(${dollarsLabel})</div>
            </div>
            <button class="btn btn-primary" type="button">Redeem</button>
          </div>

        </div>
      `;

      const favBtn = card.querySelector(".favorite-btn");
      if (favBtn) {
        favBtn.addEventListener("click", (e) => {
          e.stopPropagation(); 
          toggleFavorite(product.id);
          favBtn.style.color = isFavorited(product.id) ? "red" : "#ccc";
        });
      } 

      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        window.location.href = `/Website/product.html?id=${product.id}`;
      });

      grid.appendChild(card);
    });
  }

  const pageNumber = document.getElementById("pageNumber");
  if (pageNumber) pageNumber.innerText = `Page ${currentPage} of ${totalPages}`;

  const prevBtn = document.getElementById("prevPage");
  const nextBtn = document.getElementById("nextPage");
  if (prevBtn) prevBtn.disabled = currentPage === 1;
  if (nextBtn) nextBtn.disabled = currentPage === totalPages;
}

// Filtering to just the favorites
document.getElementById("showFavoritesBtn")?.addEventListener("click", () => {
  showFavoritesOnly = !showFavoritesOnly;
  document.getElementById("showFavoritesBtn").textContent = showFavoritesOnly ? "Show All" : "Show Favorites";
  applyFilters();
});

function wireUpFilterUI() {
  const searchInput = document.getElementById("searchInput");
  const categorySelect = document.getElementById("categorySelect");
  const minPoints = document.getElementById("minPoints");
  const maxPoints = document.getElementById("maxPoints");
  const affordableOnly = document.getElementById("affordableOnly");
  const clearBtn = document.getElementById("clearFiltersBtn");

  let t = null;
  const debouncedApply = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      currentPage = 1;
      applyFilters();
    }, 200);
  };

  if (searchInput) searchInput.addEventListener("input", debouncedApply);

  if (categorySelect) categorySelect.addEventListener("change", () => {
    currentPage = 1;
    applyFilters();
  });

  if (minPoints) minPoints.addEventListener("input", debouncedApply);
  if (maxPoints) maxPoints.addEventListener("input", debouncedApply);

  if (affordableOnly) affordableOnly.addEventListener("change", () => {
    currentPage = 1;
    applyFilters();
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      if (categorySelect) categorySelect.value = "all";
      if (minPoints) minPoints.value = "";
      if (maxPoints) maxPoints.value = "";
      if (affordableOnly) affordableOnly.checked = false;

      currentPage = 1;
      applyFilters();
    });
  }
}

async function initCatalogData() {
  //Fetch categories
  const cats = await getJSON("https://dummyjson.com/products/categories");

  const categorySelect = document.getElementById("categorySelect");
  if (categorySelect && Array.isArray(cats)) {
    categorySelect.innerHTML = `<option value="all">All categories</option>`;

    cats.forEach((c) => {
      const slug = typeof c === "string" ? c : (c?.slug || c?.name || "");
      const name = typeof c === "string" ? c : (c?.name || c?.slug || "");
      if (!slug) return;

      const opt = document.createElement("option");
      opt.value = slug;
      opt.textContent = name;
      categorySelect.appendChild(opt);
    });
  }

  //Fetch all products
  const data = await getJSON("https://dummyjson.com/products?limit=0");
  allProducts = Array.isArray(data?.products) ? data.products : [];
  filteredProducts = [...allProducts];

  totalPages = Math.max(1, Math.ceil(filteredProducts.length / limit));
  currentPage = 1;

  applyFilters();
}

document.addEventListener("DOMContentLoaded", async () => {
  const meBadge = document.getElementById("meBadge");
  const manageUsersBtn = document.getElementById("manageUsersBtn");
  const pendingBtn = document.getElementById("pendingAppsBtn");
  const createSponsorBtn = document.getElementById("createSponsorBtn");

  try {
    const me = await getJSON("/api/me");

    CURRENT_USER_POINTS = Number(me.points || 0);
    
    CURRENT_USER_POINTS = Number(me.points || 0);

    const pointsEl =
      document.getElementById("pointsValue") ||
      document.getElementById("pointsBalance");

    if (pointsEl) {
      pointsEl.textContent = `Points: ${CURRENT_USER_POINTS}`;
    }

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
    return;
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

  document.getElementById("nextPage").addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderProducts();
    }
  });

  document.getElementById("prevPage").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderProducts();
    }
  });

  wireUpFilterUI();

  try {
    await initCatalogData();
  } catch (err) {
    console.error("Failed to init catalog:", err);
    const grid = document.getElementById("productGrid");
    if (grid) grid.innerHTML = "<p>Failed to load catalog items.</p>";
  }
});