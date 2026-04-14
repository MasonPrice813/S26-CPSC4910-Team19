async function parseBulkFile(fileContent, userRole, userOrg, pool) {
  const lines = fileContent.split(/\r?\n/);
  const results = [];
  const errors = [];
  const organizations = new Set(
    (await getSponsors(pool)).map(o => o.trim())
  );
  if (!isPipeDelimited(lines)) {
    return {
      results: [],
      errors: [{ lineNumber: 0, error: "File must be pipe '|' delimited" }]
    };
  }

  // Load users once
  const userMap = await loadUsers(pool);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!line.trim()) return;

    const parsed = parseLine(line);

    const validationError = validateLine(parsed, lineNumber);
    if (validationError) {
      errors.push(validationError);
      return;
    }

    const result = processLine({
      parsed,
      lineNumber,
      userRole,
      userOrg,
      userMap,
      organizations,
      errors
    });

    if (result) results.push(result);
  });
  return { results, errors };
}

// File check
function isPipeDelimited(lines) {
  const sample = lines.find(l => l.trim());
  return sample ? sample.includes("|") : true;
}

// Load users
async function loadUsers(pool) {
  const [users] = await pool.query(
    "SELECT id, email, role, first_name, last_name, sponsor FROM users"
  );

  const map = new Map();
  users.forEach(u => map.set(u.email.toLowerCase(), u));
  return map;
}
async function getSponsors(pool) {
  const [rows] = await pool.query(
    "SELECT DISTINCT sponsor FROM users WHERE sponsor IS NOT NULL AND sponsor != ''"
  );

  return rows.map(r => r.sponsor);
}

// Parse the file line
function parseLine(line) {
  const parts = line.split("|").map(p => p?.trim());

  return {
    type: parts[0],
    orgName: parts[1],
    firstName: parts[2],
    lastName: parts[3],
    email: parts[4],
    points: parts[5],
    reason: parts[6]
  };
}

// Validation of file line
function validateLine(data, lineNumber) {
  const { type, firstName, lastName, email, points, reason } = data;

  if (!["O", "D", "S"].includes(type)) {
    return err(lineNumber, `Invalid type '${type}'`);
  }

  if (isUserType(type)) {
    const missing = getMissingFields({ firstName, lastName, email });
    if (missing) return err(lineNumber, `Missing ${missing}`);
  }

  if (points) {
    if (!reason) return err(lineNumber, "Points provided without reason");
    if (isNaN(Number(points))) return err(lineNumber, "Points must be a number");
  }

  return null;
}
function isUserType(type) {
  return type === "D" || type === "S";
}

function getMissingFields({ firstName, lastName, email }) {
  if (!firstName?.trim()) return "first name";
  if (!lastName?.trim()) return "last name";
  if (!email?.trim()) return "email";
  return null;
}

// Processing Logic and Rules
function processLine(ctx) {
  const { parsed, lineNumber, userMap } = ctx;
  const existingUser = getExistingUser(parsed.email, userMap);

  if (existingUser) {
    return handleExistingUser(ctx, existingUser);
  }

  return handleNewUser(ctx);
}
function handleExistingUser(ctx, user) {
  const { parsed, lineNumber } = ctx;
  const { type, firstName, lastName, points, reason } = parsed;

  if (user.role === "Admin") {
    return fail(ctx, lineNumber, "Cannot modify admin users");
  }

  if (type === "S" && points) {
    return fail(ctx, lineNumber, "Points cannot be assigned to sponsor users");
  }

  if (isNameChanged(user, firstName, lastName)) {
    return fail(ctx, lineNumber, "Cannot modify existing user's name");
  }

  if (isRoleChanged(user, type)) {
    return fail(ctx, lineNumber, "Cannot change user role");
  }

  return {
    type,
    email: parsed.email,
    org: user.sponsor,
    action: "update_points",
    driverId: user.id, 
    points: points ? Number(points) : 0,
    reason: points ? reason : null
  };
}

function handleNewUser(ctx) {
  const { parsed, userRole, userOrg, organizations, lineNumber } = ctx;
  const { type, orgName, points, reason } = parsed;

  if (userRole === "Sponsor") {
    return handleSponsor(ctx);
  }

  if (userRole === "Admin") {
    return handleAdmin(ctx);
  }
}

function handleSponsor(ctx) {
  const { parsed, userOrg, lineNumber } = ctx;
  const { type, orgName, points, reason } = parsed;

  if (type === "O") {
    return fail(ctx, lineNumber, "Sponsors cannot create organizations");
  }

  if (orgName?.trim()) {
    return fail(ctx, lineNumber, "Organization must be empty for sponsors");
  }

  if (type === "S" && points) {
    return fail(ctx, lineNumber, "Points cannot be assigned to sponsor users");
  }

  return buildCreate(parsed, userOrg);
}

function handleAdmin(ctx) {
  const { parsed, organizations, lineNumber } = ctx;
  const { type, orgName } = parsed;

  if (type === "O") {
    if (!orgName?.trim()) {
      return fail(ctx, lineNumber, "Organization name required");
    }

    organizations.add(orgName.trim());
    return { type, org: orgName, action: "create_org" };
  }

  if (!orgName?.trim()) {
    return fail(ctx, lineNumber, "Organization required");
  }

  const normalizedOrg = orgName?.trim();

  if (!organizations.has(normalizedOrg)) {
    return fail(ctx, lineNumber, "Organization not created yet");
  }

  if (type === "S" && points) {
    return fail(ctx, lineNumber, "Points cannot be assigned to sponsor users");
  }

  return buildCreate(parsed, orgName);
}

function getExistingUser(email, userMap) {
  return email ? userMap.get(email.toLowerCase()) : null;
}

function isNameChanged(user, firstName, lastName) {
  return user.first_name !== firstName || user.last_name !== lastName;
}

function isRoleChanged(user, type) {
  return (
    (type === "D" && user.role !== "Driver") ||
    (type === "S" && user.role !== "Sponsor")
  );
}

function buildCreate(parsed, org) {
  const { type, firstName, lastName, email, points, reason } = parsed;

  return {
    type,
    org,
    firstName,
    lastName,
    email,
    action: "create",
    points: points ? Number(points) : null,
    reason: points ? reason : null
  };
}

function fail(ctx, lineNumber, message) {
  ctx.errors.push(err(lineNumber, message));
  return null;
}

function err(lineNumber, message) {
  return { lineNumber, error: message };
}
module.exports = { parseBulkFile };