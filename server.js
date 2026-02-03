const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

//Allow app to use files from other folders
app.use(express.static("Website"));
app.use("/Images", express.static("Images"));

//API Endpoint for dynamic frontend
//Get this info later from DB
app.get("/api/about", (req, res) => {
  res.json({
    productName: "Good Driver Incentive Program",
    version: "1.0",
    releaseDate: "Spring 2026",
    teamNumber: "Team 19",
    sprint: "Sprint 1"
  });
});

//Route to about page when first opened
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Website", "about.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});