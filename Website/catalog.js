async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

document.addEventListener("DOMContentLoaded", async () => {
  const meBadge = document.getElementById("meBadge");
  const pendingBtn = document.getElementById("pendingAppsBtn");
  const createSponsorBtn = document.getElementById("createSponsorBtn");

  try {
    const me = await getJSON("/api/me");
    const sponsorText = me.sponsor ? ` • ${me.sponsor}` : "";
    meBadge.textContent = `Logged in as: ${me.role}${sponsorText}`;

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

  document.getElementById("profileBtn").addEventListener("click", async () => {
    window.location.href = "/Website/profile.html";
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin"
      });

      //After session is destroyed, redirect
      window.location.href = "/Website/login.html";

    } catch (err) {
      console.error("Logout failed:", err);
      window.location.href = "/Website/login.html";
    }
  });

});
