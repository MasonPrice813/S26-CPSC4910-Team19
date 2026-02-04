//Calling server.js endpoint and retrieving values returned
fetch("/api/about")
  .then((res) => res.json())
  .then((data) => {
    document.getElementById("productName").textContent = data.productName;
    document.getElementById("version").textContent = data.version;
    document.getElementById("releaseDate").textContent = data.releaseDate;
    document.getElementById("teamNumber").textContent = data.teamNumber;
    document.getElementById("productDescription").textContent = data.productDescription;
  })
  .catch(() => {
    document.getElementById("sprint").textContent = "Unavailable";
  });