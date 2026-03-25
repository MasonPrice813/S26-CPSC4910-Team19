const ctx = document.getElementById("pointsChart")?.getContext("2d");
let pointsChart;
let sponsorDriversCache = [];
let sponsorTransactionsCache = [];
let sponsorName = "";

const timeViewSelect = document.getElementById("timeView");
const driverFilterSelect = document.getElementById("driverFilter");
const transactionDriverFilter = document.getElementById("transactionDriverFilter");

const criteriaTextarea = document.getElementById("pointsCriteria");
const allowNegativeSelect = document.getElementById("allowNegative");
const saveCriteriaBtn = document.getElementById("saveSettingsBtn");

const transactionRangeFilter = document.getElementById("transactionRangeFilter");

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatDateOnly(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function getDriverId(driver) {
  return driver.driver_id ?? driver.user_id;
}

function setQuickStats(drivers, transactions) {
  const activeDriversStat = document.getElementById("activeDriversStat");
  const totalPointsStat = document.getElementById("totalPointsStat");
  const transactionsShownStat = document.getElementById("transactionsShownStat");

  if (activeDriversStat) {
    activeDriversStat.textContent = String(drivers.length);
  }

  if (totalPointsStat) {
    totalPointsStat.textContent = String(
      drivers.reduce((sum, driver) => sum + Number(driver.points || 0), 0)
    );
  }

  if (transactionsShownStat) {
    transactionsShownStat.textContent = String(transactions.length);
  }
}

async function fetchPointsData(view, driverId) {
  try {
    const response = await fetch(`/api/points?view=${view}&driver=${driverId}`);
    if (!response.ok) return [];
    return await response.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function renderChart() {
  if (!ctx || !timeViewSelect || !driverFilterSelect) return;

  const view = timeViewSelect.value;
  const driverId = driverFilterSelect.value;
  const data = await fetchPointsData(view, driverId);
  const labels = data.map(d => d.label);
  const values = data.map(d => d.value);

  if (pointsChart) pointsChart.destroy();

  pointsChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: driverId === "all" ? "Average Points (All Drivers)" : "Driver Points",
        data: values,
        borderWidth: 3,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true
    }
  });
}

async function loadDrivers() {
  try {
    const response = await fetch("/api/sponsor/drivers");
    if (!response.ok) throw new Error("Failed to load sponsor drivers");

    const drivers = await response.json();
    sponsorDriversCache = Array.isArray(drivers) ? drivers : [];

    const tbody = document.getElementById("driverManagementTableBody");
    if (tbody) {
      tbody.innerHTML = "";

      sponsorDriversCache.forEach(driver => {
        const row = document.createElement("tr");
        const driverId = getDriverId(driver);

        row.innerHTML = `
          <td>${driver.first_name || ""} ${driver.last_name || ""}</td>
          <td>${driver.email || "—"}</td>
          <td>${driver.points ?? 0}</td>
          <td>
            <div class="driver-actions">
              <button class="btn btn-primary addPoints">+ Points</button>
              <button class="btn btn-secondary subtractPoints">− Points</button>
            </div>
          </td>
        `;

        row.querySelector(".addPoints").onclick = () => promptAndUpdate(driverId, false);
        row.querySelector(".subtractPoints").onclick = () => promptAndUpdate(driverId, true);
        tbody.appendChild(row);
      });
    }

    populateDriverDropdowns(sponsorDriversCache);
    return sponsorDriversCache;
  } catch (err) {
    console.error("Error loading drivers:", err);
    sponsorDriversCache = [];
    populateDriverDropdowns([]);
    return [];
  }
}

function populateDriverDropdowns(drivers) {
  const recurringSelect = document.getElementById("driverSelect");
  const chartSelect = document.getElementById("driverFilter");
  const transactionSelect = document.getElementById("transactionDriverFilter");

  if (recurringSelect) {
    recurringSelect.innerHTML = "";
  }

  if (chartSelect) {
    chartSelect.innerHTML = '<option value="all">All Drivers (Average)</option>';
  }

  if (transactionSelect) {
    transactionSelect.innerHTML = '<option value="all">All Drivers</option>';
  }

  drivers.forEach(driver => {
    const label = `${driver.first_name || ""} ${driver.last_name || ""}`.trim();
    const pointsDriverId = driver.driver_id;
    const userId = driver.user_id;

    if (recurringSelect) {
      const recurringOption = document.createElement("option");
      recurringOption.value = pointsDriverId;
      recurringOption.textContent = label;
      recurringSelect.appendChild(recurringOption);
    }

    if (chartSelect) {
      const chartOption = document.createElement("option");
      chartOption.value = pointsDriverId;
      chartOption.textContent = label;
      chartSelect.appendChild(chartOption);
    }

    if (transactionSelect) {
      const txOption = document.createElement("option");
      txOption.value = userId;
      txOption.textContent = label;
      transactionSelect.appendChild(txOption);
    }
  });
}

async function loadTransactions() {
  const tableBody = document.getElementById("transactionTableBody");
  if (!tableBody) return;

  try {
    const selectedDriverId = transactionDriverFilter?.value || "all";
    const selectedRange = transactionRangeFilter?.value || "1m";

    const params = new URLSearchParams();

    if (selectedDriverId !== "all") {
      params.append("driver_id", selectedDriverId);
    }

    if (selectedRange) {
      params.append("range", selectedRange);
    }

    const url = `/api/sponsor/transactions${params.toString() ? `?${params.toString()}` : ""}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to load transactions");

    const transactions = await response.json();
    sponsorTransactionsCache = Array.isArray(transactions) ? transactions : [];

    tableBody.innerHTML = "";

    if (!sponsorTransactionsCache.length) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5">No transactions found.</td>
        </tr>
      `;
      setQuickStats(sponsorDriversCache, sponsorTransactionsCache);
      return;
    }

    sponsorTransactionsCache.forEach(tx => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${tx.first_name || ""} ${tx.last_name || ""}</td>
        <td>${tx.product_id || "—"}</td>
        <td>${tx.point_cost ?? "—"}</td>
        <td>${tx.shipping_method || "—"}</td>
        <td>${formatDateOnly(tx.date_ordered)}</td>
      `;

      tableBody.appendChild(row);
    });

    setQuickStats(sponsorDriversCache, sponsorTransactionsCache);
  } catch (err) {
    console.error("Error loading transactions:", err);
    sponsorTransactionsCache = [];

    tableBody.innerHTML = `
      <tr>
        <td colspan="5">Unable to load transaction history.</td>
      </tr>
    `;

    setQuickStats(sponsorDriversCache, sponsorTransactionsCache);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const radios = document.querySelectorAll('input[name="targetType"]');
  const driverSelect = document.getElementById("driverSelect");

  radios.forEach(radio => {
    radio.addEventListener("change", () => {
      if (!driverSelect) return;
      driverSelect.style.display =
        radio.value === "specific" && radio.checked ? "block" : "none";
    });
  });
});

document.getElementById("startRecurring")?.addEventListener("click", async () => {
  const amount = parseInt(document.getElementById("recurringAmount")?.value, 10);
  const interval = document.getElementById("recurringInterval")?.value;
  const targetType = document.querySelector('input[name="targetType"]:checked')?.value;
  const reason = document.getElementById("recurringReason")?.value;
  const driverSelect = document.getElementById("driverSelect");

  let targetIds = [];

  if (targetType === "specific" && driverSelect) {
    targetIds = Array.from(driverSelect.selectedOptions).map(opt => opt.value);
  }

  if (isNaN(amount)) {
    alert("Enter a valid number");
    return;
  }

  if (!reason || reason.trim() === "") {
    alert("Reason is required");
    return;
  }

  try {
    const response = await fetch("/api/recurring/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount, interval, targetType, targetIds, reason })
    });

    if (!response.ok) {
      alert("Failed to start recurring points.");
      return;
    }

    alert("Recurring points started!");
  } catch (err) {
    console.error(err);
    alert("Failed to start recurring points.");
  }
});

document.getElementById("stopRecurring")?.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/recurring/active");
    if (!res.ok) {
      alert("Failed to load active recurring processes.");
      return;
    }

    const rules = await res.json();

    if (!Array.isArray(rules) || rules.length === 0) {
      alert("No active recurring processes.");
      return;
    }

    const options = rules
      .map(rule => `ID: ${rule.id} | ${rule.points_amount} pts | ${rule.interval_type}`)
      .join("\n");

    const selectedId = prompt(
      `Select the ID of the recurring process to stop:\n\n${options}`
    );

    if (!selectedId) return;

    const stopResponse = await fetch("/api/recurring/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: parseInt(selectedId, 10) })
    });

    if (!stopResponse.ok) {
      alert("Failed to stop recurring process.");
      return;
    }

    alert("Recurring process stopped.");
  } catch (err) {
    console.error(err);
    alert("Failed to stop recurring process.");
  }
});

async function promptAndUpdate(driverId, forceNegative) {
  let amount = parseInt(
    prompt(`Enter number of points${forceNegative ? " to deduct" : " to add"}:`),
    10
  );

  if (isNaN(amount)) {
    alert("Invalid number of points.");
    return;
  }

  if (forceNegative && amount > 0) {
    amount = -amount;
  }

  const reason = prompt("Enter the reason for this points adjustment:");
  if (!reason || reason.trim() === "") {
    alert("A reason is required.");
    return;
  }

  await updateDriverPoints(driverId, amount, reason);
}

async function updateAllDrivers() {
  const amount = parseInt(
    prompt("Enter points to award/deduct for ALL drivers (negative example: -50):"),
    10
  );

  if (isNaN(amount)) {
    alert("Invalid number.");
    return;
  }

  const reason = prompt("Enter reason for the adjustment:");
  if (!reason || reason.trim() === "") {
    alert("Reason required.");
    return;
  }

  try {
    const response = await fetch("/api/sponsor/drivers");
    if (!response.ok) {
      alert("Failed to load drivers.");
      return;
    }

    const drivers = await response.json();

    for (const driver of drivers) {
      const driverId = driver.driver_id;
      await updateDriverPoints(driverId, amount, reason, false);
    }

    alert("All drivers updated.");
  } catch (err) {
    console.error(err);
    alert("Failed to update all drivers.");
  }
}

document.getElementById("awardAll")?.addEventListener("click", () => updateAllDrivers());
document.getElementById("deductAll")?.addEventListener("click", () => updateAllDrivers());

async function loadSponsorSettings() {
  try {
    const response = await fetch("/api/sponsor/settings");
    if (!response.ok) return;

    const data = await response.json();

    criteriaTextarea.value = data.pointsCriteria || "";
    allowNegativeSelect.value = data.allowNegative ? "yes" : "no";
  } catch (err) {
    console.error("Error loading settings:", err);
  }
}

saveCriteriaBtn?.addEventListener("click", async () => {
  const criteria = criteriaTextarea.value;
  const allowNegative = allowNegativeSelect.value === "yes";

  try {
    const response = await fetch("/api/sponsor/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pointsCriteria: criteria,
        allowNegative
      })
    });

    if (response.ok) {
      alert("Settings saved successfully.");
    } else {
      alert("Failed to save settings.");
    }
  } catch (err) {
    console.error("Save error:", err);
    alert("Failed to save settings.");
  }
});

async function updateDriverPoints(driverId, amount, reason, refreshAfter = true) {
  try {
    const response = await fetch("/api/points/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        driverId,
        amount,
        reason
      })
    });

    if (!response.ok) {
      alert("Failed to update points.");
      return false;
    }

    if (refreshAfter) {
      await loadDrivers();
      await renderChart();
      await loadTransactions();
    }

    return true;
  } catch (err) {
    console.error("Point update error:", err);
    alert("Failed to update points.");
    return false;
  }
}

timeViewSelect?.addEventListener("change", renderChart);
driverFilterSelect?.addEventListener("change", renderChart);
transactionDriverFilter?.addEventListener("change", loadTransactions);
transactionRangeFilter?.addEventListener("change", loadTransactions);

document.addEventListener("DOMContentLoaded", async () => {
  await loadDrivers();
  await renderChart();
  await loadSponsorSettings();
  await loadTransactions();
});