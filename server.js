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
      const [rows] = await pool.query(
        `SELECT points
         FROM drivers
         WHERE user_id = ?
         LIMIT 1`,
        [me.id]
      );

      const points = rows.length ? Number(rows[0].points || 0) : 0;
      const userWithPoints = {
        ...me,
        points: points
      };

      return res.json(userWithPoints);
    }
    return res.json(me);

  } catch (err) {
    console.error("/api/me error:", err);
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
        u.sponsor
      FROM users u
      ${whereSql}
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

  //Prevent deleting self
  if (req.me.id === userId) {
    return res.status(400).json({ error: "You cannot delete your own account." });
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

    const role = rows[0].role;
    const table = roleTable(role);

    if (table) {
      await conn.query(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
    }

    await conn.query(`DELETE FROM users WHERE id = ?`, [userId]);

    await conn.commit();
    res.json({ ok: true, deleted: userId });
  } catch (err) {
    await conn.rollback();
    console.error("admin delete user error:", err);
    res.status(500).json({ error: "Could not delete user" });
  } finally {
    conn.release();
  }
});

// Getting data from the graph in week, month, year spans for each driver and average
app.get("/api/points", async (req, res) => { 
  const view = req.query.view;
  const driver = req.query.driver;
  let dateFormat;
  let groupBy;
  let dateFilter;

  // Date SQL code
  if (view === "year") {
    dateFormat = "%b";
    groupBy = "MONTH(created_at)";
    dateFilter = "YEAR(created_at) = YEAR(CURDATE())";
  } 
  else if (view === "month") {
    dateFormat = "%u";
    groupBy = "WEEK(created_at)";
    dateFilter = "MONTH(created_at) = MONTH(CURDATE())";
  } 
  else {
    dateFormat = "%a";
    groupBy = "DAY(created_at)";
    dateFilter = "YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)";
  }

  // Driver SQL code 
  let sql;
  let params = [];
  if (driver === "all") {
    sql = `
      SELECT 
        DATE_FORMAT(created_at, '${dateFormat}') AS label,
        AVG(points_after) AS value
      FROM driver_point_history
      WHERE ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY MIN(created_at)
    `;
  } 
  else {
    sql = `
      SELECT 
        DATE_FORMAT(created_at, '${dateFormat}') AS label,
        MAX(points_after) AS value
      FROM driver_point_history
      WHERE driver_id = ?
        AND ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY MIN(created_at)
    `;
    params.push(driver);
  }

  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } 
  catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/points/update", async (req, res) => {
  try {
    const { driverId, amount, reason } = req.body;

    if (!driverId || !amount) {
      return res.status(400).json({ error: "Missing data" });
    }

    // Using stored procedure call so it goes to the history table
    await pool.query(
      "CALL update_driver_points(?, ?, ?)",
      [driverId, amount, reason || "Sponsor Adjustment"]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Point update error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/sponsor/drivers", async (req, res) => {
  try {
    // Check that the user is logged in
    if (!req.session.user) {
      return res.status(401).json({ error: "Not logged in" });
    }

    // Need sponsor ID to find driver's under same sponsor
    const sponsorId = req.session.user.id;

    const [rows] = await pool.query(`
      SELECT 
        drivers.id AS driver_id,
        users.first_name,
        users.last_name,
        users.email,
        drivers.points
      FROM drivers
      JOIN users ON drivers.user_id = users.id
      JOIN users AS sponsorUser ON sponsorUser.sponsor = users.sponsor
      WHERE sponsorUser.id = ?
      AND users.role = 'Driver'
    `, [sponsorId]);

    res.json(rows);

  } catch (err) {
    console.error("SQL Connection Error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post('/api/recurring/start', async (req, res) => {
  const {amount, interval, targetType, targetIds, reason} = req.body;

  await pool.query(
    `INSERT INTO RecurringPoints 
     (points_amount, interval_type, target_type, target_ids, reason, is_active)
     VALUES (?, ?, ?, ?, ?, true)`,
    [
      amount,
      interval,
      targetType,
      targetType === 'specific' ? JSON.stringify(targetIds) : null,
      reason
    ]
  );

  res.sendStatus(200);
});

app.get("/api/recurring/active", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, points_amount, interval_type, target_type, target_ids
       FROM RecurringPoints
       WHERE is_active = true`
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post('/api/recurring/stop', async (req, res) => {
  const {id} = req.body;

  await pool.query(
    `UPDATE RecurringPoints SET is_active = false WHERE id = ?`,
    [id]
  );

  res.sendStatus(200);
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
  let drivers;
  if (rule.target_type === 'all') {
    const [rows] = await pool.query(`SELECT id FROM drivers`);
    drivers = rows;
  } 
  else {
    const ids = JSON.parse(rule.target_ids);
    if (!ids || ids.length === 0) return;

    const [rows] = await pool.query(
      `SELECT id FROM drivers WHERE id IN (?)`,
      [ids]
    );
    drivers = rows;
  }

  for (const driver of drivers) {
    await pool.query(
      `CALL update_driver_points(?, ?, ?)`,
      [
        driver.id,
        rule.points_amount,
        rule.reason 
      ]
    );
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

app.post("/api/orders/checkout", requireLogin, async (req, res) => {
  const me = req.session.user;

  if (me.role !== "Driver") {
    return res.status(403).json({ error: "Drivers only" });
  }

  const { items, shipping_method, shipping_point_cost, shipping_dollar_cost } = req.body || {};

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
      `SELECT id, points
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
    const currentPoints = Number(driverRows[0].points || 0);

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
              (group_id, user_id, product_id, point_cost, dollar_cost, shipping_method, expected_delivery_date, date_ordered)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            groupId,
            me.id,
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
      `UPDATE drivers
       SET points = points - ?
       WHERE user_id = ?`,
      [totalPointCost, me.id]
    );

    await conn.query(
      `INSERT INTO driver_point_history
         (driver_id, points_change, points_before, points_after, reason, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [
        driverId,
        -totalPointCost,
        currentPoints,
        currentPoints - totalPointCost,
        `Catalog checkout (${shipping_method}, shipping ${cleanShippingPointCost} pts)`
      ]
    );

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

//Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});