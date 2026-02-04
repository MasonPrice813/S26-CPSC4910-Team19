const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use("/Website", express.static(path.join(__dirname, "Website")));
app.use("/Images", express.static(path.join(__dirname, "Images")));

// Sprint dates
const sprintDates = [
  { num: 1, start: "2026-01-27", end: "2026-02-02" },
  { num: 2, start: "2026-02-03", end: "2026-02-09" },
  { num: 3, start: "2026-02-10", end: "2026-02-16" },
  { num: 4, start: "2026-02-17", end: "2026-02-23" },
  { num: 5, start: "2026-02-24", end: "2026-03-02" },
  { num: 6, start: "2026-03-03", end: "2026-03-09" },
  { num: 7, start: "2026-03-10", end: "2026-03-23" },
  { num: 8, start: "2026-03-24", end: "2026-03-30" },
  { num: 9, start: "2026-03-31", end: "2026-04-06" },
  { num: 10, start: "2026-04-07", end: "2026-04-13" },
];

function currentSprint(dates, now = new Date()) {
  // Convert today's date to YYYY-MM-DD string
  const todayStr = now.toISOString().slice(0, 10);

  for (const s of dates) {
    if (todayStr >= s.start && todayStr <= s.end) {
      return s.num;
    }
  }
  return null;
}

// API route
app.get("/api/about", (req, res) => {
  const sprint = currentSprint(sprintDates);

  res.json({
    productName: "Good Driver Incentive Program",
    version: "1.2",
    releaseDate: "Spring 2026",
    teamNumber: "Team 19",
    sprint: sprint ?? "No active sprint",
  });
});

// Root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Website", "about.html"));
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});