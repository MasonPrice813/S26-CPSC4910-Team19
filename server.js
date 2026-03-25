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

    if (!driverId || amount === undefined) {
      return res.status(400).json({ error: "Missing data" });
    }

    const [[driver]] = await pool.query(
      `SELECT d.id, d.points, u.sponsor
       FROM drivers d
       JOIN users u ON d.user_id = u.id
       WHERE d.id = ?
       LIMIT 1`,
      [driverId]
    );

    if (!driver) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const [[settings]] = await pool.query(
      `SELECT allow_negative
       FROM sponsor_settings
       WHERE sponsor = ?
       LIMIT 1`,
      [driver.sponsor]
    );

    const allowNegative = settings ? !!settings.allow_negative : false;
    const newPoints = Number(driver.points || 0) + Number(amount);

    if (!allowNegative && newPoints < 0) {
      return res.status(400).json({
        error: "This sponsor does not allow negative point balances."
      });
    }

    await pool.query(
      `CALL update_driver_points(?, ?, ?)`,
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
    if (!req.session.user) {
      return res.status(401).json({ error: "Not logged in" });
    }

    const sponsorId = req.session.user.id;

    const [rows] = await pool.query(`
      SELECT 
        drivers.id AS driver_id,
        users.id AS user_id,
        users.first_name,
        users.last_name,
        users.email,
        users.sponsor,
        drivers.points
      FROM drivers
      JOIN users ON drivers.user_id = users.id
      JOIN users AS sponsorUser ON sponsorUser.sponsor = users.sponsor
      WHERE sponsorUser.id = ?
        AND users.role = 'Driver'
      ORDER BY users.last_name ASC, users.first_name ASC
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
    const sponsor = me.sponsor || null;

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
        u.sponsor
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE u.sponsor = ?
        AND u.role = 'Driver'
    `;

    const params = [sponsor];

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
        u.sponsor
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE u.role = 'Driver'
    `;

    const params = [];

    if (sponsor) {
      query += ` AND u.sponsor = ?`;
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
      SELECT DISTINCT sponsor
      FROM users
      WHERE sponsor IS NOT NULL
        AND sponsor <> ''
      ORDER BY sponsor ASC
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
      SELECT id AS user_id, first_name, last_name, sponsor
      FROM users
      WHERE role = 'Driver'
    `;
    const params = [];

    if (sponsor) {
      query += ` AND sponsor = ?`;
      params.push(sponsor);
    }

    query += ` ORDER BY last_name ASC, first_name ASC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('admin drivers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
app.get("/api/sponsor/settings", requireSponsor, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT points_criteria, allow_negative
       FROM sponsor_settings
       WHERE sponsor = ?
       LIMIT 1`,
      [req.me.sponsor]
    );

    if (!rows.length) {
      return res.json({
        pointsCriteria: "",
        allowNegative: false
      });
    }

    res.json({
      pointsCriteria: rows[0].points_criteria || "",
      allowNegative: !!rows[0].allow_negative
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

    await pool.query(
      `INSERT INTO sponsor_settings (sponsor, points_criteria, allow_negative)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         points_criteria = VALUES(points_criteria),
         allow_negative = VALUES(allow_negative)`,
      [req.me.sponsor, pointsCriteria, allowNegative]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("sponsor settings save error:", err);
    res.status(500).json({ error: "Database error" });
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

//Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});