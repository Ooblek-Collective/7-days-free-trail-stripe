const express = require("express");
const bcrypt = require("bcryptjs");
const { getUserByUsername, createUser } = require("../db");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  if (getUserByUsername(username)) {
    return res.status(409).json({ error: "That username is taken" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = createUser(username, passwordHash);

  req.session.userId = user.id;
  res.json({ ok: true });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = getUserByUsername(username);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  req.session.userId = user.id;
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
