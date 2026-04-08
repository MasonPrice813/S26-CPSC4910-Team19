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

const pointsPerDollarInput = document.getElementById("pointsPerDollarInput");
const currentRatioText = document.getElementById("currentRatioText");

const includeTransactionsCheckbox = document.getElementById("includeTransactions");
const includePointHistoryCheckbox = document.getElementById("includePointHistory");
const reportStartDateInput = document.getElementById("reportStartDate");
const reportEndDateInput = document.getElementById("reportEndDate");

const reportAllDriversCheckbox = document.getElementById("reportAllDriversCheckbox");
const reportDriverCheckboxList = document.getElementById("reportDriverCheckboxList");

const generatePdfReportBtn = document.getElementById("generatePdfReportBtn");

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function setSponsorHeader(name) {
  sponsorName = name || "";
  const heading = document.getElementById("sponsorNameHeading");
  if (heading) {
    heading.textContent = sponsorName || "Sponsor Dashboard";
  }
}

async function loadDashboardSummary() {
  try {
    const response = await fetch("/api/sponsor/dashboard-summary");
    if (!response.ok) throw new Error("Failed to load dashboard summary");

    const data = await response.json();

    setSponsorHeader(data.sponsorName);

    const activeDriversStat = document.getElementById("activeDriversStat");
    const totalPointsStat = document.getElementById("totalPointsStat");
    const pendingApplicationsStat = document.getElementById("pendingApplicationsStat");

    if (activeDriversStat) {
      activeDriversStat.textContent = formatNumber(data.activeDrivers);
    }

    if (totalPointsStat) {
      totalPointsStat.textContent = formatNumber(data.totalPointsAwarded);
    }

    if (pendingApplicationsStat) {
      pendingApplicationsStat.textContent = formatNumber(data.pendingApplications || 0);
    }
  } catch (err) {
    console.error("Error loading dashboard summary:", err);
  }
}

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

function setQuickStats(drivers, pendingApplicationsCount = null) {
  const activeDriversStat = document.getElementById("activeDriversStat");
  const totalPointsStat = document.getElementById("totalPointsStat");
  const pendingApplicationsStat = document.getElementById("pendingApplicationsStat");

  if (activeDriversStat) {
    activeDriversStat.textContent = formatNumber(drivers.length);
  }

  if (totalPointsStat) {
    totalPointsStat.textContent = formatNumber(
      drivers.reduce((sum, driver) => sum + Number(driver.points || 0), 0)
    );
  }

  if (pendingApplicationsStat && pendingApplicationsCount !== null) {
    pendingApplicationsStat.textContent = formatNumber(pendingApplicationsCount || 0);
  }
}

async function fetchPendingApplicationsCount() {
  try {
    const response = await fetch("/api/sponsor/applications");
    if (!response.ok) throw new Error("Failed to load applications");

    const data = await response.json();
    return Array.isArray(data.applications) ? data.applications.length : 0;
  } catch (err) {
    console.error("Error loading applications:", err);
    return 0;
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

    const pendingCount = await fetchPendingApplicationsCount();
    setQuickStats(sponsorDriversCache, pendingCount);

    return sponsorDriversCache;
  } catch (err) {
    console.error("Error loading drivers:", err);
    sponsorDriversCache = [];
    populateDriverDropdowns([]);
    setQuickStats([], 0);
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

  if (reportDriverCheckboxList) {
    reportDriverCheckboxList.innerHTML = "";
  }

  if (reportAllDriversCheckbox) {
    reportAllDriversCheckbox.checked = true;
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

    if (reportDriverCheckboxList) {
      const wrapper = document.createElement("label");
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "10px";
      wrapper.style.padding = "6px 0";
      wrapper.style.width = "fit-content";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "report-driver-checkbox";
      checkbox.value = userId;
      checkbox.dataset.driverId = userId;
      checkbox.style.width = "auto";
      checkbox.style.margin = "0";
      checkbox.style.flex = "0 0 auto";

      checkbox.addEventListener("change", () => {
        if (!reportAllDriversCheckbox) return;

        if (checkbox.checked) {
          reportAllDriversCheckbox.checked = false;
        }

        const anyChecked = reportDriverCheckboxList.querySelector(".report-driver-checkbox:checked");
        if (!anyChecked) {
          reportAllDriversCheckbox.checked = true;
        }
      });

      const text = document.createElement("span");
      text.textContent = label || `Driver ${userId}`;

      wrapper.appendChild(checkbox);
      wrapper.appendChild(text);
      reportDriverCheckboxList.appendChild(wrapper);
    }
  });
}

function getSelectedReportDriverIds() {
  if (!reportDriverCheckboxList || !reportAllDriversCheckbox) return [];

  if (reportAllDriversCheckbox.checked) {
    return [];
  }

  const checkedBoxes = Array.from(
    reportDriverCheckboxList.querySelectorAll(".report-driver-checkbox:checked")
  );

  if (!checkedBoxes.length) {
    return [];
  }

  return checkedBoxes
    .map(box => Number(box.value))
    .filter(Number.isFinite);
}

async function generateSponsorPdfReport() {
  const includeTransactions = !!includeTransactionsCheckbox?.checked;
  const includePointHistory = !!includePointHistoryCheckbox?.checked;
  const startDate = reportStartDateInput?.value || "";
  const endDate = reportEndDateInput?.value || "";
  const driverIds = getSelectedReportDriverIds();

  if (!includeTransactions && !includePointHistory) {
    alert("Select at least one report category.");
    return;
  }

  if (startDate && endDate && startDate > endDate) {
    alert("Start date cannot be after end date.");
    return;
  }

  try {
    const response = await fetch("/api/sponsor/reports/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        includeTransactions,
        includePointHistory,
        startDate,
        endDate,
        driverIds
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      alert(err.error || "Failed to generate PDF report.");
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "sponsor-report.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("PDF report generation error:", err);
    alert("Failed to generate PDF report.");
  }
}

generatePdfReportBtn?.addEventListener("click", generateSponsorPdfReport);

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
      const pendingCount = await fetchPendingApplicationsCount();
      setQuickStats(sponsorDriversCache, pendingCount);
      return;
    }

    sponsorTransactionsCache.forEach(tx => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${tx.first_name || ""} ${tx.last_name || ""}</td>
        <td>${tx.product_id || "—"}</td>
        <td>${tx.point_cost ?? "—"}</td>
        <td>$${tx.dollar_cost ? Number(tx.dollar_cost).toFixed(2) : "—"}</td>
        <td>${tx.shipping_method || "—"}</td>
        <td>${formatDateOnly(tx.date_ordered)}</td>
      `;

      tableBody.appendChild(row);
    });

    const pendingCount = await fetchPendingApplicationsCount();
    setQuickStats(sponsorDriversCache, pendingCount);
  } catch (err) {
    console.error("Error loading transactions:", err);
    sponsorTransactionsCache = [];

    tableBody.innerHTML = `
      <tr>
        <td colspan="5">Unable to load transaction history.</td>
      </tr>
    `;

    const pendingCount = await fetchPendingApplicationsCount();
    setQuickStats(sponsorDriversCache, pendingCount);
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

    const ratio = Number(data.pointsPerDollar || 10);

    if (pointsPerDollarInput) {
      pointsPerDollarInput.value = ratio;
    }

    if (currentRatioText) {
      currentRatioText.textContent = `Current dollar/point ratio: ${ratio} pts/$1`;
    }
  } catch (err) {
    console.error("Error loading settings:", err);
  }
}

saveCriteriaBtn?.addEventListener("click", async () => {
  const criteria = criteriaTextarea.value;
  const allowNegative = allowNegativeSelect.value === "yes";
  const pointsPerDollar = Number(pointsPerDollarInput?.value || 10);

  if (!Number.isInteger(pointsPerDollar) || pointsPerDollar <= 0) {
    alert("Please enter a valid whole number for points per $1.");
    return;
  }

  try {
    const response = await fetch("/api/sponsor/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pointsCriteria: criteria,
        allowNegative,
        pointsPerDollar
      })
    });

    if (response.ok) {
      if (currentRatioText) {
        currentRatioText.textContent = `Current dollar/point ratio: ${pointsPerDollar} pts/$1`;
      }
      alert("Settings saved successfully.");
    } else {
      const data = await response.json().catch(() => ({}));
      alert(data.error || "Failed to save settings.");
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

async function approveApplication(applicationId) {
  try {
    const response = await fetch(`/api/sponsor/applications/${applicationId}/approve`, {
      method: "POST"
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      alert(errorData.error || "Failed to approve application.");
      return;
    }

    await loadApplications();
    await loadDrivers();
    await loadDashboardSummary();
    await renderChart();
  } catch (err) {
    console.error("Approve application error:", err);
    alert("Failed to approve application.");
  }
}

async function rejectApplication(applicationId) {
  const reason = prompt("Enter reason for rejection:");

  if (!reason || !reason.trim()) {
    alert("Rejection reason is required.");
    return;
  }

  try {
    const response = await fetch(`/api/sponsor/applications/${applicationId}/reject`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ reason })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      alert(errorData.error || "Failed to reject application.");
      return;
    }

    await loadApplications();
    await loadDashboardSummary();
  } catch (err) {
    console.error("Reject application error:", err);
    alert("Failed to reject application.");
  }
}

function buildApplicationViewMessage(app) {
  return [
    `Name: ${app.first_name || ""} ${app.last_name || ""}`.trim(),
    `Email: ${app.email || "—"}`,
    `Phone: ${app.phone_number || "—"}`,
    `Sponsor: ${app.sponsor || "—"}`,
    `Username: ${app.username || "—"}`,
    `Age: ${app.age || "—"}`,
    `DOB: ${app.dob ? formatDateOnly(app.dob) : "—"}`,
    `SSN Last 4: ${app.ssn_last4 || "—"}`,
    `Driver License #: ${app.dl_num || "—"}`,
    `DL Expiration: ${app.dl_expiration ? formatDateOnly(app.dl_expiration) : "—"}`,
    `Driving Record: ${app.driving_record || "—"}`,
    `Criminal History: ${app.criminal_history || "—"}`
  ].join("\n");
}

async function loadApplications() {
  const tbody = document.getElementById("applicationsTableBody");
  if (!tbody) return;

  try {
    const response = await fetch("/api/sponsor/applications");
    if (!response.ok) throw new Error("Failed to load applications");

    const data = await response.json();
    const applications = Array.isArray(data.applications) ? data.applications : [];

    tbody.innerHTML = "";

    if (!applications.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4">No pending applications</td>
        </tr>
      `;
      return;
    }

    applications.forEach(app => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${app.first_name || ""} ${app.last_name || ""}</td>
        <td>${app.email || "—"}</td>
        <td>${formatDateOnly(app.created_at)}</td>
        <td>
          <div class="application-actions">
            <button class="btn btn-primary approve-app-btn">Approve</button>
            <button class="btn btn-secondary reject-app-btn">Reject</button>
            <button class="btn btn-secondary view-app-btn">View</button>
          </div>
        </td>
      `;

      row.querySelector(".approve-app-btn").onclick = () => approveApplication(app.id);
      row.querySelector(".reject-app-btn").onclick = () => rejectApplication(app.id);
      row.querySelector(".view-app-btn").onclick = () => {
        alert(buildApplicationViewMessage(app));
      };

      tbody.appendChild(row);
    });
  } catch (err) {
    console.error("Error loading applications:", err);
    tbody.innerHTML = `
      <tr>
        <td colspan="4">Unable to load applications</td>
      </tr>
    `;
  }
}

reportAllDriversCheckbox?.addEventListener("change", () => {
  if (!reportDriverCheckboxList) return;

  const driverCheckboxes = reportDriverCheckboxList.querySelectorAll(".report-driver-checkbox");

  if (reportAllDriversCheckbox.checked) {
    driverCheckboxes.forEach(box => {
      box.checked = false;
    });
  }
});

timeViewSelect?.addEventListener("change", renderChart);
driverFilterSelect?.addEventListener("change", renderChart);
transactionDriverFilter?.addEventListener("change", loadTransactions);
transactionRangeFilter?.addEventListener("change", loadTransactions);

document.addEventListener("DOMContentLoaded", async () => {
  await loadDashboardSummary();
  await loadDrivers();
  await loadApplications();
  await renderChart();
  await loadSponsorSettings();
  await loadTransactions();
});