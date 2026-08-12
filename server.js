require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const Stripe = require("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn(
    "STRIPE_SECRET_KEY is not set - copy .env.example to .env and fill it " +
      "in. The server will boot, but /subscribe, /refund and /api/invoices " +
      "will fail until it's configured.",
  );
}
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder");

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Stripe webhook - must see the raw request body to verify the signature, so
// it's registered before the global express.json() body parser below.
// ---------------------------------------------------------------------------
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          if (session.mode !== "subscription") break;

          const user = getUserById(Number(session.client_reference_id));
          if (!user) break;

          const subscriptionId = session.subscription;
          user.stripeCustomerId = session.customer;
          user.stripeSubscriptionId = subscriptionId;
          user.tier = "trial";
          user.trialStart = Date.now();

          // Push the next renewal out so cycle 1 covers the 7-day refund
          // window plus a full pro month, without charging again right now.
          const subscription =
            await stripe.subscriptions.retrieve(subscriptionId);
          const anchor =
            subscription.current_period_start +
            Math.round(FIRST_PERIOD_LENGTH_MS / 1000);
          await stripe.subscriptions.update(subscriptionId, {
            billing_cycle_anchor: anchor,
            proration_behavior: "none",
          });
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          const user = findUserBySubscriptionId(subscription.id);
          if (user) {
            user.tier = "free";
            user.trialStart = null;
          }
          break;
        }

        case "invoice.payment_failed": {
          console.warn(
            "Invoice payment failed for customer",
            event.data.object.customer,
          );
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error("Error handling webhook event", event.type, err);
    }

    res.json({ received: true });
  },
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  }),
);
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.redirect("/index.html"));

// ---------------------------------------------------------------------------
// In-memory "database". Restarting the server wipes all users - that's fine
// for this demo, but swap this out for a real store before shipping anything.
// ---------------------------------------------------------------------------
const users = {}; // keyed by username
let nextId = 1;

// Tier timing. Overridable via env vars so you can test the full flow
// without waiting real days - e.g.
//   TRIAL_LENGTH_MS=15000 FIRST_PERIOD_LENGTH_MS=30000 npm start
const TRIAL_LENGTH_MS =
  Number(process.env.TRIAL_LENGTH_MS) || 7 * 24 * 60 * 60 * 1000;
// 7-day refund window + a full 30-day pro month = 37 days for cycle 1 only.
// From cycle 2 onward, Stripe bills on its normal ~30-day cadence.
const FIRST_PERIOD_LENGTH_MS =
  Number(process.env.FIRST_PERIOD_LENGTH_MS) || 37 * 24 * 60 * 60 * 1000;

function getUserByUsername(username) {
  return users[username];
}

function getUserById(id) {
  return Object.values(users).find((u) => u.id === id);
}

function findUserBySubscriptionId(subscriptionId) {
  return Object.values(users).find(
    (u) => u.stripeSubscriptionId === subscriptionId,
  );
}

function randomLetters(count) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < count; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Resolves what a user (or guest) currently has access to.
 * tier is DISPLAYED tier - 'trial' silently becomes 'pro' once 7 days pass,
 * purely by elapsed time, with no separate billing event. The only thing
 * that forces a user back to 'free' is the customer.subscription.deleted
 * webhook (immediate cancel after a refund, or the subscription actually
 * ending after cancel_at_period_end / failed-payment exhaustion).
 */
function resolveAccess(user) {
  if (!user) {
    return { tier: "guest", sections: ["public"], msRemaining: null };
  }

  if (user.tier === "free" || !user.trialStart) {
    return { tier: "free", sections: ["public"], msRemaining: null };
  }

  const now = Date.now();
  const trialEndsAt = user.trialStart + TRIAL_LENGTH_MS;

  if (now < trialEndsAt) {
    return {
      tier: "trial",
      sections: ["public", "trial"],
      msRemaining: trialEndsAt - now,
    };
  }

  return {
    tier: "pro",
    sections: ["public", "trial", "pro"],
    msRemaining: null,
  };
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
    stripeCustomerId: null,
    stripeSubscriptionId: null,
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
// Payment flow (real Stripe)
// ---------------------------------------------------------------------------

// Starts checkout for the $199/month subscription. The webhook handler
// (checkout.session.completed) is what actually flips the user to 'trial'
// once Stripe confirms the charge - this route just creates the session.
app.post("/subscribe", requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);

  try {
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: user.username,
        metadata: { appUserId: String(user.id) },
      });
      user.stripeCustomerId = customer.id;
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId,
      client_reference_id: String(user.id),
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: {
        metadata: { appUserId: String(user.id) },
      },
      success_url: `${APP_URL}/dashboard.html?checkout=success`,
      cancel_url: `${APP_URL}/dashboard.html?checkout=cancelled`,
      integration_identifier: `tier-app-${randomLetters(8)}`,
    });

    res.json({ url: checkoutSession.url });
  } catch (err) {
    console.error("Failed to create checkout session:", err);
    res.status(500).json({ error: "Could not start checkout" });
  }
});

// Within the 7-day trial: full refund + cancel immediately (no renewal).
// After 7 days (pro): no refund, just cancel_at_period_end - access
// continues through the already-paid period, then lapses on its own.
app.post("/refund", requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);

  if (!user.stripeSubscriptionId) {
    return res.status(400).json({ error: "No active subscription" });
  }

  const access = resolveAccess(user);

  try {
    if (access.tier === "trial") {
      const subscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId,
        { expand: ["latest_invoice.payment_intent"] },
      );
      const paymentIntentId =
        subscription.latest_invoice?.payment_intent?.id;
      if (paymentIntentId) {
        await stripe.refunds.create({ payment_intent: paymentIntentId });
      }
      await stripe.subscriptions.cancel(user.stripeSubscriptionId);
      user.tier = "free";
      user.trialStart = null;
    } else {
      await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      // Tier flips to 'free' automatically via the
      // customer.subscription.deleted webhook once the period ends.
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Refund/cancel failed:", err);
    res.status(500).json({ error: "Could not process refund" });
  }
});

// ---------------------------------------------------------------------------
// Status + invoices
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

app.get("/api/invoices", requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user.stripeCustomerId) {
    return res.json([]);
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 12,
    });
    res.json(
      invoices.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        amountPaid: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        created: inv.created * 1000,
        hostedInvoiceUrl: inv.hosted_invoice_url,
        invoicePdf: inv.invoice_pdf,
      })),
    );
  } catch (err) {
    console.error("Failed to list invoices:", err);
    res.status(500).json({ error: "Could not load invoices" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
