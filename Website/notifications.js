async function getJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}`);
  }
  return res.json();
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

function prettyType(type) {
  switch (type) {
    case "order_shipped":
      return "Order Shipped";
    case "order_out_for_delivery":
      return "Out for Delivery";
    case "order_delivered":
      return "Delivered";
    default:
      return type.replaceAll("_", " ");
  }
}

async function markNotificationOpened(notificationId) {
  const res = await fetch(`/api/notifications/${notificationId}/open`, {
    method: "POST",
    credentials: "same-origin"
  });

  if (!res.ok) {
    throw new Error(`Open notification failed: ${res.status}`);
  }

  return res.json();
}

function renderNotifications(notifications) {
  const container = document.getElementById("notificationsContainer");
  if (!container) return;

  container.innerHTML = "";

  if (!Array.isArray(notifications) || notifications.length === 0) {
    container.innerHTML = `
      <div class="content-box">
        <p class="muted" style="margin:0;">You have no notifications right now.</p>
      </div>
    `;
    return;
  }

  notifications.forEach((n) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "content-box";
    card.style.marginTop = "16px";
    card.style.width = "100%";
    card.style.textAlign = "left";
    card.style.cursor = "pointer";
    card.style.borderLeft = n.read_at ? "4px solid #ccc" : "4px solid #2f6fed";
    card.style.background = "#fff";

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 6px 0;">${n.title}</h3>
          <div class="muted small">
            ${prettyType(n.type)}
            ${n.related_entity_id ? `• Ref ${n.related_entity_id}` : ""}
          </div>
        </div>

        <div class="muted small">${n.read_at ? "Read" : "Unread"}</div>
      </div>

      <p style="margin:14px 0 8px 0;">${n.message}</p>

      <div class="muted small">Available: ${formatDateTime(n.scheduled_for)}</div>
    `;

    card.addEventListener("click", async () => {
      try {
        await markNotificationOpened(n.id);
        await loadNotifications();
      } catch (err) {
        console.error(err);
        alert("Could not open notification.");
      }
    });

    container.appendChild(card);
  });
}

async function loadNotifications() {
  const data = await getJSON("/api/notifications");
  renderNotifications(data);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const me = await getJSON("/api/me");

    const meBadge = document.getElementById("meBadge");
    if (meBadge) {
      const sponsorText = me.sponsor ? ` • ${me.sponsor}` : "";
      meBadge.textContent = `Logged in as: ${me.role}${sponsorText}`;
    }

    await loadNotifications();
  } catch (err) {
    console.error("Failed to load notifications page:", err);
    const container = document.getElementById("notificationsContainer");
    if (container) {
      container.innerHTML = `
        <div class="content-box">
          <p style="margin:0;">Failed to load notifications.</p>
        </div>
      `;
    }
  }

  document.getElementById("markAllReadBtn")?.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/notifications/read-all", {
        method: "POST",
        credentials: "same-origin"
      });

      if (!res.ok) {
        throw new Error(`Read all failed: ${res.status}`);
      }

      await loadNotifications();
    } catch (err) {
      console.error(err);
      alert("Could not mark all notifications as read.");
    }
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