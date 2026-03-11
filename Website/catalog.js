async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

let showFavoritesOnly = false;
let currentPage = 1;
let pageSize = 15;
let totalPages = 1;

let CURRENT_USER_ID = null;
let cart = [];

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

function getCartStorageKey() {
  return CURRENT_USER_ID ? `catalogCart_${CURRENT_USER_ID}` : "catalogCart_guest";
}

function loadCart() {
  try {
    const raw = localStorage.getItem(getCartStorageKey());
    cart = raw ? JSON.parse(raw) : [];
  } catch {
    cart = [];
  }
}

function saveCart() {
  localStorage.setItem(getCartStorageKey(), JSON.stringify(cart));
}

function getCartItemCount() {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

function getCartPointsTotal() {
  return cart.reduce((sum, item) => sum + (item.pointCost * item.qty), 0);
}

function getAvailablePoints() {
  return Math.max(0, CURRENT_USER_POINTS - getCartPointsTotal());
}

function updatePointsDisplay() {
  const pointsEl =
    document.getElementById("pointsValue") ||
    document.getElementById("pointsBalance");

  if (pointsEl) {
    pointsEl.textContent = `Points: ${getAvailablePoints()}`;
    pointsEl.style.display = "inline";
  }
}

function updateCartBadge() {
  const cartCount = document.getElementById("cartCount");
  if (cartCount) {
    cartCount.textContent = String(getCartItemCount());
  }
}

function isProductInCart(productId) {
  return cart.some(item => item.productId === productId);
}

function canAffordProduct(product) {
  return dollarsToPoints(product.price) <= getAvailablePoints();
}

function addToCart(product) {
  const totalItems = getCartItemCount();
  const pointCost = dollarsToPoints(product.price);

  if (totalItems >= 4) {
    alert("Your cart can only hold up to 4 items.");
    return;
  }

  if (pointCost > getAvailablePoints()) {
    alert("You do not have enough points for this item.");
    return;
  }

  const existing = cart.find(item => item.productId === product.id);

  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      productId: product.id,
      title: product.title,
      thumbnail: product.thumbnail,
      dollarCost: Number(product.price),
      pointCost: pointCost,
      qty: 1
    });
  }

  saveCart();
  updateCartBadge();
  updatePointsDisplay();
  renderCartPanel();
  applyFilters();
}

function removeFromCart(productId) {
  const idx = cart.findIndex(item => item.productId === productId);
  if (idx === -1) return;

  if (cart[idx].qty > 1) {
    cart[idx].qty -= 1;
  } else {
    cart.splice(idx, 1);
  }

  saveCart();
  updateCartBadge();
  updatePointsDisplay();
  renderCartPanel();
  applyFilters();
}

function clearCart() {
  cart = [];
  saveCart();
  updateCartBadge();
  updatePointsDisplay();
  renderCartPanel();
  applyFilters();
}

function renderCartPanel() {
  const cartPanel = document.getElementById("cartPanel");
  const cartItems = document.getElementById("cartItems");
  const cartTotalPoints = document.getElementById("cartTotalPoints");

  if (!cartPanel || !cartItems || !cartTotalPoints) return;

  cartItems.innerHTML = "";

  if (cart.length === 0) {
    cartItems.innerHTML = `<p class="muted">Your cart is empty.</p>`;
  } else {
    cart.forEach((item) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.gap = "12px";
      row.style.padding = "10px 0";
      row.style.borderBottom = "1px solid rgba(0,0,0,0.08)";

      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <img src="${item.thumbnail}" alt="${item.title}" style="width:56px; height:56px; object-fit:contain;" />
          <div>
            <div><strong>${item.title}</strong></div>
            <div class="muted small">
              Qty: ${item.qty} • ${item.pointCost} points each (${formatDollars(item.dollarCost)})
            </div>
          </div>
        </div>

        <button class="btn btn-primary remove-cart-btn" type="button">Remove</button>
      `;

      const removeBtn = row.querySelector(".remove-cart-btn");
      removeBtn.addEventListener("click", () => {
        removeFromCart(item.productId);
      });

      cartItems.appendChild(row);
    });
  }

  cartTotalPoints.textContent = `Total: ${getCartPointsTotal()} points`;
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

function getCurrentPageSize() {
  return pageSize === "all" ? filteredProducts.length || 1 : Number(pageSize);
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
  const userPoints = getAvailablePoints();

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

  const currentLimit = getCurrentPageSize();
  totalPages = Math.max(1, Math.ceil(filteredProducts.length / currentLimit));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  const meta = document.getElementById("resultsMeta");

  if (!grid) return;

  const currentLimit = getCurrentPageSize();
  const start = (currentPage - 1) * currentLimit;
  const pageItems =
    pageSize === "all"
      ? filteredProducts
      : filteredProducts.slice(start, start + currentLimit);

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

      const totalItemsInCart = getCartItemCount();
      const availablePoints = getAvailablePoints();
      const itemAlreadyInCart = isProductInCart(product.id);
      const itemAffordable = pointsCost <= availablePoints;
      const cartHasSpace = totalItemsInCart < 4;

      let redeemLabel = "Redeem";
      let redeemDisabled = false;

      if (!cartHasSpace) {
        redeemLabel = "Cart Full";
        redeemDisabled = true;
      } else if (!itemAffordable) {
        redeemLabel = "Not Enough Points";
        redeemDisabled = true;
      }

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

          <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div>
              <strong>${pointsCost} points</strong>
              <div class="muted small" style="margin-top:2px;">(${dollarsLabel})</div>
            </div>
            <button class="btn btn-primary redeem-btn" type="button" ${redeemDisabled ? "disabled" : ""}>
              ${redeemLabel}
            </button>
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

      const redeemBtn = card.querySelector(".redeem-btn");
      if (redeemBtn) {
        redeemBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          addToCart(product);
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

  const currentLimit = getCurrentPageSize();
  totalPages = Math.max(1, Math.ceil(filteredProducts.length / currentLimit));
  currentPage = 1;

  applyFilters();
}

document.addEventListener("DOMContentLoaded", async () => {
  const meBadge = document.getElementById("meBadge");
  const manageUsersBtn = document.getElementById("manageUsersBtn");

  const sponsorMenuWrap = document.getElementById("sponsorMenuWrap");
  const sponsorMenuBtn = document.getElementById("sponsorMenuBtn");
  const sponsorDropdown = document.getElementById("sponsorDropdown");

  const pendingBtn = document.getElementById("pendingAppsBtn");
  const createSponsorBtn = document.getElementById("createSponsorBtn");
  const sponsorDashboardBtn = document.getElementById("sponsorDashboardBtn");

  const cartBtn = document.getElementById("cartBtn");
  const cartPanel = document.getElementById("cartPanel");
  const clearCartBtn = document.getElementById("clearCartBtn");

  try {
    const me = await getJSON("/api/me");

    CURRENT_USER_ID = Number(me.id || 0);

    if (me.role === "Driver") {
      loadCart();
    }

    CURRENT_USER_POINTS = Number(me.points || 0);

    if (me.role === "Driver") {
      updatePointsDisplay();

      if (cartBtn) {
        cartBtn.style.display = "inline-block";
        updateCartBadge();

        cartBtn.addEventListener("click", () => {
          if (!cartPanel) return;
          cartPanel.style.display = cartPanel.style.display === "none" ? "block" : "none";
          renderCartPanel();
        });
      }

      if (clearCartBtn) {
        clearCartBtn.addEventListener("click", () => {
          clearCart();
        });
      }
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
      sponsorMenuWrap.style.display = "inline-block";

      sponsorMenuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        sponsorDropdown.classList.toggle("show");
      });

      pendingBtn.addEventListener("click", () => {
        window.location.href = "/Website/sponsor-applications.html";
      });

      createSponsorBtn.addEventListener("click", () => {
        window.location.href = "/Website/sponsor-create.html";
      });

      sponsorDashboardBtn.addEventListener("click", () => {
        window.location.href = "/Website/sponsor-page.html";
      });

      document.addEventListener("click", () => {
        sponsorDropdown.classList.remove("show");
      });

      sponsorDropdown.addEventListener("click", (e) => {
        e.stopPropagation();
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

  const pageSizeSelect = document.getElementById("pageSizeSelect");

  if (pageSizeSelect) {
    pageSizeSelect.value = String(pageSize);

    pageSizeSelect.addEventListener("change", () => {
      const selected = pageSizeSelect.value;
      pageSize = selected === "all" ? "all" : Number(selected);
      currentPage = 1;
      applyFilters();
    });
  }

  wireUpFilterUI();

  try {
    await initCatalogData();
  } catch (err) {
    console.error("Failed to init catalog:", err);
    const grid = document.getElementById("productGrid");
    if (grid) grid.innerHTML = "<p>Failed to load catalog items.</p>";
  }
});