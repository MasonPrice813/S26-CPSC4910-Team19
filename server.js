const express = require("express");
const path = require("path");
require("dotenv").config();
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

//Serve static files
app.use("/Website", express.static(path.join(__dirname, "Website")));
app.use("/Images", express.static(path.join(__dirname, "Images")));

//API route
app.get("/api/about", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT team_num, sprint_num, release_date, product_name, product_description
       FROM about_page
       LIMIT 1`
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "about_page table is empty" });
    }

    const row = rows[0];

    res.json({
      teamNumber: `Team ${row.team_num}`,
      version: `Sprint ${row.sprint_num}`,
      releaseDate: row.release_date,
      productName: row.product_name,
      productDescription: row.product_description
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

//Root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Website", "about.html"));
});


// ------- UI DEV ONLY -------
app.get("/api/me", (req, res) => {
  //Hardcoded for building UI
  res.json({ role: "Sponsor" }); 
});
// ---------------------------

let applicationSchema = { customFields: [] };

//Anyone can read the application schema
app.get("/api/application-schema", (req, res) => {
  res.json(applicationSchema);
});

// Middleware to enforce Sponsor-only access
function requireSponsor(req, res, next) {
  const role = "Sponsor"; //Hardcoded for testing
  if (role !== "Sponsor") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

//Only sponsors can modify the schema
app.put(
  "/api/application-schema",
  express.json(),
  requireSponsor,
  (req, res) => {
    applicationSchema = req.body;
    res.json({ ok: true, schema: applicationSchema });
  }
);

//Posting application data to DB on submit
app.post("/api/applications", async (req, res) => {
  try {
    const {
      role,
      first_name,
      last_name,
      username,
      password,
      email,
      phone_number,
      sponsor,
      ssn_last4,
      age,
      dob,
      driving_record,
      criminal_history,
      dl_num,
      dl_expiration,
    } = req.body || {};

    if (!role || !first_name || !last_name || !email || !password) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const [result] = await pool.query(
      `INSERT INTO applications
        (role, first_name, last_name, username, password, email, phone_number, sponsor,
         ssn_last4, age, dob, driving_record, criminal_history, dl_num, dl_expiration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedRole,
        first_name,
        last_name,
        username || null,
        password,
        email,
        phone_number || null,
        sponsor || null,
        ssn_last4 || null,
        age || null,
        dob || null,
        driving_record || null,
        criminal_history || null,
        dl_num || null,
        dl_expiration || null,
      ]
    );

    res.status(201).json({ ok: true, application_id: result.insertId });
  } catch (err) {
    console.error("Insert application error:", err);
    return res.status(500).json({ error: "Could not save application." });
  }
});


//Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});