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
          <button class="btn btn-primary addPoints">+ Points</button>
          <button class="btn btn-secondary subtractPoints">− Points</button>
        </div>
      </td>
    `;
    // Connect to SQL
    row.querySelector(".addPoints").onclick = () => {
      promptAndUpdate(driver.driver_id);
    };
    row.querySelector(".subtractPoints").onclick = () => {
      promptAndUpdate(driver.driver_id);
    };

    tbody.appendChild(row);
  });
}

document.addEventListener("DOMContentLoaded", loadDrivers);

async function promptAndUpdate(driverId) {
  // Asking for number of points
  const amount = parseInt(prompt("Enter number of points (use negative to deduct):"));
  if (isNaN(amount)) {
    alert("Invalid number of points.");
    return;
  }
  // Asking for reason 
  const reason = prompt("Enter the reason for this points adjustment:");
  if (!reason || reason.trim() === "") {
    alert("A reason is required.");
    return;
  }
  await updateDriverPoints(driverId, amount, reason);
}

async function updateAllDrivers() {
  // Asking for number of points
  const amount = parseInt(prompt("Enter points to award/deduct for ALL drivers (negative example: -50):"));
  if (isNaN(amount)) {
    alert("Invalid number.");
    return;
  }
  // Asking for reason
  const reason = prompt("Enter reason for the adjustment:");
  if (!reason) {
    alert("Reason required.");
    return;
  }

  const response = await fetch("/api/sponsor/drivers");
  const drivers = await response.json();

  for (const driver of drivers) {
    await updateDriverPoints(driver.driver_id, amount, reason);
  }
}

document.getElementById("awardAll").onclick = updateAllDrivers;
document.getElementById("deductAll").onclick = updateAllDrivers;

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

async function updateDriverPoints(driverId, amount, reason) {

  // NOTE: Need to edit allowing negative funcitonality back in
  // const allowNegative = allowNegativeSelect.value === "true";

  try {
    const response = await fetch("/api/points/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        driverId: driverId,
        amount: amount,
        reason: reason,
        // allowNegative: allowNegative
      })
    });
    
    // Check if points updated
    if (!response.ok) {
      alert("Failed to update points.");
      return;
    }

    loadDrivers();

  } catch (err) {
    console.error("Point update error:", err);
  }
}


