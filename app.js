const express = require("express");
const session = require("express-session");
const path = require("path");
const { SESSION_SECRET } = require("./config");
const stripeWebhook = require("./webhooks/stripeWebhook");
const authRoutes = require("./routes/auth");
const billingRoutes = require("./routes/billing");
const statusRoutes = require("./routes/status");

const app = express();

// Must be mounted before express.json() below - the webhook route needs the
// raw, unparsed body to verify Stripe's signature.
app.use(stripeWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  }),
);
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.redirect("/index.html"));

app.use(authRoutes);
app.use(billingRoutes);
app.use(statusRoutes);

module.exports = app;
