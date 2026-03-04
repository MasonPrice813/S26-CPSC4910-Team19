async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function getProductId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

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

let selectedRating = 0;

/* Load product */
async function loadProduct() {
  const id = getProductId();
  const product = await getJSON(`https://dummyjson.com/products/${id}`);
  const container = document.getElementById("productContainer");

  const pointsCost = dollarsToPoints(product.price);
  const dollarsLabel = formatDollars(product.price);

  container.innerHTML = `
    <div class="content-box">

      <h2>${product.title}</h2>

      <img src="${product.thumbnail}" style="width:300px">

      <p>${product.description}</p>

      <div style="margin-top:10px;">
        <h3 style="margin:0;">${pointsCost} points</h3>
        <div class="muted small">(${dollarsLabel})</div>
      </div>

      <button class="btn btn-primary" style="margin-top:15px;">
        Redeem
      </button>

    </div>
  `;
}

/* Stars */
function setupStars() {

  const stars = document.querySelectorAll(".star");

  stars.forEach(star => {

    star.addEventListener("click", () => {

      selectedRating = parseInt(star.dataset.value);

      stars.forEach(s => s.classList.remove("active"));

      for (let i = 0; i < selectedRating; i++) {
        stars[i].classList.add("active");
      }

    });

  });

}

/* Load reviews */
async function loadReviews() {

  const id = getProductId();

  const reviews = await getJSON(`/api/reviews/${id}`);

  const reviewDiv = document.getElementById("reviews");

  reviewDiv.innerHTML = "";

  if (!reviews.length) {
    reviewDiv.innerHTML = "<p>No reviews yet.</p>";
    return;
  }

  reviews.forEach(r => {

    const div = document.createElement("div");

    div.className = "content-box";

    div.innerHTML = `
      <strong>${"⭐".repeat(r.rating)}</strong>
      <p>${r.review_text}</p>
      <small>By ${r.username} • ${new Date(r.created_at).toLocaleDateString()}</small>
    `;

    reviewDiv.appendChild(div);

  });

}

/* Submit review */
document.getElementById("submitReview").addEventListener("click", async () => {

  const id = getProductId();

  const text = document.getElementById("reviewText").value;

  if (!selectedRating) {
    alert("Please select a star rating");
    return;
  }

  if (!text.trim()) {
    alert("Please write a review");
    return;
  }

  await fetch("/api/reviews", {

    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      product_id: id,
      rating: selectedRating,
      text: text
    })

  });

  document.getElementById("reviewText").value = "";

  selectedRating = 0;

  const stars = document.querySelectorAll(".star");
  stars.forEach(s => s.classList.remove("active"));

  loadReviews();

});

/* Page load */
document.addEventListener("DOMContentLoaded", () => {

  loadProduct();

  setupStars();

  loadReviews();

});