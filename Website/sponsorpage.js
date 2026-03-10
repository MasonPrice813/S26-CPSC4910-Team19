const ctx = document.getElementById("pointsChart")?.getContext("2d");
let pointsChart;

const timeViewSelect = document.getElementById("timeView");
const driverFilterSelect = document.getElementById("driverFilter");

const criteriaTextarea = document.getElementById("pointsCriteria");
const allowNegativeSelect = document.getElementById("allowNegative");
const saveCriteriaBtn = document.getElementById("saveCriteriaBtn");

/* ============================
   FETCH POINTS DATA
============================ */

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
  if (!ctx) return;

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
        label: driverId === "all"
          ? "Average Points (All Drivers)"
          : "Driver Points",
        data: values,
        borderWidth: 3,
        tension: 0.3
      }]
    }
  });
}

timeViewSelect?.addEventListener("change", renderChart);
driverFilterSelect?.addEventListener("change", renderChart);
renderChart();

/* ============================
   LOADING DRIVER'S POINTS TABLE
============================ */
async function loadDrivers() {
  const response = await fetch("/api/sponsor/drivers");
  const drivers = await response.json();
  const tbody = document.querySelector(".driver-table tbody");
  tbody.innerHTML = "";

  drivers.forEach(driver => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${driver.first_name} ${driver.last_name}</td>
      <td>${driver.email}</td>
      <td>${driver.points}</td>
      <td>
        <div class="driver-actions">
          <button class="btn btn-secondary">Edit</button>
          <button class="btn btn-primary">+ Points</button>
          <button class="btn btn-secondary">− Points</button>
        </div>
      </td>
    `;

    tbody.appendChild(row);
  });
}

document.addEventListener("DOMContentLoaded", loadDrivers);

/* ============================
   LOAD EXISTING SETTINGS
============================ */

async function loadSponsorSettings() {
  try {
    const response = await fetch("/api/sponsor/settings");
    if (!response.ok) return;

    const data = await response.json();

    criteriaTextarea.value = data.pointsCriteria || "";
    allowNegativeSelect.value = data.allowNegative ? "true" : "false";
  } catch (err) {
    console.error("Error loading settings:", err);
  }
}

loadSponsorSettings();

/* ============================
   SAVE SETTINGS TO DATABASE
============================ */

saveCriteriaBtn.addEventListener("click", async () => {
  const criteria = criteriaTextarea.value;
  const allowNegative = allowNegativeSelect.value === "true";

  try {
    const response = await fetch("/api/sponsor/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pointsCriteria: criteria,
        allowNegative: allowNegative
      })
    });

    if (response.ok) {
      alert("Settings saved successfully.");
    } else {
      alert("Failed to save settings.");
    }
  } catch (err) {
    console.error("Save error:", err);
  }
});

/* ============================
   MODIFY POINTS FUNCTION
   (Ensures DB knows if negative allowed)
============================ */

async function updateDriverPoints(driverId, amount) {

  const allowNegative = allowNegativeSelect.value === "true";

  try {
    await fetch("/api/points/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        driverId: driverId,
        amount: amount,
        allowNegative: allowNegative
      })
    });

  } catch (err) {
    console.error("Point update error:", err);
  }
}

