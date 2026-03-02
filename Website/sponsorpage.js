const ctx = document.getElementById("pointsChart").getContext("2d");
let pointsChart;
const timeViewSelect = document.getElementById("timeView");
const driverFilterSelect = document.getElementById("driverFilter");

// Getting the data from mySQL
async function fetchPointsData(view, driverId) {
  try {
    const response = await fetch(`/api/points?view=${view}&driver=${driverId}`);
    if (!response.ok) {
      console.error("Server error:", response.status);
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      console.error("Unexpected response:", data);
      return [];
    }
    return data;
  } 
  catch (err) {
    console.error("Fetch error:", err);
    return [];
  }
}

async function renderChart() {
    const view = timeViewSelect.value;
    const driverId = driverFilterSelect.value;
    const data = await fetchPointsData(view, driverId);
    const labels = data.map(d => d.label);
    const values = data.map(d => d.value);
    
    if (pointsChart) {
        pointsChart.destroy();
    }
    
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
        }
    });
}

// When user changes the dropdowns
timeViewSelect.addEventListener("change", renderChart);
driverFilterSelect.addEventListener("change", renderChart);
renderChart();