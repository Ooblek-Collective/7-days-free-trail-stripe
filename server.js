const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: "demo-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  }),
);
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// In-memory "database". Restarting the server wipes all users - that's fine
// for this demo, but swap this out for a real store before shipping anything.
// ---------------------------------------------------------------------------
const users = {}; // keyed by username
let nextId = 1;

// Tier timing. In real life these come from Stripe subscription timestamps;
// here we just track trialStart and derive everything else from it.
// Overridable via env vars so you can test the full flow without waiting
// 7 real days - e.g. `TRIAL_LENGTH_MS=15000 PRO_LENGTH_MS=30000 npm start`
// gives you a 15-second trial and a 30-second total pro window.
const TRIAL_LENGTH_MS =
  Number(process.env.TRIAL_LENGTH_MS) || 7 * 24 * 60 * 60 * 1000;
const PRO_LENGTH_MS =
  Number(process.env.PRO_LENGTH_MS) || 30 * 24 * 60 * 60 * 1000;

function getUserByUsername(username) {
  return users[username];
}

function getUserById(id) {
  return Object.values(users).find((u) => u.id === id);
}

/**
 * Resolves what a user (or guest) currently has access to.
 * tier is the DISPLAYED tier - it can differ from the stored user.tier
 * because 'trial' silently becomes 'pro' once 7 days pass, without any
 * separate billing event.
 */
function resolveAccess(user) {
  if (!user) {
    return { tier: "guest", sections: ["public"], msRemaining: null };
  }

  if (user.tier === "free") {
    return { tier: "free", sections: ["public"], msRemaining: null };
  }

  // user.tier === 'trial' -> paid $199 at trialStart, not refunded since
  const now = Date.now();
  const trialEndsAt = user.trialStart + TRIAL_LENGTH_MS;
  const proEndsAt = user.trialStart + PRO_LENGTH_MS;

  if (now < trialEndsAt) {
    return {
      tier: "trial",
      sections: ["public", "trial"],
      msRemaining: trialEndsAt - now,
    };
  }

  if (now < proEndsAt) {
    return {
      tier: "pro",
      sections: ["public", "trial", "pro"],
      msRemaining: null,
    };
  }

  // 30-day window elapsed with no renewal modeled in this demo.
  // Real app: this is where the next Stripe invoice/webhook would fire.
  return { tier: "free", sections: ["public"], msRemaining: null };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  if (users[username]) {
    return res.status(409).json({ error: "That username is taken" });
  }

  users[username] = {
    id: nextId++,
    username,
    password, // plain text - demo only, never do this in a real app
    tier: "free",
    trialStart: null,
  };

  req.session.userId = users[username].id;
  res.json({ ok: true });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = getUserByUsername(username);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  req.session.userId = user.id;
  res.json({ ok: true });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------------------------------------------------------------------------
// Fake payment flow
// ---------------------------------------------------------------------------

// Starts the 7-day trial - simulates charging $199 immediately.
app.post("/subscribe", requireAuth, (req, res) => {
  const user = getUserById(req.session.userId);

  // Small artificial delay so the UI can show a "processing payment" state,
  // like it would while waiting on a real Stripe confirmation.
  setTimeout(() => {
    user.tier = "trial";
    user.trialStart = Date.now();
    res.json({ ok: true, charged: 199 });
  }, 700);
});

// Simulates a refund request - reverts the user straight back to free.
app.post("/refund", requireAuth, (req, res) => {
  const user = getUserById(req.session.userId);
  user.tier = "free";
  user.trialStart = null;
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Status endpoint the dashboard polls
// ---------------------------------------------------------------------------

app.get("/api/me", (req, res) => {
  const user = req.session.userId ? getUserById(req.session.userId) : null;
  const access = resolveAccess(user);
  res.json({
    loggedIn: !!user,
    username: user ? user.username : null,
    ...access,
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
