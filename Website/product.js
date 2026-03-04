async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

function getProductId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

let selectedRating = 0;

async function loadProduct() {

  const id = getProductId();

  const product = await getJSON(`https://fakestoreapi.com/products/${id}`);

  const container = document.getElementById("productContainer");

  container.innerHTML = `
    <div class="content-box">

      <h2>${product.title}</h2>

      <img src="${product.image}" style="width:300px">

      <p>${product.description}</p>

      <h3>$${product.price}</h3>

      <button class="btn btn-primary" style="margin-top:15px;">
        Redeem
      </button>

    </div>
  `;
}

function setupStars() {

  const stars = document.querySelectorAll(".star");

  stars.forEach(star => {

    star.addEventListener("click", () => {

      selectedRating = star.dataset.value;

      stars.forEach(s => s.classList.remove("active"));

      for (let i = 0; i < selectedRating; i++) {
        stars[i].classList.add("active");
      }

    });

  });

}

function loadReviews() {

  const id = getProductId();

  const reviews = JSON.parse(localStorage.getItem("reviews_" + id)) || [];

  const reviewDiv = document.getElementById("reviews");

  reviewDiv.innerHTML = "";

  reviews.forEach(r => {

    const div = document.createElement("div");

    div.className = "content-box";

    div.innerHTML = `
      <strong>${"⭐".repeat(r.rating)}</strong>
      <p>${r.text}</p>
    `;

    reviewDiv.appendChild(div);

  });

}

document.getElementById("submitReview").addEventListener("click", () => {

  const id = getProductId();

  const text = document.getElementById("reviewText").value;

  if (!selectedRating) {
    alert("Please select a star rating");
    return;
  }

  const reviews = JSON.parse(localStorage.getItem("reviews_" + id)) || [];

  reviews.push({
    rating: selectedRating,
    text
  });

  localStorage.setItem("reviews_" + id, JSON.stringify(reviews));

  document.getElementById("reviewText").value = "";

  loadReviews();

});

document.addEventListener("DOMContentLoaded", () => {

  loadProduct();

  setupStars();

  loadReviews();

});