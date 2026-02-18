const express = require("express");
const path = require("path");
require("dotenv").config();
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const session = require("express-session");

const app = express();
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

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


app.get("/api/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  res.json(req.session.user);
});

let applicationSchema = { customFields: [] };

//Anyone can read the application schema
app.get("/api/application-schema", (req, res) => {
  res.json(applicationSchema);
});

function requireSponsor(req, res, next) {
  const me = req.session.user;
  if (!me) return res.status(401).json({ error: "Not logged in" });
  if (me.role !== "Sponsor") return res.status(403).json({ error: "Forbidden" });
  req.me = me;
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

    const normalizedRole = role === "Administrator" ? "Admin" : role;

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
    console.error("Insert application error:", {
    code: err.code,
    errno: err.errno,
    sqlMessage: err.sqlMessage,
    sqlState: err.sqlState,
  });

    return res.status(500).json({
      error: "Could not save application.",
      details: err.sqlMessage || err.code
    });
  }
});

app.get("/api/sponsor/applications", requireSponsor, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         id,
         role,
         first_name,
         last_name,
         username,
         email,
         phone_number,
         sponsor,
         ssn_last4,
         age,
         dob,
         driving_record,
         criminal_history,
         dl_num,
         dl_expiration
       FROM applications
       WHERE role = 'Driver' AND sponsor = ?
       ORDER BY id DESC`,
      [req.me.sponsor]
    );

    res.json({ applications: rows });
  } catch (err) {
    console.error("sponsor applications error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

//API to move driver data from applications table to users and drivers table
app.post("/api/sponsor/applications/:id/approve", requireSponsor, async (req, res) => {
  const appId = Number(req.params.id);
  if (!Number.isFinite(appId)) return res.status(400).json({ error: "Invalid id" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [apps] = await conn.query(
      `SELECT id, first_name, last_name, username, email, password, phone_number, sponsor
       FROM applications
       WHERE id = ? AND role = 'Driver' AND sponsor = ?
       FOR UPDATE`,
      [appId, req.me.sponsor]
    );

    if (apps.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Application not found for your sponsor." });
    }

    const a = apps[0];

    const hashedPw = await bcrypt.hash(a.password, 12);

    const [userResult] = await conn.query(
      `INSERT INTO users
         (role, first_name, last_name, username, email, password, phone_number, sponsor)
       VALUES
         (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "Driver",
        a.first_name,
        a.last_name,
        a.username,
        a.email,
        hashedPw,
        a.phone_number || null,
        a.sponsor,
      ]
    );

    const newUserId = userResult.insertId;

    await conn.query(
      `INSERT INTO drivers (user_id)
       VALUES (?)`,
      [newUserId]
    );

    //Delete from applications
    await conn.query(`DELETE FROM applications WHERE id = ?`, [a.id]);

    await conn.commit();
    res.json({ ok: true, user_id: newUserId });
  } catch (err) {
    await conn.rollback();
    console.error("approve error:", err);

    res.status(500).json({ error: "Could not approve application." });
  } finally {
    conn.release();
  }
});

//API to remove application from table when rejected
app.post("/api/sponsor/applications/:id/reject", requireSponsor, async (req, res) => {
  const appId = Number(req.params.id);
  if (!Number.isFinite(appId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [result] = await pool.query(
      `DELETE FROM applications
       WHERE id = ? AND role = 'Driver' AND sponsor = ?`,
      [appId, req.me.sponsor]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Application not found for your sponsor." });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("reject error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ----------------- AUTH: LOGIN -----------------
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, role, sponsor, password
       FROM users
       WHERE username = ?
       LIMIT 1`,
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const user = rows[0];
    const stored = user.password || "";

    let valid = false;

    // If bcrypt hash
    if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
      valid = await bcrypt.compare(password, stored);
    } else {
      // Plaintext fallback (temporary compatibility)
      valid = password === stored;
    }

    if (!valid) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    // Auto-upgrade plaintext passwords to bcrypt
    if (!(stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$"))) {
      const newHash = await bcrypt.hash(password, 12);
      await pool.query(
        `UPDATE users SET password = ? WHERE id = ?`,
        [newHash, user.id]
      );
    }

    req.session.user = {
      id: user.id,
      username: username,
      role: user.role,
      sponsor: user.sponsor || null
    };

    return res.json({
      ok: true,
      user: {
        id: user.id,
        role: user.role,
        sponsor: user.sponsor || null
      }
    });

  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ----------------- LOGOUT -----------------
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ----------------- FORGOT PASSWORD -----------------

//Rate limit to prevent brute force attempts
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, //15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth/forgot", forgotLimiter);

//In-memory reset sessions
const resetSessions = new Map();
const RESET_TTL_MS = 10 * 60 * 1000; // 10 minutes

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function cleanupExpiredResetSessions() {
  const now = Date.now();
  for (const [key, val] of resetSessions.entries()) {
    if (val.expiresAt <= now) {
      resetSessions.delete(key);
    }
  }
}

//Verify username + email + phone_number
app.post("/api/auth/forgot/verify", async (req, res) => {
  cleanupExpiredResetSessions();

  const { username, email, phone_number } = req.body || {};

  if (!username || !email || !phone_number) {
    return res.status(400).json({
      message: "Username, email, and phone number are required."
    });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, phone_number
       FROM users
       WHERE username = ? AND email = ?
       LIMIT 1`,
      [username, email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Verification failed." });
    }

    const dbPhone = normalizePhone(rows[0].phone_number);
    const inputPhone = normalizePhone(phone_number);

    if (dbPhone !== inputPhone) {
      return res.status(401).json({ message: "Verification failed." });
    }

    const resetId = crypto.randomBytes(24).toString("hex");

    resetSessions.set(resetId, {
      user_id: rows[0].id,
      expiresAt: Date.now() + RESET_TTL_MS
    });

    return res.json({ resetId });

  } catch (err) {
    console.error("forgot verify error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});

//Set new password for verified user
app.post("/api/auth/forgot/reset", async (req, res) => {
  cleanupExpiredResetSessions();

  const { resetId, newPassword } = req.body || {};
  if (!resetId || !newPassword) {
    return res.status(400).json({ message: "Missing resetId or newPassword." });
  }

  const session = resetSessions.get(resetId);
  if (!session || session.expiresAt <= Date.now()) {
    return res.status(401).json({ message: "Reset session expired. Please verify again." });
  }

  const pw = String(newPassword);

  //At least 8 chars, one lowercase, one uppercase, one number
  const strongPw = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  if (!strongPw.test(pw)) {
    return res.status(400).json({
      message: "Password must be at least 8 characters and include 1 uppercase letter, 1 lowercase letter, and 1 number."
    });
  }

  try {
    const hash = await bcrypt.hash(newPassword, 12);

    await pool.query(
      `UPDATE users
       SET password = ?
       WHERE id = ?`,
      [hash, session.user_id]
    );

    resetSessions.delete(resetId);

    return res.json({ message: "Password updated." });
  } catch (err) {
    console.error("forgot reset error:", err);
    return res.status(500).json({ message: "Server error." });
  }
});


//Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});