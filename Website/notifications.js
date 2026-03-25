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
    case "catalog_item_request":
      return "Catalog Item Request";
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

async function clearNotification(notificationId) {
  const res = await fetch(`/api/notifications/${notificationId}`, {
    method: "DELETE",
    credentials: "same-origin"
  });

  if (!res.ok) {
    throw new Error(`Clear notification failed: ${res.status}`);
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
    card.style.width = "100%";
    card.style.display = "block";
    card.style.textAlign = "left";
    card.style.marginTop = "16px";
    card.style.padding = "32px 40px";
    card.style.cursor = "pointer";
    card.style.background = "linear-gradient(135deg, rgba(30,30,50,0.85), rgba(20,40,70,0.85))";
    card.style.backdropFilter = "blur(12px)";
    card.style.webkitBackdropFilter = "blur(12px)";
    card.style.color = "#fff";
    card.style.border = "1px solid rgba(255,255,255,0.1)";
    card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.4)";
    card.style.borderRadius = "16px";


    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 6px 0; color:#fff;">${n.title}</h3>
          <div class="muted small" style="color: rgba(255,255,255,0.7);">
            ${prettyType(n.type)}
            ${n.related_entity_id ? `• Ref ${n.related_entity_id}` : ""}
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <div class="muted small" style="color: rgba(255,255,255,0.7);">
            ${n.read_at ? "Read" : "Unread"}
          </div>

          <button
            class="clear-notification-btn btn btn-primary"
            type="button"
            data-id="${n.id}"
            style="padding:8px 16px;"
          >
            Clear
          </button>
        </div>
      </div>

      <p style="margin:14px 0 8px 0; color:rgba(255,255,255,0.9);">${n.message}</p>

      <div class="muted small" style="color: rgba(255,255,255,0.7);">
        Available: ${formatDateTime(n.scheduled_for)}
      </div>
    `;

    const clearBtn = card.querySelector(".clear-notification-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", async (e) => {
        e.stopPropagation();

        try {
          await clearNotification(n.id);
          await loadNotifications();
        } catch (err) {
          console.error(err);
          alert("Could not clear notification.");
        }
      });
    }

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