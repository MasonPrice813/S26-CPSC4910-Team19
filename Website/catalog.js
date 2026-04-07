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
let selectedShipping = "standard";

let recommendedProducts = [];
let purchasedProductIds = [];

let CURRENT_USER_ROLE = null;
let CURRENT_USER_SPONSOR = null;
let DRIVER_SPONSORS = [];
let ACTIVE_DRIVER_SPONSOR = null;

let ADMIN_SPONSORS = [];
let ACTIVE_ADMIN_SPONSOR = null;

let HIDDEN_PRODUCT_IDS = new Set();

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
  if (!CURRENT_USER_ID) return "catalogCart_guest";
  const sponsorPart = ACTIVE_DRIVER_SPONSOR || "no_sponsor";
  return `catalogCart_${CURRENT_USER_ID}_${sponsorPart}`;
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

function getCartDollarTotal() {
  return cart.reduce((sum, item) => sum + (item.dollarCost * item.qty), 0);
}

function getShippingDollarCost() {
  if (selectedShipping === "overnight") {
    return getCartDollarTotal() * 0.20;
  }
  return 0;
}

function getShippingPointCost() {
  return dollarsToPoints(getShippingDollarCost());
}

function getCheckoutPointsTotal() {
  return getCartPointsTotal() + getShippingPointCost();
}

function addBusinessDays(startDate, businessDays) {
  const date = new Date(startDate);
  let added = 0;

  while (added < businessDays) {
    date.setDate(date.getDate() + 1);

    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) {
      added++;
    }
  }

  return date;
}

function formatDateLong(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function getExpectedDeliveryDate() {
  const businessDays = selectedShipping === "overnight" ? 3 : 7;
  return addBusinessDays(new Date(), businessDays);
}

function getAvailablePoints() {
  return Math.max(0, CURRENT_USER_POINTS - getCheckoutPointsTotal());
}

function updatePointsDisplay() {
  const pointsEl =
    document.getElementById("pointsValue") ||
    document.getElementById("pointsBalance");

  if (pointsEl) {
    const sponsorPrefix =
      CURRENT_USER_ROLE === "Driver" && ACTIVE_DRIVER_SPONSOR
        ? `${ACTIVE_DRIVER_SPONSOR}: `
        : "";

    pointsEl.textContent = `${sponsorPrefix}Points: ${getAvailablePoints()}`;
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
  renderRecommendedProducts();
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
  renderRecommendedProducts();
  applyFilters();
}

function clearCart() {
  cart = [];
  saveCart();
  updateCartBadge();
  updatePointsDisplay();
  renderCartPanel();
  renderRecommendedProducts();
  applyFilters();
}

function renderCartPanel() {
  const cartPanel = document.getElementById("cartPanel");
  const cartItems = document.getElementById("cartItems");
  const cartTotalPoints = document.getElementById("cartTotalPoints");
  const checkoutPanel = document.getElementById("checkoutPanel");

  if (!cartPanel || !cartItems || !cartTotalPoints) return;

  cartItems.innerHTML = "";

  if (cart.length === 0) {
    cartItems.innerHTML = `<p class="muted">Your cart is empty.</p>`;
    cartTotalPoints.textContent = `Total: 0 points`;

    if (checkoutPanel) {
      checkoutPanel.style.display = "none";
    }

    renderCheckoutSummary();
    return;
  }

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

  cartTotalPoints.textContent = `Items total: ${getCartPointsTotal()} points`;

  if (checkoutPanel) {
    checkoutPanel.style.display = "block";
  }

  renderCheckoutSummary();
}

function renderCheckoutSummary() {
  const checkoutSummary = document.getElementById("checkoutSummary");
  const confirmCheckoutBtn = document.getElementById("confirmCheckoutBtn");

  if (!checkoutSummary) return;

  const itemPoints = getCartPointsTotal();
  const itemDollars = getCartDollarTotal();
  const shippingPoints = getShippingPointCost();
  const shippingDollars = getShippingDollarCost();
  const totalPoints = getCheckoutPointsTotal();
  const remainingPoints = Math.max(0, CURRENT_USER_POINTS - totalPoints);
  const enoughPoints = totalPoints <= CURRENT_USER_POINTS;

  const expectedDeliveryDate = getExpectedDeliveryDate();
  const expectedDeliveryLabel = formatDateLong(expectedDeliveryDate);

  checkoutSummary.innerHTML = `
    <div class="muted small" style="display:grid; gap:8px;">
      <div>Items subtotal: <strong>${itemPoints} points</strong> (${formatDollars(itemDollars)})</div>
      <div>Shipping: <strong>${shippingPoints} points</strong> (${formatDollars(shippingDollars)})</div>
      <div>Total checkout cost: <strong>${totalPoints} points</strong></div>
      <div>Points after checkout: <strong>${remainingPoints}</strong></div>
      <div>
        Expected delivery:
        <strong>${expectedDeliveryLabel}</strong>
        ${selectedShipping === "overnight" ? "(3 business days)" : "(7 business days)"}
      </div>
      ${!enoughPoints ? `<div style="color:#b00020;"><strong>Not enough points for this checkout.</strong></div>` : ""}
    </div>
  `;

  if (confirmCheckoutBtn) {
    confirmCheckoutBtn.disabled = cart.length === 0 || !enoughPoints;
  }
}

function getTagList(product) {
  return Array.isArray(product?.tags) ? product.tags.map(String) : [];
}

function buildRecommendationScores(products, purchasedIds) {
  const purchasedSet = new Set(purchasedIds.map(Number));
  const purchasedProducts = products.filter((p) => purchasedSet.has(Number(p.id)));

  if (purchasedProducts.length === 0) return [];

  const categoryCounts = new Map();
  const brandCounts = new Map();
  const tagCounts = new Map();

  for (const product of purchasedProducts) {
    const category = String(product.category || "");
    const brand = String(product.brand || "");

    if (category) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }

    if (brand) {
      brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
    }

    for (const tag of getTagList(product)) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const availablePoints = getAvailablePoints();

  const candidates = products
    .filter((product) => !purchasedSet.has(Number(product.id)))
    .map((product) => {
      const category = String(product.category || "");
      const brand = String(product.brand || "");
      const tags = getTagList(product);
      const pointsCost = dollarsToPoints(product.price);

      let score = 0;

      score += (categoryCounts.get(category) || 0) * 5;
      score += (brandCounts.get(brand) || 0) * 2;

      for (const tag of tags) {
        score += (tagCounts.get(tag) || 0);
      }

      score += Number(product.rating || 0) * 0.25;

      return { product, score, pointsCost };
    })
    .filter((entry) => entry.score > 0)
    .filter((entry) => entry.pointsCost <= availablePoints)
    .sort((a, b) => b.score - a.score);
    
  return candidates.map((entry) => entry.product);
}

function renderRecommendedProducts() {
  const section = document.getElementById("recommendedSection");
  const grid = document.getElementById("recommendedGrid");
  const subtitle = document.getElementById("recommendedSubtitle");

  if (!section || !grid) return;

  grid.innerHTML = "";

  if (!recommendedProducts.length) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";

  if (subtitle) {
    subtitle.textContent = "Based on items you have ordered before.";
  }

  recommendedProducts.slice(0, 4).forEach((product) => {
    const pointsCost = dollarsToPoints(product.price);
    const dollarsLabel = formatDollars(product.price);

    const totalItemsInCart = getCartItemCount();
    const availablePoints = getAvailablePoints();
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

    const card = document.createElement("div");
    card.className = "card product-card";

    card.innerHTML = `
      <div class="card-header" style="position:relative;">
        <h3>${product.title}</h3>
        <span class="muted small"
              style="position:absolute; top:10px; right:14px; font-weight:600;">
          Recommended
        </span>
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

async function loadRecommendations() {
  const section = document.getElementById("recommendedSection");

  if (!section) return;

  try {
    const me = await getJSON("/api/me");

    if (me.role !== "Driver") {
      section.style.display = "none";
      return;
    }

    const data = await getJSON("/api/recommendations");
    purchasedProductIds = Array.isArray(data?.purchasedProductIds)
      ? data.purchasedProductIds.map(Number)
      : [];

    if (!purchasedProductIds.length) {
      section.style.display = "none";
      return;
    }

    recommendedProducts = buildRecommendationScores(allProducts, purchasedProductIds).slice(0, 4);
    renderRecommendedProducts();
  } catch (err) {
    console.error("Failed to load recommendations:", err);
    section.style.display = "none";
  }
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

    if (HIDDEN_PRODUCT_IDS.has(Number(p.id))) return false;

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

          ${
            CURRENT_USER_ROLE === "Sponsor"
              ? `
                <button
                  class="remove-product-btn"
                  title="Hide item"
                  type="button"
                  style="
                    position:absolute;
                    top:10px;
                    right:14px;
                    background:none;
                    border:none;
                    cursor:pointer;
                    font-size:28px;
                    font-weight:bold;
                    color:#b00020;
                    line-height:1;
                  "
                >−</button>
              `
              : `
                <button class="favorite-btn"
                  style="position:absolute; top:8px; right:14px; background:none; border:none; cursor:pointer; font-size:40px; color: ${isFavorited(product.id) ? 'red' : '#ccc'};"> ♥
                </button>
              `
          }
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

      const removeBtn = card.querySelector(".remove-product-btn");
      if (removeBtn) {
        removeBtn.addEventListener("click", async (e) => {
          e.stopPropagation();

          const confirmed = confirm(
            `Hide "${product.title}" for sponsor "${CURRENT_USER_SPONSOR}" and its users?`
          );
          if (!confirmed) return;

          try {
            await hideCatalogItem(product.id);
            HIDDEN_PRODUCT_IDS.add(Number(product.id));
            applyFilters();
          } catch (err) {
            console.error(err);
            alert("Could not hide item for this sponsor.");
          }
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

async function loadNotificationCount() {
  try {
    const res = await fetch("/api/notifications/unread-count", {
      credentials: "same-origin"
    });

    if (!res.ok) {
      throw new Error(`Unread count failed: ${res.status}`);
    }

    const data = await res.json();
    const count = Number(data.unreadCount || 0);

    const badge = document.getElementById("notificationCount");
    if (badge) {
      badge.textContent = String(count);
    }
  } catch (err) {
    console.error("Failed to load notification count:", err);
  }
}

async function loadHiddenProductIds() {
  try {
    const sponsor = getEffectiveCatalogSponsor();

    if (!sponsor) {
      HIDDEN_PRODUCT_IDS = new Set();
      return;
    }

    const url = `/api/catalog/hidden-product-ids?sponsor=${encodeURIComponent(sponsor)}`;
    const data = await getJSON(url);
    const ids = Array.isArray(data?.productIds) ? data.productIds.map(Number) : [];
    HIDDEN_PRODUCT_IDS = new Set(ids);
  } catch (err) {
    console.error("Failed to load hidden product ids:", err);
    HIDDEN_PRODUCT_IDS = new Set();
  }
}

async function hideCatalogItem(productId) {
  const res = await fetch(`/api/sponsor/catalog/hide/${productId}`, {
    method: "POST",
    credentials: "same-origin"
  });

  if (!res.ok) {
    throw new Error(`Hide item failed: ${res.status}`);
  }

  return res.json();
}

async function restoreCatalogItem(productId) {
  const res = await fetch(`/api/sponsor/catalog/restore/${productId}`, {
    method: "POST",
    credentials: "same-origin"
  });

  if (!res.ok) {
    throw new Error(`Restore item failed: ${res.status}`);
  }

  return res.json();
}

async function getHiddenItems() {
  const data = await getJSON("/api/sponsor/catalog/hidden-items");
  return Array.isArray(data?.items) ? data.items : [];
}

async function openHiddenItemsView() {
  try {
    const hiddenItems = await getHiddenItems();

    if (!hiddenItems.length) {
      alert("There are no hidden items for your sponsor right now.");
      return;
    }

    const hiddenIds = hiddenItems.map((item) => Number(item.product_id));
    const hiddenProducts = allProducts.filter((product) =>
      hiddenIds.includes(Number(product.id))
    );

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0, 0, 0, 0.35)";
    overlay.style.backdropFilter = "blur(10px)";
    overlay.style.webkitBackdropFilter = "blur(10px)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "24px";

    const modal = document.createElement("div");
    modal.className = "content-box";
    modal.style.background = "rgba(255, 255, 255, 0.1)";
    modal.style.backdropFilter = "blur(12px)";
    modal.style.webkitBackdropFilter = "blur(12px)";
    modal.style.boxShadow = "0 20px 60px rgba(0,0,0,0.25)";
    modal.style.borderRadius = "16px";
    modal.style.width = "100%";
    modal.style.maxWidth = "900px";
    modal.style.maxHeight = "80vh";
    modal.style.overflow = "auto";

    modal.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <h3 style="margin:0;">Hidden Items</h3>
        <button id="closeHiddenItemsModal" class="btn btn-secondary" type="button">Close</button>
      </div>
      <div class="muted small" style="margin-top:6px;">
        Hidden for sponsor: ${CURRENT_USER_SPONSOR || "Unknown"}
      </div>
      <div id="hiddenItemsModalBody" style="margin-top:16px;"></div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const body = modal.querySelector("#hiddenItemsModalBody");

    if (!hiddenProducts.length) {
      body.innerHTML = `<p class="muted">No hidden product details could be loaded.</p>`;
    } else {
      hiddenProducts.forEach((product) => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.gap = "12px";
        row.style.padding = "12px 0";
        row.style.borderBottom = "1px solid rgba(0,0,0,0.08)";

        row.innerHTML = `
          <div>
            <div><strong>${product.title}</strong></div>
            <div class="muted small">Product ID: ${product.id}</div>
          </div>
          <button class="btn btn-primary restore-item-btn" data-id="${product.id}" type="button">
            Re-add
          </button>
        `;

        body.appendChild(row);
      });

      body.querySelectorAll(".restore-item-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const productId = Number(btn.dataset.id);

          try {
            await restoreCatalogItem(productId);
            HIDDEN_PRODUCT_IDS.delete(productId);
            applyFilters();
            overlay.remove();
          } catch (err) {
            console.error(err);
            alert("Could not restore item for this sponsor.");
          }
        });
      });
    }

    modal.querySelector("#closeHiddenItemsModal")?.addEventListener("click", () => {
      overlay.remove();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  } catch (err) {
    console.error(err);
    alert("Could not load hidden items.");
  }
}

function getSavedActiveDriverSponsor() {
  if (!CURRENT_USER_ID) return null;
  return localStorage.getItem(`activeDriverSponsor_${CURRENT_USER_ID}`);
}

function saveActiveDriverSponsor(sponsorName) {
  if (!CURRENT_USER_ID) return;
  localStorage.setItem(`activeDriverSponsor_${CURRENT_USER_ID}`, sponsorName || "");
}

async function loadDriverSponsors() {
  const data = await getJSON("/api/me/driver-sponsors");
  DRIVER_SPONSORS = Array.isArray(data?.sponsors) ? data.sponsors : [];
  return DRIVER_SPONSORS;
}

function getActiveDriverSponsorRecord() {
  return DRIVER_SPONSORS.find((s) => s.sponsor_name === ACTIVE_DRIVER_SPONSOR) || null;
}

function refreshActiveDriverSponsorPoints() {
  const rec = getActiveDriverSponsorRecord();
  CURRENT_USER_POINTS = rec ? Number(rec.points || 0) : 0;
  updatePointsDisplay();
}

function renderDriverSponsorDropdown() {
  const wrap = document.getElementById("driverSponsorPickerWrap");
  const select = document.getElementById("driverSponsorSelect");

  if (!wrap || !select) return;

  if (CURRENT_USER_ROLE !== "Driver" || DRIVER_SPONSORS.length === 0) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "block";
  select.innerHTML = "";

  DRIVER_SPONSORS.forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.sponsor_name;
    opt.textContent = `${row.sponsor_name} (${Number(row.points || 0)} pts)`;
    select.appendChild(opt);
  });

  const saved = getSavedActiveDriverSponsor();
  const validSaved = DRIVER_SPONSORS.some((s) => s.sponsor_name === saved);

  ACTIVE_DRIVER_SPONSOR = validSaved
    ? saved
    : DRIVER_SPONSORS[0].sponsor_name;

  select.value = ACTIVE_DRIVER_SPONSOR;
  saveActiveDriverSponsor(ACTIVE_DRIVER_SPONSOR);
  refreshActiveDriverSponsorPoints();

  select.addEventListener("change", () => {
    ACTIVE_DRIVER_SPONSOR = select.value || null;
    saveActiveDriverSponsor(ACTIVE_DRIVER_SPONSOR);
    loadCart();
    updateCartBadge();
    refreshActiveDriverSponsorPoints();
    renderCartPanel();
    renderRecommendedProducts();
    applyFilters();
  });
}

async function submitCatalogItemRequest(requestText) {
  const res = await fetch("/api/catalog/item-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify({ requestText })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data;
}

function wireCatalogRequestUI() {
  const section = document.getElementById("catalogRequestSection");
  const input = document.getElementById("catalogRequestInput");
  const submitBtn = document.getElementById("submitCatalogRequestBtn");
  const status = document.getElementById("catalogRequestStatus");

  if (!section || !input || !submitBtn || !status) return;

  section.style.display = "block";

  submitBtn.addEventListener("click", async () => {
    const text = String(input.value || "").trim();

    if (!text) {
      status.textContent = "Please enter an item request first.";
      return;
    }

    submitBtn.disabled = true;
    status.textContent = "Submitting request...";

    try {
      await submitCatalogItemRequest(text);
      input.value = "";
      status.textContent = "Request submitted to your sponsor.";
    } catch (err) {
      console.error(err);
      status.textContent = err.message || "Could not submit request.";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function setupAdminButton() {
  const res = await fetch('/api/me');
  const user = await res.json();

  if (user.role === 'Admin') {
    const btn = document.getElementById('adminReportsBtn');
    btn.style.display = 'block';

    btn.onclick = () => {
      window.location.href = '/Website/admin-reports.html';
    };
  }
}

function getSavedActiveAdminSponsor() {
  if (!CURRENT_USER_ID) return null;
  return localStorage.getItem(`activeAdminCatalogSponsor_${CURRENT_USER_ID}`);
}

function saveActiveAdminSponsor(sponsorName) {
  if (!CURRENT_USER_ID) return;
  localStorage.setItem(`activeAdminCatalogSponsor_${CURRENT_USER_ID}`, sponsorName || "");
}

async function loadAdminSponsors() {
  const data = await getJSON("/api/admin/sponsors");
  ADMIN_SPONSORS = Array.isArray(data) ? data.map(row => row.sponsor).filter(Boolean) : [];
  return ADMIN_SPONSORS;
}

function getEffectiveCatalogSponsor() {
  if (CURRENT_USER_ROLE === "Driver") return ACTIVE_DRIVER_SPONSOR || null;
  if (CURRENT_USER_ROLE === "Sponsor") return CURRENT_USER_SPONSOR || null;
  if (CURRENT_USER_ROLE === "Admin") return ACTIVE_ADMIN_SPONSOR || null;
  return null;
}

function renderCatalogSponsorDropdown() {
  const wrap = document.getElementById("catalogSponsorPickerWrap");
  const select = document.getElementById("catalogSponsorSelect");
  const label = document.getElementById("catalogSponsorLabel");

  if (!wrap || !select || !label) return;

  wrap.style.display = "none";
  select.innerHTML = "";

  if (CURRENT_USER_ROLE === "Driver") {
    if (!DRIVER_SPONSORS.length) return;

    wrap.style.display = "block";
    label.textContent = "Active Sponsor";

    DRIVER_SPONSORS.forEach((row) => {
      const opt = document.createElement("option");
      opt.value = row.sponsor_name;
      opt.textContent = `${row.sponsor_name} (${Number(row.points || 0)} pts)`;
      select.appendChild(opt);
    });

    const saved = getSavedActiveDriverSponsor();
    const validSaved = DRIVER_SPONSORS.some((s) => s.sponsor_name === saved);

    ACTIVE_DRIVER_SPONSOR = validSaved
      ? saved
      : DRIVER_SPONSORS[0]?.sponsor_name || null;

    select.value = ACTIVE_DRIVER_SPONSOR || "";
    refreshActiveDriverSponsorPoints();

    select.onchange = () => {
      ACTIVE_DRIVER_SPONSOR = select.value || null;
      saveActiveDriverSponsor(ACTIVE_DRIVER_SPONSOR);
      refreshActiveDriverSponsorPoints();
      loadCart();
      updateCartBadge();
      renderCartPanel();
      currentPage = 1;
      applyFilters();
    };

    return;
  }

  if (CURRENT_USER_ROLE === "Admin") {
    if (!ADMIN_SPONSORS.length) return;

    wrap.style.display = "block";
    label.textContent = "View Sponsor Catalog";

    ADMIN_SPONSORS.forEach((sponsorName) => {
      const opt = document.createElement("option");
      opt.value = sponsorName;
      opt.textContent = sponsorName;
      select.appendChild(opt);
    });

    const saved = getSavedActiveAdminSponsor();
    ACTIVE_ADMIN_SPONSOR = ADMIN_SPONSORS.includes(saved)
      ? saved
      : ADMIN_SPONSORS[0] || null;

    select.value = ACTIVE_ADMIN_SPONSOR || "";

    select.onchange = async () => {
      ACTIVE_ADMIN_SPONSOR = select.value || null;
      saveActiveAdminSponsor(ACTIVE_ADMIN_SPONSOR);
      await loadHiddenProductIds();
      currentPage = 1;
      applyFilters();
    };

    return;
  }
}

setupAdminButton();

document.addEventListener("DOMContentLoaded", async () => {
  const meBadge = document.getElementById("meBadge");
  const manageUsersBtn = document.getElementById("manageUsersBtn");

  const sponsorMenuWrap = document.getElementById("sponsorMenuWrap");
  const sponsorMenuBtn = document.getElementById("sponsorMenuBtn");
  const sponsorDropdown = document.getElementById("sponsorDropdown");

  const pendingBtn = document.getElementById("pendingAppsBtn");
  const createSponsorBtn = document.getElementById("createSponsorBtn");
  const sponsorDashboardBtn = document.getElementById("sponsorDashboardBtn");
  const hiddenItemsBtn = document.getElementById("hiddenItemsBtn");
  const sponsorBulkLoadBtn = document.getElementById("sponsorBulkLoadBtn");


  const cartBtn = document.getElementById("cartBtn");
  const cartPanel = document.getElementById("cartPanel");
  const clearCartBtn = document.getElementById("clearCartBtn");

  const shippingSelect = document.getElementById("shippingSelect");
  const confirmCheckoutBtn = document.getElementById("confirmCheckoutBtn");
  const cancelCheckoutBtn = document.getElementById("cancelCheckoutBtn");
  const checkoutPanel = document.getElementById("checkoutPanel");

  const transactionHistoryBtn = document.getElementById("transactionHistoryBtn");

  const notificationsBtn = document.getElementById("notificationsBtn");
  const notificationCount = document.getElementById("notificationCount");


  
  try {
    const me = await getJSON("/api/me");

    CURRENT_USER_ID = Number(me.id || 0);
    CURRENT_USER_ROLE = String(me.role || "");
    CURRENT_USER_SPONSOR = me.sponsor || null;

    if (CURRENT_USER_ROLE === "Driver") {
      await loadDriverSponsors();
      renderCatalogSponsorDropdown();
      loadCart();
    } else if (CURRENT_USER_ROLE === "Admin") {
      await loadAdminSponsors();
      renderCatalogSponsorDropdown();
      CURRENT_USER_POINTS = 0;
    } else {
      CURRENT_USER_POINTS = Number(me.points || 0);
    }

    if (CURRENT_USER_ROLE === "Driver") {
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

      if (shippingSelect) {
        shippingSelect.value = selectedShipping;

        shippingSelect.addEventListener("change", () => {
          selectedShipping = shippingSelect.value;
          updatePointsDisplay();
          renderCheckoutSummary();
          applyFilters();
        });
      }

      if (cancelCheckoutBtn) {
        cancelCheckoutBtn.addEventListener("click", () => {
          if (checkoutPanel) {
            checkoutPanel.style.display = "none";
          }
        });
      }

      if (confirmCheckoutBtn) {
        confirmCheckoutBtn.addEventListener("click", async () => {
          if (cart.length === 0) {
            alert("Your cart is empty.");
            return;
          }

          const totalPoints = getCheckoutPointsTotal();

          if (totalPoints > CURRENT_USER_POINTS) {
            alert("You do not have enough points for this checkout.");
            return;
          }

          const shippingLabel =
            selectedShipping === "overnight"
              ? "Expedited Overnight (+20%)"
              : "Standard Shipping (Free)";

          const confirmed = window.confirm(
            `Confirm checkout?\n\n` +
            `Items: ${getCartItemCount()}\n` +
            `Shipping: ${shippingLabel}\n` +
            `Total: ${totalPoints} points`
          );

          if (!confirmed) return;

          confirmCheckoutBtn.disabled = true;

          if (CURRENT_USER_ROLE === "Driver" && !ACTIVE_DRIVER_SPONSOR) {
            alert("Please select a sponsor before checkout.");
            return;
          }

          try {
            const res = await fetch("/api/orders/checkout", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              credentials: "same-origin",
              body: JSON.stringify({
                items: cart.map(item => ({
                  productId: item.productId,
                  qty: item.qty,
                  pointCost: item.pointCost,
                  dollarCost: item.dollarCost
                })),
                shipping_method: selectedShipping,
                shipping_point_cost: getShippingPointCost(),
                shipping_dollar_cost: getShippingDollarCost(),
                sponsor_name: ACTIVE_DRIVER_SPONSOR
              })
            });

            const data = await res.json();

            if (!res.ok) {
              throw new Error(data.error || "Checkout failed.");
            }

            CURRENT_USER_POINTS = Number(data.remainingPoints || 0);

            const activeRecord = DRIVER_SPONSORS.find(
              s => s.sponsor_name === ACTIVE_DRIVER_SPONSOR
            );
            if (activeRecord) {
              activeRecord.points = CURRENT_USER_POINTS;
            }
            
            clearCart();

            if (checkoutPanel) {
              checkoutPanel.style.display = "none";
            }

            updatePointsDisplay();
            updateCartBadge();
            renderCartPanel();
            applyFilters();

            alert("Order placed successfully.");

          } catch (err) {
            console.error("Checkout failed:", err);
            alert(err.message || "Checkout failed.");
          } finally {
            confirmCheckoutBtn.disabled = false;
          }
        });
      }

      renderCartPanel();

      if (transactionHistoryBtn) {
        transactionHistoryBtn.style.display = "inline-block";
        transactionHistoryBtn.addEventListener("click", () => {
          window.location.href = "/Website/transaction-history.html";
        });
      }

      wireCatalogRequestUI();
    }

    const sponsorText = me.sponsor ? ` • ${me.sponsor}` : "";
    meBadge.textContent = `Logged in as: ${me.role}${sponsorText}`;

    if (notificationsBtn) {
      notificationsBtn.style.display = "inline-block";

      notificationsBtn.addEventListener("click", () => {
        window.location.href = "/Website/notifications.html";
    });

  await loadNotificationCount();
}

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

      sponsorBulkLoadBtn.addEventListener("click", () => {
        window.location.href = "/Website/bulkload.html";
      });

      if (hiddenItemsBtn) {
        hiddenItemsBtn.style.display = "inline-block";
        hiddenItemsBtn.addEventListener("click", () => {
          openHiddenItemsView();
        });
      }

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

  const goToCheckoutBtn = document.getElementById("goToCheckoutBtn");
  if (goToCheckoutBtn) {
    goToCheckoutBtn.addEventListener("click", () => {
      if (cartPanel) cartPanel.style.display = "none";
      if (checkoutPanel) checkoutPanel.style.display = "block";

      checkoutPanel?.scrollIntoView({ behavior: "smooth" });
    });
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
    await loadHiddenProductIds();
    await initCatalogData();
    await loadRecommendations();
  } catch (err) {
    console.error("Failed to init catalog:", err);
    const grid = document.getElementById("productGrid");
    if (grid) grid.innerHTML = "<p>Failed to load catalog items.</p>";
  }
});