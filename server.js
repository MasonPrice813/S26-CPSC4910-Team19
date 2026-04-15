const express = require("express");
const path = require("path");
require("dotenv").config();
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");
const session = require("express-session");

const app = express();
app.use(express.json());

const { parseBulkFile } = require("./Website/bulkParser");
const storagebulk = multer.memoryStorage();
const uploadText = multer({
 storage: storagebulk,
});

const PDFDocument = require("pdfkit");


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
app.use("/TextSample", express.static(path.join(__dirname, "TextSample")));

const uploadDir = path.join(__dirname, "Uploads");

// Serve images from /Uploads
app.use("/Uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `user_${req.session.user.id}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG and PNG images allowed"));
    }
    cb(null, true);
  }
});

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


app.get("/api/me", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const me = req.session.user;

  try {
    if (me.role === "Driver") {
      return res.json({
        ...me,
        points: 0
      });
    }

    return res.json(me);
  } catch (err) {
    console.error("/api/me error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/me/driver-sponsors", requireLogin, async (req, res) => {
  try {
    if (req.session.user.role !== "Driver") {
      return res.status(403).json({ error: "Drivers only" });
    }

    const [rows] = await pool.query(
      `SELECT
         sponsor_name,
         points,
         status
       FROM user_sponsors
       WHERE user_id = ?
         AND status = 'Active'
       ORDER BY sponsor_name ASC`,
      [req.session.user.id]
    );

    res.json({ sponsors: rows });
  } catch (err) {
    console.error("driver sponsors error:", err);
    res.status(500).json({ error: "Database error" });
  }
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

//Sponsor only: create another sponsor user under the same sponsor
app.post("/api/sponsor/sponsor-users", requireSponsor, async (req, res) => {
  const {
    first_name,
    last_name,
    username,
    password,
    email,
    phone_number
  } = req.body || {};

  if (!first_name || !last_name || !username || !password || !email || !phone_number) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const sponsorName = req.me.sponsor;
  if (!sponsorName) {
    return res.status(400).json({ error: "Your sponsor account is missing a sponsor value." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    //Hash password
    const hashedPw = await bcrypt.hash(password, 12);

    //Insert into users
    const [userResult] = await conn.query(
      `INSERT INTO users
         (role, first_name, last_name, username, email, password, phone_number, sponsor)
       VALUES
         (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "Sponsor",
        first_name,
        last_name,
        username,
        email,
        hashedPw,
        phone_number,
        sponsorName
      ]
    );

    const newUserId = userResult.insertId;

    //Insert into sponsors
    await conn.query(
      `INSERT INTO sponsors (user_id)
       VALUES (?)`,
      [newUserId]
    );

    await conn.commit();
    return res.status(201).json({ ok: true, user_id: newUserId });
  } catch (err) {
    await conn.rollback();

    //Duplicate errors
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Username or email already exists." });
    }

    console.error("create sponsor user error:", err);
    return res.status(500).json({ error: "Could not create sponsor user." });
  } finally {
    conn.release();
  }
});


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
  const conn = await pool.getConnection();

  try {
    const {
      role,
      first_name,
      last_name,
      username,
      password,
      email,
      phone_number,
      sponsors = [],
      ssn_last4,
      age,
      dob,
      driving_record,
      criminal_history,
      dl_num,
      dl_expiration
    } = req.body || {};

    if (!role || !first_name || !last_name || !email || !password) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const normalizedRole = role === "Administrator" ? "Admin" : role;

    if (normalizedRole === "Driver" && (!Array.isArray(sponsors) || sponsors.length === 0)) {
      return res.status(400).json({ error: "Drivers must select at least one sponsor." });
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO applications
        (role, first_name, last_name, username, password, email, phone_number,
         ssn_last4, age, dob, driving_record, criminal_history, dl_num, dl_expiration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedRole,
        first_name,
        last_name,
        username || null,
        password,
        email,
        phone_number || null,
        ssn_last4 || null,
        age || null,
        dob || null,
        driving_record || null,
        criminal_history || null,
        dl_num || null,
        dl_expiration || null
      ]
    );

    const applicationId = result.insertId;

    if (normalizedRole === "Driver") {
      for (const sponsorName of sponsors) {
        await conn.query(
          `INSERT INTO application_sponsors (application_id, sponsor_name)
           VALUES (?, ?)`,
          [applicationId, sponsorName]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ ok: true, application_id: applicationId });
  } catch (err) {
    await conn.rollback();
    console.error("Insert application error:", err);
    res.status(500).json({ error: "Could not save application." });
  } finally {
    conn.release();
  }
});

app.get("/api/sponsor/applications", requireSponsor, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
          a.id,
          a.role,
          a.first_name,
          a.last_name,
          a.username,
          a.email,
          a.phone_number,
          aps.sponsor_name AS sponsor,
          a.ssn_last4,
          a.age,
          a.dob,
          a.driving_record,
          a.criminal_history,
          a.dl_num,
          a.dl_expiration,
          a.status,
          a.rejection_reason,
          a.reviewed_at,
          a.created_at
        FROM applications a
        JOIN application_sponsors aps
          ON aps.application_id = a.id
        WHERE a.role = 'Driver'
          AND aps.sponsor_name = ?
          AND a.status = 'Pending'
        ORDER BY a.id DESC`,
      [req.me.sponsor]
    );

    res.json({ applications: rows });
  } catch (err) {
    console.error("sponsor applications error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// API for bug reports
app.get("/api/bugs", async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                b.id,
                b.status,
                b.description,
                b.user_id,
                c.id AS comment_id,
                c.comment
            FROM bug_reports b
            LEFT JOIN bug_comments c ON b.id = c.bug_id
            ORDER BY b.id;
        `);

        const bugsMap = {};

        for (const row of rows) {
            if (!bugsMap[row.id]) {
                bugsMap[row.id] = {
                    id: row.id,
                    status: row.status,
                    description: row.description,
                    user_id: row.user_id,
                    comments: []
                };
            }

            if (row.comment) {
                bugsMap[row.id].comments.push({
                    id: row.comment_id,
                    comment: row.comment
                });
            }
        }

        res.json({ bugs: Object.values(bugsMap) });

    } catch (err) {
        console.error("ERROR:", err);
        res.status(500).json({ error: "Failed to load bugs" });
    }
});

//API to move driver data from applications table to users and drivers table
app.post("/api/sponsor/applications/:id/approve", requireSponsor, async (req, res) => {
  const appId = Number(req.params.id);
  if (!Number.isFinite(appId)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [apps] = await conn.query(
      `SELECT
          a.id,
          a.first_name,
          a.last_name,
          a.username,
          a.email,
          a.password,
          a.phone_number
       FROM applications a
       JOIN application_sponsors aps
         ON aps.application_id = a.id
       WHERE a.id = ?
         AND a.role = 'Driver'
         AND aps.sponsor_name = ?
         AND a.status = 'Pending'
       FOR UPDATE`,
      [appId, req.me.sponsor]
    );

    if (apps.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Application not found for your sponsor." });
    }

    const a = apps[0];

    // Find or create user
    const [existingUsers] = await conn.query(
      `SELECT id
       FROM users
       WHERE email = ? OR username = ?
       LIMIT 1`,
      [a.email, a.username]
    );

    let userId;

    if (existingUsers.length > 0) {
      userId = existingUsers[0].id;
    } else {
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
          req.me.sponsor // compatibility field only
        ]
      );

      userId = userResult.insertId;
    }

    // Ensure drivers row exists
    const [existingDriver] = await conn.query(
      `SELECT id
       FROM drivers
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );

    let driverId;

    if (existingDriver.length > 0) {
      driverId = existingDriver[0].id;
    } else {
      const [driverResult] = await conn.query(
        `INSERT INTO drivers (user_id)
         VALUES (?)`,
        [userId]
      );
      driverId = driverResult.insertId;
    }

    // Link user to ALL sponsors on the application
    const [appSponsors] = await conn.query(
      `SELECT sponsor_name
       FROM application_sponsors
       WHERE application_id = ?`,
      [a.id]
    );

    for (const row of appSponsors) {
      await conn.query(
        `INSERT IGNORE INTO user_sponsors (user_id, sponsor_name, points, status)
         VALUES (?, ?, 0, 'Active')`,
        [userId, row.sponsor_name]
      );
    }

    // Mark application accepted
    await conn.query(
      `UPDATE applications
       SET status = 'Accepted',
           rejection_reason = NULL,
           reviewed_at = NOW()
       WHERE id = ?`,
      [a.id]
    );

    await conn.commit();
    res.json({ ok: true, user_id: userId, driver_id: driverId });
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
  const { reason } = req.body || {};

  if (!Number.isFinite(appId)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: "Rejection reason is required." });
  }

  try {
    const [result] = await pool.query(
      `UPDATE applications a
      JOIN application_sponsors aps
        ON aps.application_id = a.id
      SET a.status = 'Rejected',
          a.rejection_reason = ?,
          a.reviewed_at = NOW()
      WHERE a.id = ?
        AND a.role = 'Driver'
        AND aps.sponsor_name = ?
        AND a.status = 'Pending'`,
      [String(reason).trim(), appId, req.me.sponsor]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Pending application not found for your sponsor." });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("reject error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

async function logLoginAttempt(username, status) {
  try {
    await pool.query(
      `INSERT INTO login_attempts (username, status)
       VALUES (?, ?)`,
      [String(username || "").trim(), status]
    );
  } catch (err) {
    console.error("login attempt logging error:", err);
  }
}

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
      await logLoginAttempt(username, "FAILURE");
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const user = rows[0];
    const stored = user.password || "";

    let valid = false;

    if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
      valid = await bcrypt.compare(password, stored);
    } else {
      valid = password === stored;
    }

    if (!valid) {
      await logLoginAttempt(username, "FAILURE");
      return res.status(401).json({ message: "Invalid username or password." });
    }

    if (!stored.startsWith("$2a$") && !stored.startsWith("$2b$") && !stored.startsWith("$2y$")) {
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

    await logLoginAttempt(username, "SUCCESS");

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

//Helper: require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  next();
}

// Full profile for the currently logged-in user (users + user_profiles)
app.get("/api/me/profile", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [userRows] = await pool.query(
      `SELECT id, role, first_name, last_name, username, email, phone_number, sponsor
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (userRows.length === 0) return res.status(404).json({ error: "User not found" });
    const u = userRows[0];

    const [profRows] = await pool.query(
      `SELECT bio, prior_experience, address_text, profile_image_url, crop_x, crop_y
       FROM user_profiles
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );
    const p = profRows[0] || null;

    //Refresh session fields
    req.session.user = {
      ...req.session.user,
      id: u.id,
      username: u.username,
      role: u.role,
      sponsor: u.sponsor || null,
    };

    res.json({ user: u, profile: p });
  } catch (err) {
    console.error("me/profile error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

function requireAdmin(req, res, next) {
  const me = req.session.user;
  if (!me) return res.status(401).json({ error: "Not logged in" });
  if (me.role !== "Admin") return res.status(403).json({ error: "Admins only" });
  req.me = me;
  next();
}

//Change password while logged in
app.post("/api/me/password", requireLogin, async (req, res) => {
  const { newPassword } = req.body || {};
  const pw = String(newPassword || "");

  const strongPw = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!strongPw.test(pw)) {
    return res.status(400).json({
      message:
        "Password must be at least 8 characters and include 1 uppercase letter, 1 lowercase letter, and 1 number."
    });
  }

  try {
    const hash = await bcrypt.hash(pw, 12);
    await pool.query(`UPDATE users SET password = ? WHERE id = ?`, [hash, req.session.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("me/password error:", err);
    res.status(500).json({ message: "Server error." });
  }
});

//Save bio/prior experiebce/address/crop for logged-in user
app.put("/api/me/profile", requireLogin, async (req, res) => {
  const userId = req.session.user.id;

  const bio = req.body?.bio ?? "";
  const prior_experience = req.body?.prior_experience ?? "";
  const address_text = req.body?.address_text ?? "";
  const crop_x = req.body?.crop_x ?? null;
  const crop_y = req.body?.crop_y ?? null;

  try {
    await pool.query(
      `
      INSERT INTO user_profiles (user_id, bio, prior_experience, address_text, crop_x, crop_y)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        bio = VALUES(bio),
        prior_experience = VALUES(prior_experience),
        address_text = VALUES(address_text),
        crop_x = VALUES(crop_x),
        crop_y = VALUES(crop_y)
      `,
      [userId, bio, prior_experience, address_text, crop_x, crop_y]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("save profile error:", err);
    res.status(500).json({ error: "Could not save profile" });
  }
});

//Upload profile picture for logged-in user
app.post("/api/me/profile/photo", requireLogin, upload.single("photo"), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const url = `/Uploads/${req.file.filename}`;

    await pool.query(
      `
      INSERT INTO user_profiles (user_id, profile_image_url)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE profile_image_url = VALUES(profile_image_url)
      `,
      [userId, url]
    );

    res.json({ ok: true, url });
  } catch (err) {
    console.error("photo upload error:", err);
    res.status(500).json({ error: "Could not upload photo" });
  }
});

//Remove profile picture (keeps other profile fields)
app.delete("/api/me/profile/photo", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    await pool.query(
      `
      INSERT INTO user_profiles (user_id, profile_image_url, crop_x, crop_y)
      VALUES (?, NULL, NULL, NULL)
      ON DUPLICATE KEY UPDATE
        profile_image_url = NULL,
        crop_x = NULL,
        crop_y = NULL
      `,
      [userId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("photo delete error:", err);
    res.status(500).json({ error: "Could not remove photo" });
  }
});

app.get("/api/me/points-history", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ error: "Not logged in" });
    }
    const userId = req.session.user.id;
    
    // Get driver_id from drivers table
    const [[driver]] = await pool.query(
      `SELECT id FROM drivers WHERE user_id = ?`,
      [userId]
    );

    if (!driver) {
      return res.json([]);
    }

    const [rows] = await pool.query(
      `SELECT 
         points_change,
         points_before,
         points_after,
         reason,
         created_at
       FROM driver_point_history
       WHERE driver_id = ?
       ORDER BY created_at DESC`,
      [driver.id]
    );
    res.json(rows);
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

//Admin: list/search users across all sponsors
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const search = String(req.query.search || "").trim();
  const role = String(req.query.role || "All").trim();

  const where = [];
  const params = [];

  //Logged in user cannot search/edit themselves
  where.push("u.id <> ?");
  params.push(req.me.id);

  if (role && role !== "All") {
    where.push("u.role = ?");
    params.push(role);
  }

  if (search) {
    where.push("(u.first_name LIKE ? OR u.last_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)");
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const [rows] = await pool.query(
      `
      SELECT
        u.id,
        u.role,
        u.first_name,
        u.last_name,
        u.username,
        u.email,
        u.phone_number,
        u.sponsor,
        GROUP_CONCAT(DISTINCT us.sponsor_name ORDER BY us.sponsor_name SEPARATOR ', ') AS sponsors
      FROM users u
      LEFT JOIN user_sponsors us
        ON us.user_id = u.id
      AND us.status = 'Active'
      ${whereSql}
      GROUP BY
        u.id, u.role, u.first_name, u.last_name, u.username, u.email, u.phone_number, u.sponsor
      ORDER BY u.last_name ASC, u.first_name ASC
      LIMIT 200
      `,
      params
    );

    res.json({ users: rows });
  } catch (err) {
    console.error("admin users list error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

function roleTable(role) {
  if (role === "Driver") return "drivers";
  if (role === "Sponsor") return "sponsors";
  if (role === "Admin") return "admins";
  return null;
}

app.post("/api/admin/users/admin", requireAdmin, async (req, res) => {
  const {
    first_name,
    last_name,
    username,
    email,
    password,
    phone_number
  } = req.body || {};

  if (!first_name || !last_name || !username || !email || !password || !phone_number) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const pw = String(password);
  const strongPw = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  if (!strongPw.test(pw)) {
    return res.status(400).json({
      error: "Password must be at least 8 characters and include 1 uppercase letter, 1 lowercase letter, and 1 number."
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const hashedPw = await bcrypt.hash(password, 12);

    const [userResult] = await conn.query(
      `INSERT INTO users
         (role, first_name, last_name, username, email, password, phone_number, sponsor)
       VALUES
         (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "Admin",
        String(first_name).trim(),
        String(last_name).trim(),
        String(username).trim(),
        String(email).trim(),
        hashedPw,
        String(phone_number).trim(),
        null
      ]
    );

    const newUserId = userResult.insertId;

    await conn.query(
      `INSERT INTO admins (user_id)
       VALUES (?)`,
      [newUserId]
    );

    await conn.commit();
    res.status(201).json({ ok: true, user_id: newUserId });
  } catch (err) {
    await conn.rollback();

    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Username or email already exists." });
    }

    console.error("create admin user error:", err);
    res.status(500).json({ error: "Could not create admin user." });
  } finally {
    conn.release();
  }
});

app.patch("/api/admin/users/:id/role", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const newRole = String(req.body?.role || "").trim();

  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
  if (!["Driver", "Sponsor", "Admin"].includes(newRole)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  //Prevent admin from locking themselves out
  if (req.me.id === userId && newRole !== "Admin") {
    return res.status(400).json({ error: "You cannot change your own role away from Admin." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, role FROM users WHERE id = ? FOR UPDATE`,
      [userId]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "User not found" });
    }

    const oldRole = rows[0].role;
    if (oldRole === newRole) {
      await conn.rollback();
      return res.json({ ok: true, message: "No change" });
    }

    const oldTable = roleTable(oldRole);
    const newTable = roleTable(newRole);

    //Update users role. If promoting to Admin, sponsor becomes NULL
    if (newRole === "Admin") {
      await conn.query(`UPDATE users SET role = ?, sponsor = NULL WHERE id = ?`, [newRole, userId]);
    } else {
      await conn.query(`UPDATE users SET role = ? WHERE id = ?`, [newRole, userId]);
    }

    //Remove from old role table
    if (oldTable) {
      await conn.query(`DELETE FROM ${oldTable} WHERE user_id = ?`, [userId]);
    }

    // Add to new role table
    if (newTable) {
      await conn.query(`INSERT IGNORE INTO ${newTable} (user_id) VALUES (?)`, [userId]);
    }

    await conn.commit();
    res.json({ ok: true, user_id: userId, oldRole, newRole });
  } catch (err) {
    await conn.rollback();
    console.error("admin role change error:", err);
    res.status(500).json({ error: "Could not change role" });
  } finally {
    conn.release();
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });

  if (req.me.id === userId) {
    return res.status(400).json({ error: "You cannot delete your own account." });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, role
       FROM users
       WHERE id = ?
       FOR UPDATE`,
      [userId]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "User not found" });
    }

    const role = rows[0].role;

    if (role === "Driver") {
      const [driverRows] = await conn.query(
        `SELECT id
         FROM drivers
         WHERE user_id = ?
         FOR UPDATE`,
        [userId]
      );

      if (driverRows.length > 0) {
        const driverId = driverRows[0].id;

        await conn.query(
          `DELETE FROM driver_point_history
           WHERE driver_id = ?`,
          [driverId]
        );

        await conn.query(
          `DELETE FROM drivers
           WHERE user_id = ?`,
          [userId]
        );
      }

      await conn.query(
        `DELETE FROM user_sponsors
         WHERE user_id = ?`,
        [userId]
      );

      await conn.query(
        `DELETE FROM orders
         WHERE user_id = ?`,
        [userId]
      );
    }

    if (role === "Sponsor") {
      await conn.query(
        `DELETE FROM sponsors
         WHERE user_id = ?`,
        [userId]
      );
    }

    if (role === "Admin") {
      await conn.query(
        `DELETE FROM admins
         WHERE user_id = ?`,
        [userId]
      );
    }

    await conn.query(
      `DELETE FROM user_profiles
       WHERE user_id = ?`,
      [userId]
    );

    await conn.query(
      `DELETE FROM users
       WHERE id = ?`,
      [userId]
    );

    await conn.commit();
    res.json({ ok: true, deleted: userId });
  } catch (err) {
    await conn.rollback();
    console.error("admin delete user error:", err);
    res.status(500).json({ error: err.message || "Could not delete user" });
  } finally {
    conn.release();
  }
});

// Getting data from the graph in week, month, year spans for each driver and average
app.get("/api/points", async (req, res) => {
  try {
    const view = req.query.view;
    const driver = req.query.driver;
    const me = req.session.user;

    let dateFormat;
    let groupBy;
    let dateFilter;

    if (view === "year") {
      dateFormat = "%b";
      groupBy = "MONTH(h.created_at)";
      dateFilter = "YEAR(h.created_at) = YEAR(CURDATE())";
    } else if (view === "month") {
      dateFormat = "%u";
      groupBy = "WEEK(h.created_at)";
      dateFilter = "MONTH(h.created_at) = MONTH(CURDATE()) AND YEAR(h.created_at) = YEAR(CURDATE())";
    } else {
      dateFormat = "%a";
      groupBy = "DAY(h.created_at)";
      dateFilter = "YEARWEEK(h.created_at, 1) = YEARWEEK(CURDATE(), 1)";
    }

    let sql = "";
    const params = [];

    const isSponsor = me && me.role === "Sponsor" && me.sponsor;

    if (driver === "all") {
      if (isSponsor) {
        sql = `
          SELECT
            DATE_FORMAT(h.created_at, '${dateFormat}') AS label,
            AVG(h.points_after) AS value
          FROM driver_point_history h
          WHERE ${dateFilter}
            AND h.sponsor_name = ?
          GROUP BY ${groupBy}
          ORDER BY MIN(h.created_at)
        `;
        params.push(me.sponsor);
      } else {
        sql = `
          SELECT
            DATE_FORMAT(h.created_at, '${dateFormat}') AS label,
            AVG(h.points_after) AS value
          FROM driver_point_history h
          WHERE ${dateFilter}
          GROUP BY ${groupBy}
          ORDER BY MIN(h.created_at)
        `;
      }
    } else {
      if (isSponsor) {
        sql = `
          SELECT
            DATE_FORMAT(h.created_at, '${dateFormat}') AS label,
            MAX(h.points_after) AS value
          FROM driver_point_history h
          JOIN drivers d ON h.driver_id = d.id
          JOIN user_sponsors us
            ON us.user_id = d.user_id
          WHERE h.driver_id = ?
            AND ${dateFilter}
            AND h.sponsor_name = ?
            AND us.sponsor_name = ?
          GROUP BY ${groupBy}
          ORDER BY MIN(h.created_at)
        `;
        params.push(driver, me.sponsor, me.sponsor);
      } else {
        sql = `
          SELECT
            DATE_FORMAT(h.created_at, '${dateFormat}') AS label,
            MAX(h.points_after) AS value
          FROM driver_point_history h
          WHERE h.driver_id = ?
            AND ${dateFilter}
          GROUP BY ${groupBy}
          ORDER BY MIN(h.created_at)
        `;
        params.push(driver);
      }
    }

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ error: "Database error" });
  }
});

async function applySponsorPointChange(conn, {
  sponsorName,
  driverId,
  amount,
  reason
}) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    throw new Error("Invalid points amount");
  }

  const [[driver]] = await conn.query(
    `SELECT
       d.id AS driver_id,
       d.user_id,
       us.points
     FROM drivers d
     JOIN user_sponsors us
       ON us.user_id = d.user_id
     WHERE d.id = ?
       AND us.sponsor_name = ?
       AND us.status = 'Active'
     LIMIT 1
     FOR UPDATE`,
    [driverId, sponsorName]
  );

  if (!driver) {
    throw new Error("Driver not found for this sponsor");
  }

  const [[settings]] = await conn.query(
    `SELECT allow_negative
     FROM sponsor_settings
     WHERE sponsor = ?
     LIMIT 1`,
    [sponsorName]
  );

  const allowNegative = settings ? !!settings.allow_negative : false;
  const pointsBefore = Number(driver.points || 0);
  const pointsAfter = pointsBefore + numericAmount;

  if (!allowNegative && pointsAfter < 0) {
    throw new Error("This sponsor does not allow negative point balances.");
  }

  await conn.query(
    `UPDATE user_sponsors
     SET points = ?
     WHERE user_id = ?
       AND sponsor_name = ?`,
    [pointsAfter, driver.user_id, sponsorName]
  );

  await conn.query(
    `INSERT INTO driver_point_history
       (driver_id, sponsor_name, points_change, points_before, points_after, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [
      driver.driver_id,
      sponsorName,
      numericAmount,
      pointsBefore,
      pointsAfter,
      reason || "Sponsor Adjustment"
    ]
  );

  return {
    driver_id: driver.driver_id,
    user_id: driver.user_id,
    pointsBefore,
    pointsAfter
  };
}

app.post("/api/points/update", async (req, res) => {
  const conn = await pool.getConnection();

  try {
    if (!req.session.user) {
      return res.status(401).json({ error: "Not logged in" });
    }

    if (req.session.user.role !== "Sponsor" || !req.session.user.sponsor) {
      return res.status(403).json({ error: "Sponsors only" });
    }

    const sponsorName = req.session.user.sponsor;
    const { driverId, amount, reason } = req.body || {};

    if (!driverId || amount === undefined) {
      return res.status(400).json({ error: "Missing data" });
    }

    await conn.beginTransaction();

    await applySponsorPointChange(conn, {
      sponsorName,
      driverId: Number(driverId),
      amount: Number(amount),
      reason: reason || "Sponsor Adjustment"
    });

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("Point update error:", err);
    res.status(500).json({ error: err.message || "Database error" });
  } finally {
    conn.release();
  }
});

app.get("/api/sponsor/drivers", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ error: "Not logged in" });
    }

    if (req.session.user.role !== "Sponsor" || !req.session.user.sponsor) {
      return res.status(403).json({ error: "Sponsors only" });
    }

    const sponsorName = req.session.user.sponsor;

    const [rows] = await pool.query(
      `SELECT
         d.id AS driver_id,
         u.id AS user_id,
         u.first_name,
         u.last_name,
         u.email,
         us.sponsor_name AS sponsor,
         us.points
       FROM user_sponsors us
       JOIN users u
         ON u.id = us.user_id
       JOIN drivers d
         ON d.user_id = u.id
       WHERE us.sponsor_name = ?
         AND us.status = 'Active'
         AND u.role = 'Driver'
       ORDER BY u.last_name ASC, u.first_name ASC`,
      [sponsorName]
    );

    res.json(rows);
  } catch (err) {
    console.error("SQL Connection Error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/recurring/start", requireSponsor, async (req, res) => {
  const { amount, interval, targetType, targetIds, reason } = req.body || {};
  const sponsorName = req.session.user.sponsor;

  if (!sponsorName) {
    return res.status(400).json({ error: "Missing sponsor context." });
  }

  if (!Number.isFinite(Number(amount))) {
    return res.status(400).json({ error: "Invalid amount." });
  }

  if (!["daily", "weekly"].includes(interval)) {
    return res.status(400).json({ error: "Invalid interval." });
  }

  if (!["all", "specific"].includes(targetType)) {
    return res.status(400).json({ error: "Invalid target type." });
  }

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: "Reason is required." });
  }

  try {
    await pool.query(
      `INSERT INTO RecurringPoints
         (sponsor_name, points_amount, interval_type, target_type, target_ids, reason, is_active)
       VALUES (?, ?, ?, ?, ?, ?, true)`,
      [
        sponsorName,
        Number(amount),
        interval,
        targetType,
        targetType === "specific" ? JSON.stringify(targetIds || []) : null,
        String(reason).trim()
      ]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("recurring start error:", err);
    res.status(500).json({ error: "Could not start recurring points." });
  }
});

app.get("/api/recurring/active", requireSponsor, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, sponsor_name, points_amount, interval_type, target_type, target_ids
       FROM RecurringPoints
       WHERE is_active = true
         AND sponsor_name = ?`,
      [req.session.user.sponsor]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/recurring/stop", requireSponsor, async (req, res) => {
  const { id } = req.body || {};

  try {
    await pool.query(
      `UPDATE RecurringPoints
       SET is_active = false
       WHERE id = ?
         AND sponsor_name = ?`,
      [id, req.session.user.sponsor]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("recurring stop error:", err);
    res.status(500).json({ error: "Could not stop recurring process." });
  }
});

function shouldRun(rule, now) {
  const last = new Date(rule.last_run || 0);
  if (rule.interval_type === 'daily') {
    return now - last >= 24 * 60 * 60 * 1000;
  }
  if (rule.interval_type === 'weekly') {
    return now - last >= 7 * 24 * 60 * 60 * 1000;
  }

  return false;
}

const cron = require('node-cron');

cron.schedule('* * * * *', async () => {
  const [rules] = await pool.query(
    `SELECT * FROM RecurringPoints WHERE is_active = true`
  );

  const now = new Date();
  for (const rule of rules) {
    if (shouldRun(rule, now)) {
      await applyPointsToDrivers(rule);
      await pool.query(
        `UPDATE RecurringPoints SET last_run = ? WHERE id = ?`,
        [now, rule.id]
      );
    }
  }
});

async function applyPointsToDrivers(rule) {
  const sponsorName = rule.sponsor_name;
  if (!sponsorName) return;

  let drivers = [];

  if (rule.target_type === "all") {
    const [rows] = await pool.query(
      `SELECT d.id
       FROM drivers d
       JOIN user_sponsors us
         ON us.user_id = d.user_id
       WHERE us.sponsor_name = ?
         AND us.status = 'Active'`,
      [sponsorName]
    );
    drivers = rows;
  } else {
    const ids = JSON.parse(rule.target_ids || "[]");
    if (!Array.isArray(ids) || ids.length === 0) return;

    const [rows] = await pool.query(
      `SELECT d.id
       FROM drivers d
       JOIN user_sponsors us
         ON us.user_id = d.user_id
       WHERE d.id IN (?)
         AND us.sponsor_name = ?
         AND us.status = 'Active'`,
      [ids, sponsorName]
    );
    drivers = rows;
  }

  for (const driver of drivers) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await applySponsorPointChange(conn, {
        sponsorName,
        driverId: Number(driver.id),
        amount: Number(rule.points_amount),
        reason: rule.reason || "Recurring Points"
      });

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      console.error(`Recurring points failed for driver ${driver.id}:`, err);
    } finally {
      conn.release();
    }
  }
}

// ---------------- REVIEWS API ----------------

// Save a review
app.post("/api/reviews", async (req, res) => {
  try {

    if (!req.session.user) {
      return res.status(401).json({ error: "Not logged in" });
    }

    const { product_id, rating, text } = req.body;

    const username = req.session.user.username;

    await pool.query(
      `INSERT INTO reviews (product_id, username, rating, review_text)
       VALUES (?, ?, ?, ?)`,
      [product_id, username, rating, text]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error("Review insert error:", err);
    res.status(500).json({ error: "Database error" });
  }
});


// Get reviews for a product
app.get("/api/reviews/:productId", async (req, res) => {
  try {

    const productId = req.params.productId;

    const [rows] = await pool.query(
      `SELECT username, rating, review_text, created_at
       FROM reviews
       WHERE product_id = ?
       ORDER BY created_at DESC`,
      [productId]
    );

    res.json(rows);

  } catch (err) {
    console.error("Review fetch error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

function addBusinessDays(startDate, businessDays) {
  const date = new Date(startDate);
  let added = 0;

  while (added < businessDays) {
    date.setDate(date.getDate() + 1);

    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) {
      added++;
    }
  }

  return date;
}

function toMySQLDate(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getExpectedDeliveryDate(shippingMethod) {
  const businessDays = shippingMethod === "overnight" ? 3 : 7;
  return toMySQLDate(addBusinessDays(new Date(), businessDays));
}

function buildNotificationSchedule(dateOrdered, expectedDeliveryDate) {
  const orderedAt = new Date(dateOrdered);

  const shippedAt = new Date(orderedAt);
  shippedAt.setDate(shippedAt.getDate() + 1);

  const deliveredAt = new Date(`${expectedDeliveryDate}T17:00:00`);

  const outForDeliveryAt = new Date(deliveredAt);
  outForDeliveryAt.setHours(outForDeliveryAt.getHours() - 3);

  return {
    shippedAt,
    outForDeliveryAt,
    deliveredAt
  };
}

async function createOrderNotifications(conn, {
  recipientUserId,
  actorUserId = null,
  groupId,
  shippingMethod,
  expectedDeliveryDate,
  dateOrdered
}) {
  const { shippedAt, outForDeliveryAt, deliveredAt } =
    buildNotificationSchedule(dateOrdered, expectedDeliveryDate);

  const metadata = JSON.stringify({
    shippingMethod,
    expectedDeliveryDate
  });

  await conn.query(
    `INSERT INTO notifications
      (
        recipient_user_id,
        actor_user_id,
        type,
        category,
        title,
        message,
        related_entity_type,
        related_entity_id,
        scheduled_for,
        metadata_json
      )
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recipientUserId,
      actorUserId,
      "order_shipped",
      "order",
      "Order shipped",
      `Your order ${groupId} has shipped.`,
      "order_group",
      groupId,
      shippedAt,
      metadata,

      recipientUserId,
      actorUserId,
      "order_out_for_delivery",
      "order",
      "Out for delivery",
      `Your order ${groupId} is out for delivery.`,
      "order_group",
      groupId,
      outForDeliveryAt,
      metadata,

      recipientUserId,
      actorUserId,
      "order_delivered",
      "order",
      "Order delivered",
      `Your order ${groupId} has been delivered.`,
      "order_group",
      groupId,
      deliveredAt,
      metadata
    ]
  );
}

app.post("/api/orders/checkout", requireLogin, async (req, res) => {
  const me = req.session.user;

  if (me.role !== "Driver") {
    return res.status(403).json({ error: "Drivers only" });
  }

  const {
    items,
    shipping_method,
    shipping_point_cost,
    shipping_dollar_cost,
    sponsor_name
  } = req.body || {};

  if (!sponsor_name) {
    return res.status(400).json({ error: "A sponsor must be selected for checkout." });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty." });
  }

  if (items.length > 4) {
    return res.status(400).json({ error: "Cart cannot have more than 4 items." });
  }

  const allowedShipping = ["standard", "overnight"];
  if (!allowedShipping.includes(shipping_method)) {
    return res.status(400).json({ error: "Invalid shipping method." });
  }

  const expectedDeliveryDate = getExpectedDeliveryDate(shipping_method);

  const cleanShippingPointCost = Number(shipping_point_cost || 0);
  const cleanShippingDollarCost = Number(shipping_dollar_cost || 0);

  if (!Number.isFinite(cleanShippingPointCost) || cleanShippingPointCost < 0) {
    return res.status(400).json({ error: "Invalid shipping point cost." });
  }

  if (!Number.isFinite(cleanShippingDollarCost) || cleanShippingDollarCost < 0) {
    return res.status(400).json({ error: "Invalid shipping dollar cost." });
  }

  const normalizedItems = [];

  for (const item of items) {
    const productId = Number(item.productId);
    const pointCost = Number(item.pointCost);
    const dollarCost = Number(item.dollarCost);
    const qty = Number(item.qty || 0);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "Invalid product id in cart." });
    }

    if (!Number.isFinite(pointCost) || pointCost < 0) {
      return res.status(400).json({ error: "Invalid point cost in cart." });
    }

    if (!Number.isFinite(dollarCost) || dollarCost < 0) {
      return res.status(400).json({ error: "Invalid dollar cost in cart." });
    }

    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: "Invalid quantity in cart." });
    }

    normalizedItems.push({
      productId,
      pointCost,
      dollarCost,
      qty
    });
  }

  const itemsPointTotal = normalizedItems.reduce((sum, item) => {
    return sum + (item.pointCost * item.qty);
  }, 0);

  const totalPointCost = itemsPointTotal + cleanShippingPointCost;

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [driverRows] = await conn.query(
      `SELECT id
       FROM drivers
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [me.id]
    );

    if (driverRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Driver record not found." });
    }

    const driverId = driverRows[0].id;

    const [walletRows] = await conn.query(
      `SELECT points
       FROM user_sponsors
       WHERE user_id = ?
         AND sponsor_name = ?
         AND status = 'Active'
       LIMIT 1
       FOR UPDATE`,
      [me.id, sponsor_name]
    );

    if (walletRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Selected sponsor wallet not found." });
    }

    const currentPoints = Number(walletRows[0].points || 0);

    if (currentPoints < totalPointCost) {
      await conn.rollback();
      return res.status(400).json({
        error: "Not enough points.",
        currentPoints,
        totalPointCost
      });
    }

    const groupId = crypto.randomUUID();

    for (const item of normalizedItems) {
      for (let i = 0; i < item.qty; i++) {
        await conn.query(
          `INSERT INTO orders
             (group_id, user_id, sponsor_name, product_id, point_cost, dollar_cost, shipping_method, expected_delivery_date, date_ordered)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            groupId,
            me.id,
            sponsor_name,
            item.productId,
            item.pointCost,
            item.dollarCost,
            shipping_method,
            expectedDeliveryDate
          ]
        );
      }
    }

    await conn.query(
      `UPDATE user_sponsors
       SET points = points - ?
       WHERE user_id = ?
         AND sponsor_name = ?`,
      [totalPointCost, me.id, sponsor_name]
    );

    await conn.query(
      `INSERT INTO driver_point_history
         (driver_id, sponsor_name, points_change, points_before, points_after, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        driverId,
        sponsor_name,
        -totalPointCost,
        currentPoints,
        currentPoints - totalPointCost,
        `Catalog checkout (${sponsor_name}, ${shipping_method}, shipping ${cleanShippingPointCost} pts)`
      ]
    );

    await conn.query(
      `INSERT INTO notifications
        (
          recipient_user_id,
          actor_user_id,
          type,
          category,
          title,
          message,
          related_entity_type,
          related_entity_id,
          scheduled_for
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        me.id,
        null,
        "order_placed",
        "order",
        "Order placed",
        `Your order ${groupId} has been placed successfully.`,
        "order_group",
        groupId
      ]
    );

    await createOrderNotifications(conn, {
      recipientUserId: me.id,
      actorUserId: null,
      groupId,
      shippingMethod: shipping_method,
      expectedDeliveryDate,
      dateOrdered: new Date()
    });

    await conn.commit();

    return res.json({
      ok: true,
      group_id: groupId,
      totalPointCost,
      remainingPoints: currentPoints - totalPointCost
    });

  } catch (err) {
    await conn.rollback();
    console.error("checkout error:", err);
    return res.status(500).json({ error: "Checkout failed." });
  } finally {
    conn.release();
  }
});

// ================= CANCEL ORDER =================
app.post("/api/orders/:groupId/cancel", requireLogin, async (req, res) => {
  const me = req.session.user;
  const groupId = req.params.groupId;

  if (me.role !== "Driver") {
    return res.status(403).json({ error: "Drivers only" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 🔍 Check if order exists + belongs to user
    const [orders] = await conn.query(
      `SELECT expected_delivery_date
       FROM orders
       WHERE group_id = ?
         AND user_id = ?
       LIMIT 1`,
      [groupId, me.id]
    );

    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Order not found." });
    }

    const expectedDelivery = new Date(orders[0].expected_delivery_date);
    const now = new Date();

    // 🚫 If already delivered → block cancel
    if (now >= expectedDelivery) {
      await conn.rollback();
      return res.status(400).json({ error: "Order already delivered." });
    }

    // 🚫 If shipped (1 day after order) → block cancel
    const shippedAt = new Date(expectedDelivery);
    shippedAt.setDate(shippedAt.getDate() - 6); // matches your schedule logic roughly

    if (now >= shippedAt) {
      await conn.rollback();
      return res.status(400).json({ error: "Order already shipped." });
    }

    // 💰 Get all orders in this group (to calculate refund)
    const [orderRows] = await conn.query(
      `SELECT point_cost, sponsor_name
      FROM orders
      WHERE group_id = ?
        AND user_id = ?`,
      [groupId, me.id]
    );

    if (orderRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Order not found." });
    }

    // 🧮 Calculate total refund
    let totalRefund = 0;
    let sponsorName = null;

    for (const row of orderRows) {
      totalRefund += Number(row.point_cost || 0);
      sponsorName = row.sponsor_name; // same for all rows
    }

    // 🔍 Get driver_id
    const [[driver]] = await conn.query(
      `SELECT id FROM drivers WHERE user_id = ? LIMIT 1`,
      [me.id]
    );

    if (!driver) {
      await conn.rollback();
      return res.status(404).json({ error: "Driver not found." });
    }

    // 🔍 Get current points BEFORE refund
    const [[wallet]] = await conn.query(
      `SELECT points
      FROM user_sponsors
      WHERE user_id = ?
        AND sponsor_name = ?
      LIMIT 1
      FOR UPDATE`,
      [me.id, sponsorName]
    );

    const pointsBefore = Number(wallet.points || 0);
    const pointsAfter = pointsBefore + totalRefund;

    // 💰 Refund points
    await conn.query(
      `UPDATE user_sponsors
      SET points = ?
      WHERE user_id = ?
        AND sponsor_name = ?`,
      [pointsAfter, me.id, sponsorName]
    );

    // 🧾 Log refund
    await conn.query(
      `INSERT INTO driver_point_history
        (driver_id, sponsor_name, points_change, points_before, points_after, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        driver.id,
        sponsorName,
        totalRefund,
        pointsBefore,
        pointsAfter,
        `Order canceled refund (${groupId})`
      ]
    );

    // ❌ Delete orders (simple approach)
    await conn.query(
      `DELETE FROM orders
      WHERE group_id = ?
        AND user_id = ?`,
      [groupId, me.id]
    );

    // ✅ ADD THIS RIGHT HERE
    await conn.query(
      `DELETE FROM notifications
      WHERE related_entity_id = ?
        AND type = 'order_placed'
        AND recipient_user_id = ?`,
      [groupId, me.id]
    );

    // 🔔 Create "Order Canceled" notification
    await conn.query(
      `INSERT INTO notifications
        (
          recipient_user_id,
          actor_user_id,
          type,
          category,
          title,
          message,
          related_entity_type,
          related_entity_id,
          scheduled_for
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        me.id,
        null,
        "order_canceled",
        "order",
        "Order canceled",
        `Your order ${groupId} has been canceled.`,
        "order_group",
        groupId
      ]
    );

    await conn.commit();

    res.json({ ok: true });

  } catch (err) {
    await conn.rollback();
    console.error("cancel order error:", err);
    res.status(500).json({ error: "Could not cancel order." });
  } finally {
    conn.release();
  }
});

app.get("/api/recommendations", requireLogin, async (req, res) => {
  try {
    if (req.session.user.role !== "Driver") {
      return res.json({ purchasedProductIds: [] });
    }

    const [rows] = await pool.query(
      `
      SELECT product_id, COUNT(*) AS purchase_count, MAX(date_ordered) AS last_ordered
      FROM orders
      WHERE user_id = ?
      GROUP BY product_id
      ORDER BY purchase_count DESC, last_ordered DESC
      `,
      [req.session.user.id]
    );

    const purchasedProductIds = rows.map((row) => Number(row.product_id));

    res.json({ purchasedProductIds });
  } catch (err) {
    console.error("recommendations error:", err);
    res.status(500).json({ error: "Could not load recommendations." });
  }
});

function getHistoryStartDate(range) {
  const now = new Date();

  if (range === "1w") {
    now.setDate(now.getDate() - 7);
    return now;
  }

  if (range === "1m") {
    now.setMonth(now.getMonth() - 1);
    return now;
  }

  if (range === "6m") {
    now.setMonth(now.getMonth() - 6);
    return now;
  }

  if (range === "1y") {
    now.setFullYear(now.getFullYear() - 1);
    return now;
  }

  if (range === "all") {
    return null;
  }

  return null;
}

function buildTransactionsFromOrderRows(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const groupId = row.group_id;

    if (!grouped.has(groupId)) {
      grouped.set(groupId, {
        group_id: groupId,
        transaction_date: row.date_ordered,
        shipping_method: row.shipping_method,
        expected_delivery_date: row.expected_delivery_date,
        total_points: 0,
        total_dollars: 0,
        item_count: 0,
        items: []
      });
    }

    const tx = grouped.get(groupId);

    tx.total_points += Number(row.point_cost || 0);
    tx.total_dollars += Number(row.dollar_cost || 0);
    tx.item_count += 1;

    tx.items.push({
      id: row.id,
      product_id: row.product_id,
      point_cost: Number(row.point_cost || 0),
      dollar_cost: Number(row.dollar_cost || 0)
    });
  }

  return Array.from(grouped.values()).sort((a, b) => {
    return new Date(b.transaction_date) - new Date(a.transaction_date);
  });
}

app.get("/api/orders/history", requireLogin, async (req, res) => {
  try {
    const me = req.session.user;

    if (me.role !== "Driver") {
      return res.status(403).json({ error: "Drivers only" });
    }

    const range = String(req.query.range || "1m");
    const allowedRanges = new Set(["1w", "1m", "6m", "1y", "all"]);

    if (!allowedRanges.has(range)) {
      return res.status(400).json({ error: "Invalid range." });
    }

    const startDate = getHistoryStartDate(range);

    let sql = `
      SELECT
        id,
        group_id,
        product_id,
        point_cost,
        dollar_cost,
        date_ordered,
        shipping_method,
        expected_delivery_date
      FROM orders
      WHERE user_id = ?
    `;

    const params = [me.id];

    if (startDate) {
      sql += ` AND date_ordered >= ?`;
      params.push(startDate);
    }

    sql += ` ORDER BY date_ordered DESC, id ASC`;

    const [rows] = await pool.query(sql, params);
    const transactions = buildTransactionsFromOrderRows(rows);

    return res.json({
      range,
      transactions
    });
  } catch (err) {
    console.error("order history error:", err);
    return res.status(500).json({ error: "Could not load transaction history." });
  }
});

app.get("/api/orders/history/export", requireLogin, async (req, res) => {
  try {
    const me = req.session.user;

    if (me.role !== "Driver") {
      return res.status(403).json({ error: "Drivers only" });
    }

    const range = String(req.query.range || "1m");
    const allowedRanges = new Set(["1w", "1m", "6m", "1y", "all"]);

    if (!allowedRanges.has(range)) {
      return res.status(400).json({ error: "Invalid range." });
    }

    const startDate = getHistoryStartDate(range);

    let sql = `
      SELECT
        id,
        group_id,
        product_id,
        point_cost,
        dollar_cost,
        date_ordered,
        shipping_method,
        expected_delivery_date
      FROM orders
      WHERE user_id = ?
    `;

    const params = [me.id];

    if (startDate) {
      sql += ` AND date_ordered >= ?`;
      params.push(startDate);
    }

    sql += ` ORDER BY date_ordered DESC, id ASC`;

    const [rows] = await pool.query(sql, params);
    const transactions = buildTransactionsFromOrderRows(rows);

    const lines = [
      [
        "transaction_group_id",
        "transaction_date",
        "shipping_method",
        "expected_delivery_date",
        "transaction_total_points",
        "transaction_total_dollars",
        "transaction_item_count",
        "order_row_id",
        "product_id",
        "item_point_cost",
        "item_dollar_cost"
      ].join(",")
    ];

    for (const tx of transactions) {
      for (const item of tx.items) {
        lines.push([
          `"${tx.group_id}"`,
          `"${new Date(tx.transaction_date).toISOString()}"`,
          `"${tx.shipping_method}"`,
          `"${tx.expected_delivery_date}"`,
          tx.total_points,
          Number(tx.total_dollars).toFixed(2),
          tx.item_count,
          item.id,
          item.product_id,
          item.point_cost,
          Number(item.dollar_cost).toFixed(2)
        ].join(","));
      }
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="transaction-history-${range}.csv"`
    );

    return res.send(lines.join("\n"));
  } catch (err) {
    console.error("order history export error:", err);
    return res.status(500).json({ error: "Could not export transaction history." });
  }
});

app.get("/api/notifications", requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         id,
         recipient_user_id,
         actor_user_id,
         type,
         category,
         title,
         message,
         related_entity_type,
         related_entity_id,
         scheduled_for,
         read_at,
         created_at,
         metadata_json
       FROM notifications
       WHERE recipient_user_id = ?
         AND scheduled_for <= NOW()
       ORDER BY scheduled_for DESC, id DESC`,
      [req.session.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error("notifications error:", err);
    res.status(500).json({ error: "Could not load notifications." });
  }
});

app.get("/api/notifications/unread-count", requireLogin, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS unreadCount
       FROM notifications
       WHERE recipient_user_id = ?
         AND read_at IS NULL
         AND scheduled_for <= NOW()`,
      [req.session.user.id]
    );

    res.json({ unreadCount: Number(row.unreadCount || 0) });
  } catch (err) {
    console.error("notification unread count error:", err);
    res.status(500).json({ error: "Could not load unread count." });
  }
});

app.post("/api/notifications/:id/open", requireLogin, async (req, res) => {
  try {
    const notificationId = Number(req.params.id);

    if (!Number.isFinite(notificationId)) {
      return res.status(400).json({ error: "Invalid notification id." });
    }

    const [result] = await pool.query(
      `UPDATE notifications
       SET read_at = NOW()
       WHERE id = ?
         AND recipient_user_id = ?
         AND read_at IS NULL`,
      [notificationId, req.session.user.id]
    );

    res.json({
      ok: true,
      updated: result.affectedRows > 0
    });
  } catch (err) {
    console.error("notification open error:", err);
    res.status(500).json({ error: "Could not update notification." });
  }
});

app.post("/api/notifications/read-all", requireLogin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications
       SET read_at = NOW()
       WHERE recipient_user_id = ?
         AND scheduled_for <= NOW()
         AND read_at IS NULL`,
      [req.session.user.id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("notification read-all error:", err);
    res.status(500).json({ error: "Could not mark all as read." });
  }
});

app.get("/api/catalog/hidden-product-ids", requireLogin, async (req, res) => {
  try {
    const me = req.session.user;
    const requestedSponsor = String(req.query.sponsor || "").trim();
    let sponsor = null;

    if (me.role === "Admin") {
      sponsor = requestedSponsor || null;
    } else if (me.role === "Sponsor") {
      sponsor = me.sponsor || null;
    } else if (me.role === "Driver") {
      sponsor = requestedSponsor || null;

      if (!sponsor) {
        return res.json({ productIds: [] });
      }

      const [membershipRows] = await pool.query(
        `SELECT 1
         FROM user_sponsors
         WHERE user_id = ?
           AND sponsor_name = ?
           AND status = 'Active'
         LIMIT 1`,
        [me.id, sponsor]
      );

      if (membershipRows.length === 0) {
        return res.status(403).json({ error: "Unauthorized sponsor selection." });
      }
    } else {
      sponsor = null;
    }

    if (!sponsor) {
      return res.json({ productIds: [] });
    }

    const [rows] = await pool.query(
      `SELECT product_id
       FROM sponsor_catalog_hidden_items
       WHERE sponsor = ?
         AND restored_at IS NULL
       ORDER BY product_id ASC`,
      [sponsor]
    );

    res.json({
      productIds: rows.map((row) => Number(row.product_id))
    });
  } catch (err) {
    console.error("hidden product ids error:", err);
    res.status(500).json({ error: "Could not load hidden products." });
  }
});

app.post("/api/sponsor/catalog/hide/:productId", requireSponsor, async (req, res) => {
  try {
    const productId = Number(req.params.productId);

    if (!Number.isFinite(productId)) {
      return res.status(400).json({ error: "Invalid product id." });
    }

    await pool.query(
      `INSERT INTO sponsor_catalog_hidden_items
         (sponsor, product_id, removed_by_user_id, removed_at, restored_at)
       VALUES (?, ?, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         removed_by_user_id = VALUES(removed_by_user_id),
         removed_at = NOW(),
         restored_at = NULL`,
      [req.me.sponsor, productId, req.me.id]
    );

    res.json({ ok: true, productId });
  } catch (err) {
    console.error("hide catalog item error:", err);
    res.status(500).json({ error: "Could not hide catalog item." });
  }
});

app.get("/api/sponsor/catalog/hidden-items", requireSponsor, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         sponsor,
         product_id,
         removed_by_user_id,
         removed_at
       FROM sponsor_catalog_hidden_items
       WHERE sponsor = ?
         AND restored_at IS NULL
       ORDER BY removed_at DESC`,
      [req.me.sponsor]
    );

    res.json({ items: rows });
  } catch (err) {
    console.error("hidden items list error:", err);
    res.status(500).json({ error: "Could not load hidden items." });
  }
});

app.post("/api/sponsor/catalog/restore/:productId", requireSponsor, async (req, res) => {
  try {
    const productId = Number(req.params.productId);

    if (!Number.isFinite(productId)) {
      return res.status(400).json({ error: "Invalid product id." });
    }

    const [result] = await pool.query(
      `UPDATE sponsor_catalog_hidden_items
       SET restored_at = NOW()
       WHERE sponsor = ?
         AND product_id = ?
         AND restored_at IS NULL`,
      [req.me.sponsor, productId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Hidden item not found for your sponsor." });
    }

    res.json({ ok: true, productId });
  } catch (err) {
    console.error("restore catalog item error:", err);
    res.status(500).json({ error: "Could not restore catalog item." });
  }
});

async function notifySponsorUsersForCatalogRequest(conn, {
  sponsor,
  requesterUserId,
  requestId,
  requestText
}) {
  const [sponsorRows] = await conn.query(
    `SELECT id
     FROM users
     WHERE role = 'Sponsor'
       AND sponsor = ?`,
    [sponsor]
  );

  if (!sponsorRows.length) {
    return;
  }

  const shortText =
    String(requestText || "").trim().length > 120
      ? `${String(requestText).trim().slice(0, 120)}...`
      : String(requestText || "").trim();

  for (const sponsorUser of sponsorRows) {
    await conn.query(
      `INSERT INTO notifications
        (
          recipient_user_id,
          actor_user_id,
          type,
          category,
          title,
          message,
          related_entity_type,
          related_entity_id,
          scheduled_for,
          metadata_json
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        sponsorUser.id,
        requesterUserId,
        "catalog_item_request",
        "catalog_request",
        "New catalog item request",
        `A driver requested that this item be added to the catalog: "${shortText}"`,
        "catalog_item_request",
        String(requestId),
        JSON.stringify({
          requestId,
          sponsor,
          requestText
        })
      ]
    );
  }
}

app.post("/api/catalog/item-requests", requireLogin, async (req, res) => {
  const me = req.session.user;
  const requestText = String(req.body?.requestText || "").trim();

  if (me.role !== "Driver") {
    return res.status(403).json({ error: "Drivers only." });
  }

  if (!me.sponsor) {
    return res.status(400).json({ error: "Your account is not associated with a sponsor." });
  }

  if (!requestText) {
    return res.status(400).json({ error: "Request text is required." });
  }

  if (requestText.length > 500) {
    return res.status(400).json({ error: "Request must be 500 characters or fewer." });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO catalog_item_requests
         (requester_user_id, sponsor, request_text, status, created_at)
       VALUES (?, ?, ?, 'pending', NOW())`,
      [me.id, me.sponsor, requestText]
    );

    const requestId = result.insertId;

    await notifySponsorUsersForCatalogRequest(conn, {
      sponsor: me.sponsor,
      requesterUserId: me.id,
      requestId,
      requestText
    });

    await conn.commit();

    res.status(201).json({
      ok: true,
      requestId
    });
  } catch (err) {
    await conn.rollback();
    console.error("catalog item request error:", err);
    res.status(500).json({ error: "Could not submit item request." });
  } finally {
    conn.release();
  }
});

app.delete("/api/notifications/:id", requireLogin, async (req, res) => {
  try {
    const notificationId = Number(req.params.id);

    if (!Number.isFinite(notificationId)) {
      return res.status(400).json({ error: "Invalid notification id." });
    }

    const [result] = await pool.query(
      `DELETE FROM notifications
       WHERE id = ?
         AND recipient_user_id = ?`,
      [notificationId, req.session.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Notification not found." });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("delete notification error:", err);
    res.status(500).json({ error: "Could not delete notification." });
  }
});

app.get('/api/sponsor/transactions', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'Sponsor') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const sponsor = req.session.user.sponsor;
  const { driver_id, range = "1m" } = req.query;

  const allowedRanges = new Set(["1d", "1w", "1m", "6m", "1y", "all"]);
  if (!allowedRanges.has(range)) {
    return res.status(400).json({ error: 'Invalid range.' });
  }

  const startDate = getHistoryStartDate(range);

  try {
    let query = `
      SELECT
        o.*,
        u.id AS user_id,
        u.first_name,
        u.last_name,
        o.sponsor_name AS sponsor
      FROM orders o
      JOIN users u
        ON o.user_id = u.id
      JOIN user_sponsors us
        ON us.user_id = u.id
      WHERE o.sponsor_name = ?
        AND us.sponsor_name = ?
        AND us.status = 'Active'
        AND u.role = 'Driver'
    `;

    const params = [sponsor, sponsor];

    if (driver_id) {
      query += ` AND u.id = ?`;
      params.push(driver_id);
    }

    if (startDate) {
      query += ` AND o.date_ordered >= ?`;
      params.push(startDate);
    }

    query += ` ORDER BY o.date_ordered DESC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('sponsor transactions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/transactions', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { sponsor, driver_id, range = "1m" } = req.query;

  const allowedRanges = new Set(["1d", "1w", "1m", "6m", "1y", "all"]);
  if (!allowedRanges.has(range)) {
    return res.status(400).json({ error: 'Invalid range.' });
  }

  const startDate = getHistoryStartDate(range);

  try {
    let query = `
      SELECT
        o.*,
        u.id AS user_id,
        u.first_name,
        u.last_name,
        o.sponsor_name AS sponsor
      FROM orders o
      JOIN users u
        ON o.user_id = u.id
      WHERE u.role = 'Driver'
    `;

    const params = [];

    if (sponsor) {
      query += ` AND o.sponsor_name = ?`;
      params.push(sponsor);
    }

    if (driver_id) {
      query += ` AND u.id = ?`;
      params.push(driver_id);
    }

    if (startDate) {
      query += ` AND o.date_ordered >= ?`;
      params.push(startDate);
    }

    query += ` ORDER BY o.date_ordered DESC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('admin transactions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/sponsors', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT sponsor_name AS sponsor
      FROM user_sponsors
      WHERE sponsor_name IS NOT NULL
        AND sponsor_name <> ''
      ORDER BY sponsor_name ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error('admin sponsors error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/drivers', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { sponsor } = req.query;

  try {
    let query = `
      SELECT DISTINCT
        d.id AS driver_id,
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.email
      FROM users u
      JOIN drivers d
        ON d.user_id = u.id
      LEFT JOIN user_sponsors us
        ON us.user_id = u.id
       AND us.status = 'Active'
      WHERE u.role = 'Driver'
    `;
    const params = [];

    if (sponsor) {
      query += ` AND us.sponsor_name = ?`;
      params.push(sponsor);
    }

    query += ` ORDER BY u.last_name ASC, u.first_name ASC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('admin drivers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get("/api/admin/points", requireAdmin, async (req, res) => {
  try {
    const view = String(req.query.view || "week");
    const driver = String(req.query.driver || "all");
    const sponsor = String(req.query.sponsor || "").trim();

    if (!sponsor) {
      return res.status(400).json({ error: "Sponsor is required." });
    }

    let dateFormat;
    let groupBy;
    let dateFilter;

    if (view === "year") {
      dateFormat = "%b";
      groupBy = "MONTH(h.created_at)";
      dateFilter = "YEAR(h.created_at) = YEAR(CURDATE())";
    } else if (view === "month") {
      dateFormat = "%u";
      groupBy = "WEEK(h.created_at)";
      dateFilter = "MONTH(h.created_at) = MONTH(CURDATE()) AND YEAR(h.created_at) = YEAR(CURDATE())";
    } else {
      dateFormat = "%a";
      groupBy = "DAY(h.created_at)";
      dateFilter = "YEARWEEK(h.created_at, 1) = YEARWEEK(CURDATE(), 1)";
    }

    let sql = "";
    const params = [];

    if (driver === "all") {
      sql = `
        SELECT
          DATE_FORMAT(h.created_at, '${dateFormat}') AS label,
          AVG(h.points_after) AS value
        FROM driver_point_history h
        WHERE ${dateFilter}
          AND h.sponsor_name = ?
        GROUP BY ${groupBy}
        ORDER BY MIN(h.created_at)
      `;
      params.push(sponsor);
    } else {
      sql = `
        SELECT
          DATE_FORMAT(h.created_at, '${dateFormat}') AS label,
          MAX(h.points_after) AS value
        FROM driver_point_history h
        JOIN drivers d
          ON h.driver_id = d.id
        JOIN user_sponsors us
          ON us.user_id = d.user_id
        WHERE h.driver_id = ?
          AND ${dateFilter}
          AND h.sponsor_name = ?
          AND us.sponsor_name = ?
          AND us.status = 'Active'
        GROUP BY ${groupBy}
        ORDER BY MIN(h.created_at)
      `;
      params.push(Number(driver), sponsor, sponsor);
    }

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("admin points error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/sponsor/settings", requireSponsor, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT points_criteria, allow_negative, points_per_dollar
       FROM sponsor_settings
       WHERE sponsor = ?
       LIMIT 1`,
      [req.me.sponsor]
    );

    if (!rows.length) {
      return res.json({
        pointsCriteria: "",
        allowNegative: false,
        pointsPerDollar: 10
      });
    }

    res.json({
      pointsCriteria: rows[0].points_criteria || "",
      allowNegative: !!rows[0].allow_negative,
      pointsPerDollar: Number(rows[0].points_per_dollar || 10)
    });
  } catch (err) {
    console.error("sponsor settings load error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/sponsor/settings", requireSponsor, async (req, res) => {
  try {
    const pointsCriteria = String(req.body?.pointsCriteria || "");
    const allowNegative = !!req.body?.allowNegative;

    const pointsPerDollar = Number(req.body?.pointsPerDollar);
    if (!Number.isInteger(pointsPerDollar) || pointsPerDollar <= 0) {
      return res.status(400).json({ error: "Points per dollar must be a positive whole number." });
    }

    await pool.query(
      `INSERT INTO sponsor_settings (sponsor, points_criteria, allow_negative, points_per_dollar)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         points_criteria = VALUES(points_criteria),
         allow_negative = VALUES(allow_negative),
         points_per_dollar = VALUES(points_per_dollar)`,
      [req.me.sponsor, pointsCriteria, allowNegative, pointsPerDollar]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("sponsor settings save error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/catalog/points-ratio", requireLogin, async (req, res) => {
  try {
    const role = req.session.user.role;
    const requestedSponsor = String(req.query.sponsor || "").trim();

    let sponsorName = null;

    if (role === "Sponsor") {
      sponsorName = req.session.user.sponsor || null;
    } else if (role === "Driver") {
      sponsorName = requestedSponsor || null;
    } else if (role === "Admin") {
      sponsorName = requestedSponsor || null;
    }

    if (!sponsorName) {
      return res.json({ pointsPerDollar: 10 });
    }

    const [rows] = await pool.query(
      `SELECT points_per_dollar
       FROM sponsor_settings
       WHERE sponsor = ?
       LIMIT 1`,
      [sponsorName]
    );

    return res.json({
      pointsPerDollar: rows.length
        ? Number(rows[0].points_per_dollar || 10)
        : 10
    });
  } catch (err) {
    console.error("catalog points ratio error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

function getHistoryStartDate(range) {
  const now = new Date();

  if (range === "1d") {
    now.setDate(now.getDate() - 1);
    return now;
  }

  if (range === "1w") {
    now.setDate(now.getDate() - 7);
    return now;
  }

  if (range === "1m") {
    now.setMonth(now.getMonth() - 1);
    return now;
  }

  if (range === "6m") {
    now.setMonth(now.getMonth() - 6);
    return now;
  }

  if (range === "1y") {
    now.setFullYear(now.getFullYear() - 1);
    return now;
  }

  if (range === "all") {
    return null;
  }

  return null;
}

app.get("/api/sponsor/dashboard-summary", requireSponsor, async (req, res) => {
  try {
    const sponsor = req.me.sponsor;

    if (!sponsor) {
      return res.status(400).json({ error: "Sponsor account is missing sponsor organization." });
    }

    const [[driverStats]] = await pool.query(
      `
      SELECT
        COUNT(*) AS activeDrivers,
        COALESCE(SUM(us.points), 0) AS totalPointsAwarded
      FROM user_sponsors us
      JOIN users u
        ON u.id = us.user_id
      JOIN drivers d
        ON d.user_id = u.id
      WHERE u.role = 'Driver'
        AND us.sponsor_name = ?
        AND us.status = 'Active'
      `,
      [sponsor]
    );

    const [[applicationStats]] = await pool.query(
      `
      SELECT COUNT(*) AS pendingApplications
      FROM applications a
      JOIN application_sponsors aps
        ON aps.application_id = a.id
      WHERE a.role = 'Driver'
        AND a.status = 'Pending'
        AND aps.sponsor_name = ?
      `,
      [sponsor]
    );

    res.json({
      sponsorName: sponsor,
      activeDrivers: Number(driverStats.activeDrivers || 0),
      totalPointsAwarded: Number(driverStats.totalPointsAwarded || 0),
      pendingApplications: Number(applicationStats.pendingApplications || 0)
    });
  } catch (err) {
    console.error("sponsor dashboard summary error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/admin/driver-sponsors", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.email,
        GROUP_CONCAT(DISTINCT us.sponsor_name ORDER BY us.sponsor_name SEPARATOR ', ') AS sponsors
      FROM users u
      JOIN drivers d
        ON d.user_id = u.id
      LEFT JOIN user_sponsors us
        ON us.user_id = u.id
       AND us.status = 'Active'
      WHERE u.role = 'Driver'
      GROUP BY u.id, u.first_name, u.last_name, u.email
      ORDER BY u.last_name ASC, u.first_name ASC
      `
    );

    res.json(rows);
  } catch (err) {
    console.error("admin driver sponsors error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/admin/users/:id/sponsors", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const sponsorName = String(req.body?.sponsor_name || "").trim();

  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  if (!sponsorName) {
    return res.status(400).json({ error: "Sponsor name is required." });
  }

  const allowedSponsors = new Set(["Sponsor 1", "Sponsor 2", "Sponsor 3", "Sponsor 4"]);
  if (!allowedSponsors.has(sponsorName)) {
    return res.status(400).json({ error: "Invalid sponsor name." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, role
       FROM users
       WHERE id = ?
       FOR UPDATE`,
      [userId]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "User not found." });
    }

    if (rows[0].role !== "Driver") {
      await conn.rollback();
      return res.status(400).json({ error: "Only drivers can be assigned to sponsors." });
    }

    await conn.query(
      `INSERT IGNORE INTO user_sponsors (user_id, sponsor_name, points, status)
       VALUES (?, ?, 0, 'Active')`,
      [userId, sponsorName]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("admin assign sponsor error:", err);
    res.status(500).json({ error: "Could not assign sponsor." });
  } finally {
    conn.release();
  }
});

app.post("/api/upload-bulk", uploadText.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const fileContent = req.file.buffer.toString("utf-8");
    const { results, errors } = await parseBulkFile(
      fileContent,
      req.session.user.role,
      req.session.user.sponsor,
      pool
    );
    
    let inserted = 0;
    let insertedRows = [];
    let pointUpdates = [];
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const sponsorOrg = req.session.user.sponsor;
    
    try {
      for (const r of results) {
        const [existing] = await pool.query(
          "SELECT id, first_name, last_name FROM users WHERE email = ?",
          [r.email]
        );
        
        if (existing.length > 0) {
          r.action = "update_points";
          r.driverId = existing[0].id;
          r.firstName = existing[0].first_name;  
          r.lastName = existing[0].last_name;    
        }
        else {
          r.action = "create";
        }

        if (r.action === "create") {
          const finalOrg = r.org || req.session.user.sponsor;

          const [insertResult] = await conn.query(
            `INSERT INTO users
            (role, first_name, last_name, username, email, password, sponsor)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              r.type === "D" ? "Driver" : "Sponsor",
              r.firstName,
              r.lastName,
              r.email,
              r.email,
              "TEMP_PASSWORD",
              finalOrg
            ]
          );

          inserted++;
          insertedRows.push({
            email: r.email,
            name: `${r.firstName} ${r.lastName}`,
            role: r.type === "D" ? "Driver" : "Sponsor"
          });

          if (r.type === "D" && r.points !== undefined && r.points !== null && r.points !== "") {
            const points = Number(r.points);
            const driverId = insertResult.insertId;

            await conn.query(
              "CALL update_driver_points(?, ?, ?)",
              [driverId, points, r.reason || "Initial upload"]
            );

            pointUpdates.push({
              name: `${r.firstName} ${r.lastName}`,
              email: r.email,
              points,
              reason: r.reason || "Initial upload"
            });
          }
        }

        if (r.action === "update_points" && r.type === "D") {
          await conn.query(
            "CALL update_driver_points(?, ?, ?)",
            [r.driverId, r.points, r.reason]
          );
          pointUpdates.push({
            name: `${r.firstName} ${r.lastName}`,
            email: r.email,
            points: Number(r.points),
            reason: r.reason
          });
        }
      }
      await conn.commit();

    }
    catch (err) {
      await conn.rollback();
      throw err;
    }
    finally {
      conn.release();
    }
    res.json({
      success: true,
      inserted,
      insertedRows,
      pointUpdates,
      errors
    });
  }
  catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sponsor/orders/checkout", requireSponsor, async (req, res) => {
  const me = req.session.user;

  const {
    items,
    shipping_method,
    shipping_point_cost,
    shipping_dollar_cost,
    driver_user_id
  } = req.body || {};

  if (!driver_user_id) {
    return res.status(400).json({ error: "A driver must be selected." });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty." });
  }

  if (items.length > 4) {
    return res.status(400).json({ error: "Cart cannot have more than 4 items." });
  }

  const allowedShipping = ["standard", "overnight"];
  if (!allowedShipping.includes(shipping_method)) {
    return res.status(400).json({ error: "Invalid shipping method." });
  }

  const expectedDeliveryDate = getExpectedDeliveryDate(shipping_method);
  const cleanShippingPointCost = Number(shipping_point_cost || 0);
  const cleanShippingDollarCost = Number(shipping_dollar_cost || 0);

  if (!Number.isFinite(cleanShippingPointCost) || cleanShippingPointCost < 0) {
    return res.status(400).json({ error: "Invalid shipping point cost." });
  }

  if (!Number.isFinite(cleanShippingDollarCost) || cleanShippingDollarCost < 0) {
    return res.status(400).json({ error: "Invalid shipping dollar cost." });
  }

  const normalizedItems = [];

  for (const item of items) {
    const productId = Number(item.productId);
    const pointCost = Number(item.pointCost);
    const dollarCost = Number(item.dollarCost);
    const qty = Number(item.qty || 0);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "Invalid product id in cart." });
    }

    if (!Number.isFinite(pointCost) || pointCost < 0) {
      return res.status(400).json({ error: "Invalid point cost in cart." });
    }

    if (!Number.isFinite(dollarCost) || dollarCost < 0) {
      return res.status(400).json({ error: "Invalid dollar cost in cart." });
    }

    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: "Invalid quantity in cart." });
    }

    normalizedItems.push({
      productId,
      pointCost,
      dollarCost,
      qty
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [driverRows] = await conn.query(
      `SELECT
         u.id AS user_id,
         u.first_name,
         u.last_name
       FROM users u
       JOIN user_sponsors us
         ON us.user_id = u.id
       WHERE u.id = ?
         AND u.role = 'Driver'
         AND us.sponsor_name = ?
         AND us.status = 'Active'
       LIMIT 1
       FOR UPDATE`,
      [Number(driver_user_id), me.sponsor]
    );

    if (driverRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Selected driver is not active for your sponsor." });
    }

    const driverUser = driverRows[0];

    const [[actorUser]] = await conn.query(
      `SELECT first_name, last_name
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [me.id]
    );

    const actorName = `${actorUser?.first_name || ""} ${actorUser?.last_name || ""}`.trim() || "Sponsor user";

    const itemsPointTotal = normalizedItems.reduce((sum, item) => {
      return sum + (item.pointCost * item.qty);
    }, 0);

    const totalPointCost = itemsPointTotal + cleanShippingPointCost;

    const [[wallet]] = await conn.query(
      `SELECT points
       FROM user_sponsors
       WHERE user_id = ?
         AND sponsor_name = ?
         AND status = 'Active'
       LIMIT 1
       FOR UPDATE`,
      [driverUser.user_id, me.sponsor]
    );

    if (!wallet) {
      await conn.rollback();
      return res.status(404).json({ error: "Driver sponsor wallet not found." });
    }

    const currentPoints = Number(wallet.points || 0);

    if (totalPointCost > currentPoints) {
      await conn.rollback();
      return res.status(400).json({ error: "The selected driver does not have enough points." });
    }

    const remainingPoints = currentPoints - totalPointCost;

    await conn.query(
      `UPDATE user_sponsors
       SET points = ?
       WHERE user_id = ?
         AND sponsor_name = ?`,
      [remainingPoints, driverUser.user_id, me.sponsor]
    );

    const [[driverRow]] = await conn.query(
      `SELECT id
       FROM drivers
       WHERE user_id = ?
       LIMIT 1`,
      [driverUser.user_id]
    );

    if (!driverRow) {
      await conn.rollback();
      return res.status(404).json({ error: "Driver record not found." });
    }

    await conn.query(
      `INSERT INTO driver_point_history
        (driver_id, sponsor_name, points_change, points_before, points_after, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        driverRow.id,
        me.sponsor,
        -totalPointCost,
        currentPoints,
        remainingPoints,
        `Sponsor Purchase by ${actorName}`
      ]
    );

    const [groupResult] = await conn.query(
      `SELECT UUID() AS group_id`
    );
    const groupId = groupResult[0].group_id;

    const now = new Date();

    for (const item of normalizedItems) {
      for (let i = 0; i < item.qty; i++) {
        await conn.query(
          `INSERT INTO orders
             (
               user_id,
               sponsor_name,
               product_id,
               point_cost,
               dollar_cost,
               date_ordered,
               group_id,
               shipping_method,
               expected_delivery_date
             )
           VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
          [
            driverUser.user_id,
            me.sponsor,
            item.productId,
            item.pointCost,
            item.dollarCost,
            groupId,
            shipping_method,
            expectedDeliveryDate
          ]
        );
      }
    }

    if (cleanShippingPointCost > 0 || cleanShippingDollarCost > 0) {
      await conn.query(
        `INSERT INTO orders
           (
             user_id,
             sponsor_name,
             product_id,
             point_cost,
             dollar_cost,
             date_ordered,
             group_id,
             shipping_method,
             expected_delivery_date
           )
         VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [
          driverUser.user_id,
          me.sponsor,
          0,
          cleanShippingPointCost,
          cleanShippingDollarCost,
          groupId,
          shipping_method,
          expectedDeliveryDate
        ]
      );
    }

    await conn.query(
      `INSERT INTO notifications
        (
          recipient_user_id,
          actor_user_id,
          type,
          category,
          title,
          message,
          related_entity_type,
          related_entity_id,
          scheduled_for
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        driverUser.user_id,
        me.id,
        "sponsor_purchase",
        "order",
        "Item purchased for you",
        `${actorName} has purchased an item on your behalf.`,
        "order_group",
        groupId
      ]
    );

    await createOrderNotifications(conn, {
      recipientUserId: driverUser.user_id,
      actorUserId: me.id,
      groupId,
      shippingMethod: shipping_method,
      expectedDeliveryDate,
      dateOrdered: now
    });

    await conn.commit();
    res.json({
      ok: true,
      groupId,
      remainingPoints
    });
  } catch (err) {
    await conn.rollback();
    console.error("sponsor checkout error:", err);
    res.status(500).json({ error: "Could not place sponsor order." });
  } finally {
    conn.release();
  }
});

function normalizeReportDate(value, endOfDay = false) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date;
}

function buildInClausePlaceholders(values) {
  return values.map(() => "?").join(", ");
}

function truncatePdfText(value, maxLength = 24) {
  const text = String(value ?? "—").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

async function getSponsorReportData({
  sponsorName,
  includeTransactions,
  includePointHistory,
  startDate,
  endDate,
  driverIds
}) {
  const data = {
    transactions: [],
    pointHistory: []
  };

  const hasDriverFilter = Array.isArray(driverIds) && driverIds.length > 0;

  if (includeTransactions) {
    let sql = `
      SELECT
        u.id AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS driver_name,
        o.product_id,
        o.point_cost,
        o.dollar_cost,
        o.shipping_method,
        o.date_ordered
      FROM orders o
      JOIN users u
        ON u.id = o.user_id
      JOIN user_sponsors us
        ON us.user_id = u.id
      WHERE us.sponsor_name = ?
        AND us.status = 'Active'
        AND u.role = 'Driver'
    `;

    const params = [sponsorName];

    sql += ` AND o.sponsor_name = ?`;
    params.push(sponsorName);

    if (hasDriverFilter) {
      sql += ` AND u.id IN (${buildInClausePlaceholders(driverIds)})`;
      params.push(...driverIds);
    }

    if (startDate) {
      sql += ` AND o.date_ordered >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      sql += ` AND o.date_ordered <= ?`;
      params.push(endDate);
    }

    sql += ` ORDER BY o.date_ordered DESC, u.last_name ASC, u.first_name ASC`;

    const [rows] = await pool.query(sql, params);
    data.transactions = rows;
  }

  if (includePointHistory) {
    let sql = `
      SELECT
        u.id AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS driver_name,
        h.points_change,
        h.points_before,
        h.points_after,
        h.reason,
        h.created_at
      FROM driver_point_history h
      JOIN drivers d
        ON d.id = h.driver_id
      JOIN users u
        ON u.id = d.user_id
      JOIN user_sponsors us
        ON us.user_id = u.id
      WHERE h.sponsor_name = ?
        AND us.sponsor_name = ?
        AND us.status = 'Active'
        AND u.role = 'Driver'
    `;

    const params = [sponsorName, sponsorName];

    if (hasDriverFilter) {
      sql += ` AND u.id IN (${buildInClausePlaceholders(driverIds)})`;
      params.push(...driverIds);
    }

    if (startDate) {
      sql += ` AND h.created_at >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      sql += ` AND h.created_at <= ?`;
      params.push(endDate);
    }

    sql += ` ORDER BY h.created_at DESC, u.last_name ASC, u.first_name ASC`;

    const [rows] = await pool.query(sql, params);
    data.pointHistory = rows;
  }

  return data;
}
app.post("/api/sponsor/reports/pdf", requireSponsor, async (req, res) => {
  try {
    const sponsorName = req.session.user.sponsor;

    const {
      includeTransactions = false,
      includePointHistory = false,
      startDate = "",
      endDate = "",
      driverIds = []
    } = req.body || {};

    if (!includeTransactions && !includePointHistory) {
      return res.status(400).json({ error: "Select at least one report category." });
    }

    const normalizedDriverIds = Array.isArray(driverIds)
      ? driverIds.map(Number).filter(Number.isFinite)
      : [];

    const start = normalizeReportDate(startDate, false);
    const end = normalizeReportDate(endDate, true);

    if (startDate && !start) {
      return res.status(400).json({ error: "Invalid start date." });
    }

    if (endDate && !end) {
      return res.status(400).json({ error: "Invalid end date." });
    }

    if (start && end && start > end) {
      return res.status(400).json({ error: "Start date cannot be after end date." });
    }

    const reportData = await getSponsorReportData({
      sponsorName,
      includeTransactions: !!includeTransactions,
      includePointHistory: !!includePointHistory,
      startDate: start,
      endDate: end,
      driverIds: normalizedDriverIds
    });

    const doc = new PDFDocument({
      margin: 40,
      size: "A4"
    });

    const filename = `sponsor-report-${Date.now()}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    doc.pipe(res);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const leftX = 40;
    const usableWidth = pageWidth - 80;
    const bottomLimit = pageHeight - 45;

    function addPageIfNeeded(requiredHeight = 30) {
      if (doc.y + requiredHeight > bottomLimit) {
        doc.addPage();
      }
    }

    function drawReportTitle() {
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(20)
        .text("Sponsor Report", leftX, doc.y, {
          width: usableWidth,
          align: "center"
        });

      doc.moveDown(0.5);

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#374151")
        .text(`Sponsor: ${sponsorName}`)
        .text(`Generated: ${new Date().toLocaleString("en-US")}`)
        .text(`Date Range: ${startDate || "Beginning"} to ${endDate || "Today"}`)
        .text(
          `Included Sections: ${
            [
              includeTransactions ? "Transaction History" : null,
              includePointHistory ? "Point Change History" : null
            ].filter(Boolean).join(" + ")
          }`
        );

      doc.moveDown(1);
    }

    function drawSectionTitle(title) {
      addPageIfNeeded(40);

      const y = doc.y;

      doc.roundedRect(leftX, y, usableWidth, 26, 6).fill("#1f2937");

      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(title, leftX + 10, y + 7, {
          width: usableWidth - 20
        });

      doc.y = y + 34;
      doc.fillColor("#111827");
    }

    function drawTableHeader(headers, widths) {
      addPageIfNeeded(28);

      const y = doc.y;
      let x = leftX;

      doc.rect(leftX, y, usableWidth, 26).fill("#e5e7eb");

      doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");

      headers.forEach((header, i) => {
        doc.text(header, x + 6, y + 7, {
          width: widths[i] - 12,
          lineBreak: false,
          ellipsis: true
        });
        x += widths[i];
      });

      doc
        .strokeColor("#c7ccd4")
        .lineWidth(1)
        .rect(leftX, y, usableWidth, 26)
        .stroke();

      doc.y = y + 26;
    }

    function drawTableRow(values, widths, rowIndex) {
      addPageIfNeeded(28);

      const y = doc.y;
      let x = leftX;
      const rowHeight = 26;

      if (rowIndex % 2 === 0) {
        doc.rect(leftX, y, usableWidth, rowHeight).fill("#f9fafb");
      } else {
        doc.rect(leftX, y, usableWidth, rowHeight).fill("#ffffff");
      }

      doc.font("Helvetica").fontSize(10).fillColor("#111827");

      values.forEach((value, i) => {
        doc.text(String(value ?? "—"), x + 6, y + 7, {
          width: widths[i] - 12,
          lineBreak: false,
          ellipsis: true
        });
        x += widths[i];
      });

      doc
        .strokeColor("#d1d5db")
        .lineWidth(1)
        .rect(leftX, y, usableWidth, rowHeight)
        .stroke();

      doc.y = y + rowHeight;
    }

    function renderTransactionsSection(rows) {
      drawSectionTitle("Transaction History");

      if (!rows.length) {
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#4b5563")
          .text("No transaction history found for the selected filters.");
        doc.moveDown(1);
        return;
      }

      const headers = ["Driver", "Product ID", "Points", "Dollars", "Shipping", "Date"];
      const widths = [155, 70, 65, 80, 85, 80];

      drawTableHeader(headers, widths);

      rows.forEach((row, index) => {
        if (doc.y + 28 > bottomLimit) {
          doc.addPage();
          drawTableHeader(headers, widths);
        }

        drawTableRow(
          [
            truncatePdfText(row.driver_name, 28),
            truncatePdfText(row.product_id, 12),
            row.point_cost ?? "—",
            `$${Number(row.dollar_cost || 0).toFixed(2)}`,
            truncatePdfText(row.shipping_method || "—", 12),
            row.date_ordered
              ? new Date(row.date_ordered).toLocaleDateString("en-US")
              : "—"
          ],
          widths,
          index
        );
      });

      doc.moveDown(1);
    }

    function renderPointHistorySection(rows) {
      drawSectionTitle("Point Change History");

      if (!rows.length) {
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#4b5563")
          .text("No point change history found for the selected filters.");
        doc.moveDown(1);
        return;
      }

      const headers = ["Driver", "Change", "Before", "After", "Reason", "Date"];
      const widths = [125, 60, 60, 60, 155, 80];

      drawTableHeader(headers, widths);

      rows.forEach((row, index) => {
        if (doc.y + 28 > bottomLimit) {
          doc.addPage();
          drawTableHeader(headers, widths);
        }

        const changeValue = Number(row.points_change || 0);
        const signedChange = changeValue > 0 ? `+${changeValue}` : `${changeValue}`;

        drawTableRow(
          [
            truncatePdfText(row.driver_name, 22),
            signedChange,
            row.points_before ?? "—",
            row.points_after ?? "—",
            truncatePdfText(row.reason || "—", 26),
            row.created_at
              ? new Date(row.created_at).toLocaleDateString("en-US")
              : "—"
          ],
          widths,
          index
        );
      });

      doc.moveDown(1);
    }

    drawReportTitle();

    if (includeTransactions) {
      renderTransactionsSection(reportData.transactions);
    }

    if (includePointHistory) {
      renderPointHistorySection(reportData.pointHistory);
    }

    doc.end();
  } catch (err) {
    console.error("sponsor pdf report error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not generate PDF report." });
    }
  }
});

app.get("/api/admin/audit-logs", requireLogin, async (req, res) => {
  try {
    const me = req.session.user;

    let scopeSponsor = null;
    let scopeUserId = null;

    if (me.role !== "Admin") {
      const roleKey = me.role === "Sponsor" ? "sponsor" : "driver";

      const [settingRows] = await pool.query(
        `SELECT access_level
         FROM audit_access_settings
         WHERE role_type = ?`,
        [roleKey]
      );

      const level = settingRows[0]?.access_level ?? "none";

      if (level === "none") {
        return res.status(403).json({ error: "Access to audit logs is disabled." });
      }

      if (level === "own") {
        if (me.role === "Sponsor") scopeSponsor = me.sponsor;
        if (me.role === "Driver") scopeUserId = me.id;
      }
    }

    const {
      event_types,
      sponsor,
      status,
      date_from,
      date_to,
      search
    } = req.query || {};

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const offset = (page - 1) * limit;

    const validEventTypes = new Set([
      "login",
      "login_failed",
      "purchase",
      "driver_application",
      "account_created"
    ]);

    const validStatuses = new Set(["success", "failure", "pending"]);

    const selectedEventTypes = String(event_types || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .filter(t => validEventTypes.has(t));

    const statusFilter = validStatuses.has(String(status || "")) ? String(status) : null;

    const sponsorFilter = scopeSponsor
      ? scopeSponsor
      : (String(sponsor || "").trim() || null);

    const searchFilter = String(search || "").trim() || null;
    const fromDate = date_from ? new Date(`${date_from}T00:00:00`) : null;
    const toDate = date_to ? new Date(`${date_to}T23:59:59`) : null;

    const sources = [];
    const sourceParams = [];

    const sqlList = arr => arr.map(() => "?").join(",");

    const loginSponsorScope = sponsorFilter ? `AND u.sponsor = ?` : "";
    const loginUserScope = scopeUserId ? `AND u.id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('login_', la.id) AS source_key,
        CASE
          WHEN LOWER(la.status) = 'success' THEN 'login'
          ELSE 'login_failed'
        END AS event_type,
        CASE
          WHEN LOWER(la.status) = 'success' THEN 'Successful login'
          ELSE 'Failed login attempt'
        END AS description,
        CASE
          WHEN LOWER(la.status) = 'success' THEN 'success'
          ELSE 'failure'
        END AS status,
        u.sponsor AS sponsor_name,
        NULL AS ip_address,
        la.attempt_time AS created_at,
        NULL AS metadata,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
      FROM login_attempts la
      LEFT JOIN users u
        ON u.username = la.username
      WHERE 1=1
        ${loginUserScope}
        ${selectedEventTypes.length ? `AND CASE WHEN LOWER(la.status) = 'success' THEN 'login' ELSE 'login_failed' END IN (${sqlList(selectedEventTypes)})` : ""}
        ${loginSponsorScope}
        ${fromDate ? `AND la.attempt_time >= ?` : ""}
        ${toDate ? `AND la.attempt_time <= ?` : ""}
        ${searchFilter ? `AND (la.username LIKE ? OR u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like, like);
    }

    const purchaseSponsorScope = sponsorFilter ? `AND o.sponsor_name = ?` : "";
    const purchaseUserScope = scopeUserId ? `AND o.user_id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('order_', o.id) AS source_key,
        'purchase' AS event_type,
        CONCAT('Catalog purchase: product ', o.product_id) AS description,
        'success' AS status,
        o.sponsor_name AS sponsor_name,
        NULL AS ip_address,
        o.date_ordered AS created_at,
        JSON_OBJECT(
          'product_id', o.product_id,
          'points_spent', o.point_cost,
          'dollar_cost', o.dollar_cost,
          'shipping_method', o.shipping_method,
          'group_id', o.group_id
        ) AS metadata,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
      FROM orders o
      JOIN users u
        ON u.id = o.user_id
      WHERE 1=1
        ${purchaseUserScope}
        ${selectedEventTypes.length ? `AND 'purchase' IN (${sqlList(selectedEventTypes)})` : ""}
        ${purchaseSponsorScope}
        ${fromDate ? `AND o.date_ordered >= ?` : ""}
        ${toDate ? `AND o.date_ordered <= ?` : ""}
        ${searchFilter ? `AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR o.product_id LIKE ?)` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like, like);
    }

    const appSponsorScope = sponsorFilter ? `AND aps.sponsor_name = ?` : "";
    const appUserScope = scopeUserId ? `AND u.id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('application_', a.id, '_', aps.sponsor_name) AS source_key,
        'driver_application' AS event_type,
        CONCAT(
          'Driver application submitted',
          CASE
            WHEN a.status = 'Accepted' THEN ' (accepted)'
            WHEN a.status = 'Rejected' THEN ' (rejected)'
            ELSE ''
          END
        ) AS description,
        CASE
          WHEN a.status = 'Pending' THEN 'pending'
          WHEN a.status = 'Accepted' THEN 'success'
          WHEN a.status = 'Rejected' THEN 'failure'
          ELSE LOWER(a.status)
        END AS status,
        aps.sponsor_name AS sponsor_name,
        NULL AS ip_address,
        COALESCE(a.reviewed_at, a.created_at) AS created_at,
        JSON_OBJECT(
          'application_id', a.id,
          'application_status', a.status,
          'rejection_reason', a.rejection_reason
        ) AS metadata,
        u.id AS user_id,
        a.email AS user_email,
        'Driver' AS user_role,
        TRIM(CONCAT(COALESCE(a.first_name, ''), ' ', COALESCE(a.last_name, ''))) AS user_name
      FROM applications a
      JOIN application_sponsors aps
        ON aps.application_id = a.id
      LEFT JOIN users u
        ON u.email = a.email
      WHERE a.role = 'Driver'
        ${appUserScope}
        ${selectedEventTypes.length ? `AND 'driver_application' IN (${sqlList(selectedEventTypes)})` : ""}
        ${appSponsorScope}
        ${fromDate ? `AND COALESCE(a.reviewed_at, a.created_at) >= ?` : ""}
        ${toDate ? `AND COALESCE(a.reviewed_at, a.created_at) <= ?` : ""}
        ${searchFilter ? `AND (a.email LIKE ? OR a.first_name LIKE ? OR a.last_name LIKE ? OR aps.sponsor_name LIKE ?)` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like, like);
    }

    const acctSponsorScope = sponsorFilter ? `AND u.sponsor = ?` : "";
    const acctUserScope = scopeUserId ? `AND u.id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('user_', u.id) AS source_key,
        'account_created' AS event_type,
        CONCAT('Account created (', u.role, ')') AS description,
        'success' AS status,
        u.sponsor AS sponsor_name,
        NULL AS ip_address,
        u.time_created AS created_at,
        NULL AS metadata,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
      FROM users u
      WHERE 1=1
        ${acctUserScope}
        ${selectedEventTypes.length ? `AND 'account_created' IN (${sqlList(selectedEventTypes)})` : ""}
        ${acctSponsorScope}
        ${fromDate ? `AND u.time_created >= ?` : ""}
        ${toDate ? `AND u.time_created <= ?` : ""}
        ${searchFilter ? `AND (u.email LIKE ? OR u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like, like);
    }

    const unionSql = sources.join("\nUNION ALL\n");

    const outerWhere = [];
    const outerParams = [];

    if (statusFilter) {
      outerWhere.push(`combined.status = ?`);
      outerParams.push(statusFilter);
    }

    const outerWhereSql = outerWhere.length
      ? `WHERE ${outerWhere.join(" AND ")}`
      : "";

    const [[countRow]] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM (${unionSql}) combined
      ${outerWhereSql}
      `,
      [...sourceParams, ...outerParams]
    );

    const [rows] = await pool.query(
      `
      SELECT *
      FROM (${unionSql}) combined
      ${outerWhereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...sourceParams, ...outerParams, limit, offset]
    );

    res.json({
      data: rows.map(row => ({
        ...row,
        metadata:
          row.metadata && typeof row.metadata === "string"
            ? JSON.parse(row.metadata)
            : row.metadata || null
      })),
      pagination: {
        total: Number(countRow.total || 0),
        page,
        limit,
        pages: Math.max(1, Math.ceil(Number(countRow.total || 0) / limit))
      }
    });
  } catch (err) {
    console.error("audit-logs GET error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/admin/audit-logs/sponsors", requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT sponsor_name
       FROM user_sponsors
       WHERE sponsor_name IS NOT NULL AND sponsor_name != ''
       ORDER BY sponsor_name ASC`
    );
    res.json(rows.map(r => r.sponsor_name));
  } catch (err) {
    console.error("audit-logs sponsors error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ── GET /api/admin/audit-access-settings ─────────────────────
app.get('/api/admin/audit-access-settings', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT role_type, access_level FROM audit_access_settings`
    );
    const settings = { sponsor: 'own', driver: 'none' };
    rows.forEach(r => { settings[r.role_type] = r.access_level; });
    res.json(settings);
  } catch (err) {
    console.error('audit-access-settings GET error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── POST /api/admin/audit-access-settings ────────────────────
app.post('/api/admin/audit-access-settings', requireAdmin, async (req, res) => {
  const { role_type, access_level } = req.body || {};
  const VALID_ROLES  = new Set(['sponsor', 'driver']);
  const VALID_LEVELS = new Set(['all', 'own', 'none']);
  if (!VALID_ROLES.has(role_type) || !VALID_LEVELS.has(access_level)) {
    return res.status(400).json({ error: 'Invalid role_type or access_level' });
  }
  try {
    await pool.query(
      `INSERT INTO audit_access_settings (role_type, access_level)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE access_level = VALUES(access_level)`,
      [role_type, access_level]
    );
    res.json({ ok: true, role_type, access_level });
  } catch (err) {
    console.error('audit-access-settings POST error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post("/api/admin/audit-logs/pdf", requireLogin, async (req, res) => {
  try {
    const me = req.session.user;

    // ── Access control ────────────────────────────────────────
    let scopeSponsor = null;
    let scopeUserId = null;

    if (me.role !== "Admin") {
      const roleKey = me.role === "Sponsor" ? "sponsor" : "driver";

      const [settingRows] = await pool.query(
        `SELECT access_level
         FROM audit_access_settings
         WHERE role_type = ?`,
        [roleKey]
      );

      const level = settingRows[0]?.access_level ?? "none";

      if (level === "none") {
        return res.status(403).json({ error: "Access to audit logs is disabled." });
      }

      if (level === "own") {
        if (me.role === "Sponsor") scopeSponsor = me.sponsor;
        if (me.role === "Driver") scopeUserId = me.id;
      }
    }

    const {
      event_types = [],
      sponsor = "",
      status = "",
      date_from = "",
      date_to = "",
      search = ""
    } = req.body || {};

    const validEventTypes = new Set([
      "login",
      "login_failed",
      "purchase",
      "driver_application",
      "account_created"
    ]);

    const validStatuses = new Set(["success", "failure", "pending"]);

    const selectedEventTypes = Array.isArray(event_types)
      ? event_types.map(v => String(v).trim()).filter(v => validEventTypes.has(v))
      : String(event_types || "")
          .split(",")
          .map(v => v.trim())
          .filter(v => validEventTypes.has(v));

    const statusFilter = validStatuses.has(String(status || "").trim())
      ? String(status).trim()
      : null;

    const sponsorFilter = scopeSponsor
      ? scopeSponsor
      : (String(sponsor || "").trim() || null);

    const searchFilter = String(search || "").trim() || null;
    const fromDate = date_from ? new Date(`${date_from}T00:00:00`) : null;
    const toDate = date_to ? new Date(`${date_to}T23:59:59`) : null;

    if (date_from && Number.isNaN(fromDate?.getTime())) {
      return res.status(400).json({ error: "Invalid start date." });
    }

    if (date_to && Number.isNaN(toDate?.getTime())) {
      return res.status(400).json({ error: "Invalid end date." });
    }

    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ error: "Start date cannot be after end date." });
    }

    const sources = [];
    const sourceParams = [];

    const sqlList = arr => arr.map(() => "?").join(",");

    // ── LOGIN / LOGIN FAILED ──────────────────────────────────
    const loginSponsorScope = sponsorFilter ? `AND u.sponsor = ?` : "";
    const loginUserScope = scopeUserId ? `AND u.id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('login_', la.id) AS source_key,
        CASE
          WHEN LOWER(la.status) = 'success' THEN 'login'
          ELSE 'login_failed'
        END AS event_type,
        CASE
          WHEN LOWER(la.status) = 'success' THEN 'Successful login'
          ELSE 'Failed login attempt'
        END AS description,
        CASE
          WHEN LOWER(la.status) = 'success' THEN 'success'
          ELSE 'failure'
        END AS status,
        u.sponsor AS sponsor_name,
        NULL AS ip_address,
        la.attempt_time AS created_at,
        NULL AS metadata,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
      FROM login_attempts la
      LEFT JOIN users u
        ON u.username = la.username
      WHERE 1=1
        ${loginUserScope}
        ${selectedEventTypes.length ? `AND CASE WHEN LOWER(la.status) = 'success' THEN 'login' ELSE 'login_failed' END IN (${sqlList(selectedEventTypes)})` : ""}
        ${loginSponsorScope}
        ${fromDate ? `AND la.attempt_time >= ?` : ""}
        ${toDate ? `AND la.attempt_time <= ?` : ""}
        ${searchFilter ? `AND (la.username LIKE ? OR u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like, like);
    }

    // ── PURCHASES ─────────────────────────────────────────────
    const purchaseSponsorScope = sponsorFilter ? `AND o.sponsor_name = ?` : "";
    const purchaseUserScope = scopeUserId ? `AND o.user_id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('order_', o.id) AS source_key,
        'purchase' AS event_type,
        CONCAT('Catalog purchase: product ', o.product_id) AS description,
        'success' AS status,
        o.sponsor_name AS sponsor_name,
        NULL AS ip_address,
        o.date_ordered AS created_at,
        JSON_OBJECT(
          'product_id', o.product_id,
          'points_spent', o.point_cost,
          'dollar_cost', o.dollar_cost,
          'shipping_method', o.shipping_method,
          'group_id', o.group_id
        ) AS metadata,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
      FROM orders o
      JOIN users u
        ON u.id = o.user_id
      WHERE 1=1
        ${purchaseUserScope}
        ${selectedEventTypes.length ? `AND 'purchase' IN (${sqlList(selectedEventTypes)})` : ""}
        ${purchaseSponsorScope}
        ${fromDate ? `AND o.date_ordered >= ?` : ""}
        ${toDate ? `AND o.date_ordered <= ?` : ""}
        ${searchFilter ? `AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR o.product_id LIKE ?)` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like, like);
    }

    // ── DRIVER APPLICATIONS ───────────────────────────────────
    const appSponsorScope = sponsorFilter ? `AND aps.sponsor_name = ?` : "";
    const appUserScope = scopeUserId ? `AND u.id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('application_', a.id, '_', aps.sponsor_name) AS source_key,
        'driver_application' AS event_type,
        CONCAT(
          'Driver application submitted',
          CASE
            WHEN a.status = 'Accepted' THEN ' (accepted)'
            WHEN a.status = 'Rejected' THEN ' (rejected)'
            ELSE ''
          END
        ) AS description,
        CASE
          WHEN a.status = 'Pending' THEN 'pending'
          WHEN a.status = 'Accepted' THEN 'success'
          WHEN a.status = 'Rejected' THEN 'failure'
          ELSE LOWER(a.status)
        END AS status,
        aps.sponsor_name AS sponsor_name,
        NULL AS ip_address,
        COALESCE(a.reviewed_at, a.created_at) AS created_at,
        JSON_OBJECT(
          'application_id', a.id,
          'application_status', a.status,
          'rejection_reason', a.rejection_reason
        ) AS metadata,
        u.id AS user_id,
        a.email AS user_email,
        'Driver' AS user_role,
        TRIM(CONCAT(COALESCE(a.first_name, ''), ' ', COALESCE(a.last_name, ''))) AS user_name
      FROM applications a
      JOIN application_sponsors aps
        ON aps.application_id = a.id
      LEFT JOIN users u
        ON u.email = a.email
      WHERE a.role = 'Driver'
        ${appUserScope}
        ${selectedEventTypes.length ? `AND 'driver_application' IN (${sqlList(selectedEventTypes)})` : ""}
        ${appSponsorScope}
        ${fromDate ? `AND COALESCE(a.reviewed_at, a.created_at) >= ?` : ""}
        ${toDate ? `AND COALESCE(a.reviewed_at, a.created_at) <= ?` : ""}
        ${searchFilter ? `AND (a.email LIKE ? OR a.first_name LIKE ? OR a.last_name LIKE ? OR aps.sponsor_name LIKE ?)` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like, like);
    }

    // ── ACCOUNT CREATED ───────────────────────────────────────
    const acctSponsorScope = sponsorFilter ? `AND u.sponsor = ?` : "";
    const acctUserScope = scopeUserId ? `AND u.id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('user_', u.id) AS source_key,
        'account_created' AS event_type,
        CONCAT('Account created (', u.role, ')') AS description,
        'success' AS status,
        u.sponsor AS sponsor_name,
        NULL AS ip_address,
        u.time_created AS created_at,
        NULL AS metadata,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
      FROM users u
      WHERE 1=1
        ${acctUserScope}
        ${selectedEventTypes.length ? `AND 'account_created' IN (${sqlList(selectedEventTypes)})` : ""}
        ${acctSponsorScope}
        ${fromDate ? `AND u.time_created >= ?` : ""}
        ${toDate ? `AND u.time_created <= ?` : ""}
        ${searchFilter ? `AND (u.email LIKE ? OR u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like, like);
    }

    // ── Final unified query ───────────────────────────────────
    const unionSql = sources.join("\nUNION ALL\n");

    const outerWhere = [];
    const outerParams = [];

    if (statusFilter) {
      outerWhere.push(`combined.status = ?`);
      outerParams.push(statusFilter);
    }

    const outerWhereSql = outerWhere.length
      ? `WHERE ${outerWhere.join(" AND ")}`
      : "";

    const [rows] = await pool.query(
      `
      SELECT *
      FROM (${unionSql}) combined
      ${outerWhereSql}
      ORDER BY created_at DESC
      `,
      [...sourceParams, ...outerParams]
    );

    const data = rows.map(row => ({
      ...row,
      metadata:
        row.metadata && typeof row.metadata === "string"
          ? JSON.parse(row.metadata)
          : row.metadata || null
    }));

    // ── PDF generation (same style as sponsor report) ─────────
    const doc = new PDFDocument({
      margin: 40,
      size: "A4"
    });

    const filename = `audit-log-report-${Date.now()}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    doc.pipe(res);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const leftX = 40;
    const usableWidth = pageWidth - 80;
    const bottomLimit = pageHeight - 45;


    function addPageIfNeeded(requiredHeight = 30) {
      if (doc.y + requiredHeight > bottomLimit) {
        doc.addPage();
      }
    }

    function truncatePdfText(value, maxLength = 30) {
      const str = String(value ?? "—");
      if (str.length <= maxLength) return str;
      return `${str.slice(0, Math.max(0, maxLength - 3))}...`;
    }

    function formatPdfDate(value) {
      if (!value) return "—";
      return new Date(value).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    }

    function drawReportTitle() {
      const who =
        me.role === "Admin"
          ? "Admin"
          : me.role === "Sponsor"
            ? `Sponsor (${me.sponsor || "Own Scope"})`
            : "Driver";

      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(20)
        .text("Audit Log Report", leftX, doc.y, {
          width: usableWidth,
          align: "center"
        });

      doc.moveDown(0.5);

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#374151")
        .text(`Viewer: ${who}`)
        .text(`Generated: ${new Date().toLocaleString("en-US")}`)
        .text(`Date Range: ${date_from || "Beginning"} to ${date_to || "Today"}`)
        .text(`Status Filter: ${statusFilter || "All"}`)
        .text(`Sponsor Filter: ${sponsorFilter || "All"}`)
        .text(
          `Event Types: ${
            selectedEventTypes.length
              ? selectedEventTypes.join(", ")
              : "All"
          }`
        )
        .text(`Search: ${searchFilter || "None"}`)
        .text(`Total Rows: ${data.length}`);

      doc.moveDown(1);
    }

    function drawSectionTitle(title) {
      addPageIfNeeded(40);

      const y = doc.y;

      doc.roundedRect(leftX, y, usableWidth, 26, 6).fill("#1f2937");

      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(title, leftX + 10, y + 7, {
          width: usableWidth - 20
        });

      doc.y = y + 34;
      doc.fillColor("#111827");
    }

    function drawTableHeader(headers, widths) {
      addPageIfNeeded(28);

      const y = doc.y;
      let x = leftX;

      doc.rect(leftX, y, usableWidth, 26).fill("#e5e7eb");

      doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");

      headers.forEach((header, i) => {
        doc.text(header, x + 6, y + 7, {
          width: widths[i] - 12,
          lineBreak: false,
          ellipsis: true
        });
        x += widths[i];
      });

      doc
        .strokeColor("#c7ccd4")
        .lineWidth(1)
        .rect(leftX, y, usableWidth, 26)
        .stroke();

      doc.y = y + 26;
    }

    function drawTableRow(values, widths, rowIndex) {
      addPageIfNeeded(28);

      const y = doc.y;
      let x = leftX;
      const rowHeight = 26;

      if (rowIndex % 2 === 0) {
        doc.rect(leftX, y, usableWidth, rowHeight).fill("#f9fafb");
      } else {
        doc.rect(leftX, y, usableWidth, rowHeight).fill("#ffffff");
      }

      doc.font("Helvetica").fontSize(10).fillColor("#111827");

      values.forEach((value, i) => {
        doc.text(String(value ?? "—"), x + 6, y + 7, {
          width: widths[i] - 12,
          lineBreak: false,
          ellipsis: true
        });
        x += widths[i];
      });

      doc
        .strokeColor("#d1d5db")
        .lineWidth(1)
        .rect(leftX, y, usableWidth, rowHeight)
        .stroke();

      doc.y = y + rowHeight;
    }

    function renderEventSection(title, rows, columns) {
      drawSectionTitle(title);

      if (!rows.length) {
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#4b5563")
          .text("No records found for this section.");
        doc.moveDown(1);
        return;
      }

      const headers = columns.map(col => col.header);
      const widths = columns.map(col => col.width);

      drawTableHeader(headers, widths);

      rows.forEach((row, index) => {
        if (doc.y + 28 > bottomLimit) {
          doc.addPage();
          drawTableHeader(headers, widths);
        }

        drawTableRow(
          columns.map(col => col.value(row)),
          widths,
          index
        );
      });

      doc.moveDown(1);
    }

    function formatDollar(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return "—";
      return `$${num.toFixed(2)}`;
    }

    function renderSponsorSpendingSummary(rows) {
      const totals = new Map();

      rows.forEach(row => {
        const sponsor = row.sponsor_name || "Unknown Sponsor";
        const dollars = Number(row.metadata?.dollar_cost || 0);

        if (!Number.isFinite(dollars)) return;
        totals.set(sponsor, (totals.get(sponsor) || 0) + dollars);
      });

      const summaryEntries = Array.from(totals.entries())
        .sort((a, b) => a[0].localeCompare(b[0]));

      const neededHeight = 26 + 18 + (summaryEntries.length || 1) * 16 + 12;
      addPageIfNeeded(neededHeight);

      const startY = doc.y;

      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#111827")
        .text("Total Spending ($)", leftX, startY, {
          width: usableWidth,
          align: "left"
        });

      let lineY = doc.y + 4;

      if (!summaryEntries.length) {
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#4b5563")
          .text("No purchase totals available.", leftX, lineY, {
            width: usableWidth,
            align: "left"
          });

        doc.moveDown(1);
        return;
      }

      summaryEntries.forEach(([sponsor, total]) => {
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#111827")
          .text(`${sponsor}: $${total.toFixed(2)}`, leftX, lineY, {
            width: usableWidth,
            align: "left"
          });

        lineY += 16;
      });

      doc.y = lineY + 8;
    }

    const loginRows = data.filter(row => row.event_type === "login");
    const failedLoginRows = data.filter(row => row.event_type === "login_failed");
    const purchaseRows = data.filter(row => row.event_type === "purchase");
    const applicationRows = data.filter(row => row.event_type === "driver_application");
    const accountCreatedRows = data.filter(row => row.event_type === "account_created");

    drawReportTitle();

    renderEventSection("Login Events", loginRows, [
      { header: "Date", width: 110, value: row => formatPdfDate(row.created_at) },
      { header: "User", width: 170, value: row => truncatePdfText(row.user_name || row.user_email || "—", 28) },
      { header: "Sponsor", width: 120, value: row => truncatePdfText(row.sponsor_name || "—", 18) },
      { header: "Status", width: 70, value: row => truncatePdfText(row.status || "—", 10) },
      { header: "IP", width: 85, value: row => truncatePdfText(row.ip_address || "—", 16) }
    ]);

    renderEventSection("Failed Login Events", failedLoginRows, [
      { header: "Date", width: 110, value: row => formatPdfDate(row.created_at) },
      { header: "User", width: 170, value: row => truncatePdfText(row.user_name || row.user_email || "—", 28) },
      { header: "Sponsor", width: 120, value: row => truncatePdfText(row.sponsor_name || "—", 18) },
      { header: "Status", width: 70, value: row => truncatePdfText(row.status || "—", 10) },
      { header: "IP", width: 85, value: row => truncatePdfText(row.ip_address || "—", 16) }
    ]);

    renderEventSection("Purchases", purchaseRows, [
      { header: "Date", width: 88, value: row => formatPdfDate(row.created_at) },
      { header: "User", width: 165, value: row => truncatePdfText(row.user_name || row.user_email || "—", 26) },
      { header: "Sponsor", width: 95, value: row => truncatePdfText(row.sponsor_name || "—", 15) },
      { header: "Product", width: 60, value: row => truncatePdfText(row.metadata?.product_id || "—", 10) },
      { header: "Points", width: 60, value: row => row.metadata?.points_spent ?? "—" },
      { header: "Price ($)", width: 112, value: row => formatDollar(row.metadata?.dollar_cost) }
    ]);

    renderSponsorSpendingSummary(purchaseRows);

    renderEventSection("Driver Applications", applicationRows, [
      { header: "Date", width: 95, value: row => formatPdfDate(row.created_at) },
      { header: "User", width: 140, value: row => truncatePdfText(row.user_name || row.user_email || "—", 24) },
      { header: "Sponsor", width: 110, value: row => truncatePdfText(row.sponsor_name || "—", 18) },
      { header: "Status", width: 75, value: row => truncatePdfText(row.status || "—", 10) },
      { header: "Reason", width: 140, value: row => truncatePdfText(row.metadata?.rejection_reason || "—", 24) }
    ]);

    renderEventSection("Account Created Events", accountCreatedRows, [
      { header: "Date", width: 110, value: row => formatPdfDate(row.created_at) },
      { header: "User", width: 180, value: row => truncatePdfText(row.user_name || row.user_email || "—", 30) },
      { header: "Role", width: 80, value: row => truncatePdfText(row.user_role || "—", 12) },
      { header: "Sponsor", width: 140, value: row => truncatePdfText(row.sponsor_name || "—", 22) }
    ]);

    doc.end();
  } catch (err) {
    console.error("audit logs pdf export error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not generate PDF report." });
    }
  }
});

function escapeCsv(value) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

app.post("/api/admin/audit-logs/csv", requireLogin, async (req, res) => {
  try {
    const me = req.session.user;

    // ── Access control ────────────────────────────────────────
    let scopeSponsor = null;
    let scopeUserId = null;

    if (me.role !== "Admin") {
      const roleKey = me.role === "Sponsor" ? "sponsor" : "driver";

      const [settingRows] = await pool.query(
        `SELECT access_level
         FROM audit_access_settings
         WHERE role_type = ?`,
        [roleKey]
      );

      const level = settingRows[0]?.access_level ?? "none";

      if (level === "none") {
        return res.status(403).json({ error: "Access to audit logs is disabled." });
      }

      if (level === "own") {
        if (me.role === "Sponsor") scopeSponsor = me.sponsor;
        if (me.role === "Driver") scopeUserId = me.id;
      }
    }

    const {
      event_types = [],
      sponsor = "",
      status = "",
      date_from = "",
      date_to = "",
      search = ""
    } = req.body || {};

    const validEventTypes = new Set([
      "login",
      "login_failed",
      "purchase",
      "driver_application",
      "account_created"
    ]);

    const validStatuses = new Set(["success", "failure", "pending"]);

    const selectedEventTypes = Array.isArray(event_types)
      ? event_types.map(v => String(v).trim()).filter(v => validEventTypes.has(v))
      : String(event_types || "")
          .split(",")
          .map(v => v.trim())
          .filter(v => validEventTypes.has(v));

    const statusFilter = validStatuses.has(String(status || "").trim())
      ? String(status).trim()
      : null;

    const sponsorFilter = scopeSponsor
      ? scopeSponsor
      : (String(sponsor || "").trim() || null);

    const searchFilter = String(search || "").trim() || null;
    const fromDate = date_from ? new Date(`${date_from}T00:00:00`) : null;
    const toDate = date_to ? new Date(`${date_to}T23:59:59`) : null;

    if (date_from && Number.isNaN(fromDate?.getTime())) {
      return res.status(400).json({ error: "Invalid start date." });
    }

    if (date_to && Number.isNaN(toDate?.getTime())) {
      return res.status(400).json({ error: "Invalid end date." });
    }

    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ error: "Start date cannot be after end date." });
    }

    const sources = [];
    const sourceParams = [];
    const sqlList = arr => arr.map(() => "?").join(",");

    // ── LOGIN / LOGIN FAILED ──────────────────────────────────
    const loginSponsorScope = sponsorFilter ? `AND u.sponsor = ?` : "";
    const loginUserScope = scopeUserId ? `AND u.id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('login_', la.id) AS source_key,
        CASE
          WHEN LOWER(la.status) = 'success' THEN 'login'
          ELSE 'login_failed'
        END AS event_type,
        CASE
          WHEN LOWER(la.status) = 'success' THEN 'Successful login'
          ELSE 'Failed login attempt'
        END AS description,
        CASE
          WHEN LOWER(la.status) = 'success' THEN 'success'
          ELSE 'failure'
        END AS status,
        u.sponsor AS sponsor_name,
        NULL AS ip_address,
        la.attempt_time AS created_at,
        NULL AS metadata,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
      FROM login_attempts la
      LEFT JOIN users u
        ON u.username = la.username
      WHERE 1=1
        ${loginUserScope}
        ${selectedEventTypes.length
          ? `AND (CASE WHEN LOWER(la.status) = 'success' THEN 'login' ELSE 'login_failed' END) IN (${sqlList(selectedEventTypes)})`
          : ""}
        ${statusFilter ? `AND LOWER(la.status) = ?` : ""}
        ${loginSponsorScope}
        ${fromDate ? `AND la.attempt_time >= ?` : ""}
        ${toDate ? `AND la.attempt_time <= ?` : ""}
        ${searchFilter ? `AND (
          la.username LIKE ?
          OR u.email LIKE ?
          OR CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) LIKE ?
        )` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (statusFilter) sourceParams.push(statusFilter);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like);
    }

    // ── PURCHASES ─────────────────────────────────────────────
    const purchaseSponsorScope = sponsorFilter ? `AND o.sponsor_name = ?` : "";
    const purchaseUserScope = scopeUserId ? `AND o.user_id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('purchase_', o.id) AS source_key,
        'purchase' AS event_type,
        'Purchase completed' AS description,
        'success' AS status,
        o.sponsor_name AS sponsor_name,
        NULL AS ip_address,
        o.date_ordered AS created_at,
        JSON_OBJECT(
          'product_id', o.product_id,
          'points_spent', o.point_cost,
          'dollar_cost', o.dollar_cost,
          'shipping_method', o.shipping_method
        ) AS metadata,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
      FROM orders o
      JOIN users u
        ON u.id = o.user_id
      WHERE 1=1
        ${purchaseUserScope}
        ${selectedEventTypes.length ? `AND 'purchase' IN (${sqlList(selectedEventTypes)})` : ""}
        ${statusFilter ? `AND ? = 'success'` : ""}
        ${purchaseSponsorScope}
        ${fromDate ? `AND o.date_ordered >= ?` : ""}
        ${toDate ? `AND o.date_ordered <= ?` : ""}
        ${searchFilter ? `AND (
          u.email LIKE ?
          OR CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) LIKE ?
          OR o.product_id LIKE ?
        )` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (statusFilter) sourceParams.push(statusFilter);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like);
    }

    // ── DRIVER APPLICATIONS ───────────────────────────────────
    const appSponsorScope = sponsorFilter ? `AND aps.sponsor_name = ?` : "";
    const appUserScope = scopeUserId ? `AND u.id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('application_', a.id, '_', aps.sponsor_name) AS source_key,
        'driver_application' AS event_type,
        'Driver application submitted/reviewed' AS description,
        CASE
          WHEN LOWER(a.status) = 'accepted' THEN 'success'
          WHEN LOWER(a.status) = 'rejected' THEN 'failure'
          ELSE 'pending'
        END AS status,
        aps.sponsor_name AS sponsor_name,
        NULL AS ip_address,
        COALESCE(a.reviewed_at, a.created_at) AS created_at,
        JSON_OBJECT(
          'application_status', a.status,
          'rejection_reason', a.rejection_reason
        ) AS metadata,
        u.id AS user_id,
        a.email AS user_email,
        'Driver' AS user_role,
        TRIM(CONCAT(COALESCE(a.first_name, ''), ' ', COALESCE(a.last_name, ''))) AS user_name
      FROM applications a
      JOIN application_sponsors aps
        ON aps.application_id = a.id
      LEFT JOIN users u
        ON u.email = a.email
      WHERE a.role = 'Driver'
        ${appUserScope}
        ${selectedEventTypes.length ? `AND 'driver_application' IN (${sqlList(selectedEventTypes)})` : ""}
        ${statusFilter ? `
          AND (
            CASE
              WHEN LOWER(a.status) = 'accepted' THEN 'success'
              WHEN LOWER(a.status) = 'rejected' THEN 'failure'
              ELSE 'pending'
            END
          ) = ?
        ` : ""}
        ${appSponsorScope}
        ${fromDate ? `AND COALESCE(a.reviewed_at, a.created_at) >= ?` : ""}
        ${toDate ? `AND COALESCE(a.reviewed_at, a.created_at) <= ?` : ""}
        ${searchFilter ? `AND (
          a.email LIKE ?
          OR CONCAT(COALESCE(a.first_name, ''), ' ', COALESCE(a.last_name, '')) LIKE ?
          OR COALESCE(a.rejection_reason, '') LIKE ?
        )` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (statusFilter) sourceParams.push(statusFilter);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like);
    }

    // ── ACCOUNT CREATED ───────────────────────────────────────
    const acctSponsorScope = sponsorFilter ? `AND u.sponsor = ?` : "";
    const acctUserScope = scopeUserId ? `AND u.id = ?` : "";

    sources.push(`
      SELECT
        CONCAT('account_', u.id) AS source_key,
        'account_created' AS event_type,
        'Account created' AS description,
        'success' AS status,
        u.sponsor AS sponsor_name,
        NULL AS ip_address,
        u.time_created AS created_at,
        NULL AS metadata,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
      FROM users u
      WHERE 1=1
        ${acctUserScope}
        ${selectedEventTypes.length ? `AND 'account_created' IN (${sqlList(selectedEventTypes)})` : ""}
        ${statusFilter ? `AND ? = 'success'` : ""}
        ${acctSponsorScope}
        ${fromDate ? `AND u.time_created >= ?` : ""}
        ${toDate ? `AND u.time_created <= ?` : ""}
        ${searchFilter ? `AND (
          u.email LIKE ?
          OR u.username LIKE ?
          OR CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) LIKE ?
        )` : ""}
    `);

    if (scopeUserId) sourceParams.push(scopeUserId);
    if (selectedEventTypes.length) sourceParams.push(...selectedEventTypes);
    if (statusFilter) sourceParams.push(statusFilter);
    if (sponsorFilter) sourceParams.push(sponsorFilter);
    if (fromDate) sourceParams.push(fromDate);
    if (toDate) sourceParams.push(toDate);
    if (searchFilter) {
      const like = `%${searchFilter}%`;
      sourceParams.push(like, like, like);
    }

    const sql = `
      SELECT *
      FROM (
        ${sources.join("\nUNION ALL\n")}
      ) AS audit_rows
      ORDER BY created_at DESC
    `;

    const [rows] = await pool.query(sql, sourceParams);

    const normalizedRows = rows.map(row => {
      const metadata =
        row.metadata && typeof row.metadata === "string"
          ? JSON.parse(row.metadata)
          : row.metadata || null;

      return {
        ...row,
        metadata
      };
    });

    const header = [
      "Date",
      "Event",
      "User Name",
      "User Email",
      "User Role",
      "Sponsor",
      "Description",
      "Status",
      "IP Address",
      "Points Spent",
      "Dollar Cost",
      "Shipping Method",
      "Product ID",
      "Application Status",
      "Rejection Reason"
    ];

    const csvRows = normalizedRows.map(row => [
      row.created_at ? new Date(row.created_at).toLocaleString("en-US") : "",
      row.event_type || "",
      row.user_name || "",
      row.user_email || "",
      row.user_role || "",
      row.sponsor_name || "",
      row.description || "",
      row.status || "",
      row.ip_address || "",
      row.metadata?.points_spent ?? "",
      row.metadata?.dollar_cost ?? "",
      row.metadata?.shipping_method ?? "",
      row.metadata?.product_id ?? "",
      row.metadata?.application_status ?? "",
      row.metadata?.rejection_reason ?? ""
    ]);

    const csv = [
      header.map(escapeCsv).join(","),
      ...csvRows.map(r => r.map(escapeCsv).join(","))
    ].join("\n");

    const filename = `audit-log-report-${Date.now()}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error("audit logs csv export error:", err);
    res.status(500).json({ error: "Could not generate CSV report." });
  }
});

//Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});