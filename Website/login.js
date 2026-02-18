document.addEventListener("DOMContentLoaded", () => {

  const loginForm = document.querySelector(".form");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  const msg = document.createElement("p");
  msg.className = "muted small";
  msg.style.marginTop = "10px";
  loginForm.appendChild(msg);

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";

    const payload = {
      username: usernameInput.value.trim(),
      password: passwordInput.value
    };

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        msg.textContent = data.message || "Login failed.";
        return;
      }

      msg.textContent = "Login successful!";
      setTimeout(() => window.location.href = "/Website/catalog.html", 600);

    } catch (err) {
      msg.textContent = "Network error.";
    }
  });

});
