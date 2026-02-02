const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.static("Website"));
app.use("/Images", express.static("Images"));

app.get("/api/about", (req, res) => {
  res.json({
    productName: "Good Driver Incentive Program",
    version: "1.0",
    releaseDate: "Spring 2026",
    teamNumber: "Team 19",
    sprint: "Sprint 1"
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Website", "about.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});