const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(path.join(__dirname, "data.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    trial_start INTEGER,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    pro_unlocked_early INTEGER NOT NULL DEFAULT 0
  )
`);

// Lightweight migration for databases created before a column existed.
const existingColumns = new Set(
  db.prepare(`PRAGMA table_info(users)`).all().map((col) => col.name),
);
if (!existingColumns.has("pro_unlocked_early")) {
  db.exec(
    `ALTER TABLE users ADD COLUMN pro_unlocked_early INTEGER NOT NULL DEFAULT 0`,
  );
}

const SELECT_USER = `
  SELECT
    id,
    username,
    password_hash AS passwordHash,
    tier,
    trial_start AS trialStart,
    stripe_customer_id AS stripeCustomerId,
    stripe_subscription_id AS stripeSubscriptionId,
    pro_unlocked_early AS proUnlockedEarly
  FROM users
`;

const getUserByUsernameStmt = db.prepare(`${SELECT_USER} WHERE username = ?`);
const getUserByIdStmt = db.prepare(`${SELECT_USER} WHERE id = ?`);
const findUserBySubscriptionIdStmt = db.prepare(
  `${SELECT_USER} WHERE stripe_subscription_id = ?`,
);
const insertUserStmt = db.prepare(
  `INSERT INTO users (username, password_hash) VALUES (?, ?)`,
);

// SQLite has no boolean type - better-sqlite3 returns/accepts 0/1 for it.
function normalize(row) {
  if (!row) return row;
  return { ...row, proUnlockedEarly: !!row.proUnlockedEarly };
}

function getUserByUsername(username) {
  return normalize(getUserByUsernameStmt.get(username));
}

function getUserById(id) {
  return normalize(getUserByIdStmt.get(id));
}

function findUserBySubscriptionId(subscriptionId) {
  return normalize(findUserBySubscriptionIdStmt.get(subscriptionId));
}

function createUser(username, passwordHash) {
  const info = insertUserStmt.run(username, passwordHash);
  return getUserById(info.lastInsertRowid);
}

// Maps the JS-side field name to its column, so callers can keep using the
// same camelCase names resolveAccess() and the webhook handlers already use.
const UPDATABLE_COLUMNS = {
  tier: "tier",
  trialStart: "trial_start",
  stripeCustomerId: "stripe_customer_id",
  stripeSubscriptionId: "stripe_subscription_id",
  proUnlockedEarly: "pro_unlocked_early",
};

function updateUser(id, patch) {
  const keys = Object.keys(patch).filter((key) => key in UPDATABLE_COLUMNS);
  if (keys.length === 0) return;

  const setClause = keys.map((key) => `${UPDATABLE_COLUMNS[key]} = ?`).join(", ");
  // better-sqlite3 only binds numbers/strings/bigints/buffers/null - coerce
  // JS booleans (e.g. proUnlockedEarly) to 0/1.
  const values = keys.map((key) =>
    typeof patch[key] === "boolean" ? Number(patch[key]) : patch[key],
  );
  db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values, id);
}

module.exports = {
  getUserByUsername,
  getUserById,
  findUserBySubscriptionId,
  createUser,
  updateUser,
};
