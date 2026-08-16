require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const Stripe = require("stripe");
const bcrypt = require("bcryptjs");
const {
  getUserByUsername,
  getUserById,
  findUserBySubscriptionId,
  createUser,
  updateUser,
} = require("./db");

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
          updateUser(user.id, {
            stripeCustomerId: session.customer,
            stripeSubscriptionId: subscriptionId,
            tier: "trial",
            trialStart: Date.now(),
          });

          // Push the next renewal out so cycle 1 covers the 7-day refund
          // window plus a full pro month, without charging again right now.
          // current_period_start lives on the subscription item, not the
          // subscription itself, as of API version 2026-07-29.dahlia, and
          // existing subscriptions can no longer have billing_cycle_anchor
          // set to an arbitrary date via a plain update (only 'now' or
          // 'unchanged') - rescheduling requires a subscription schedule.
          const subscription =
            await stripe.subscriptions.retrieve(subscriptionId);
          const anchor =
            subscription.items.data[0].current_period_start +
            Math.round(FIRST_PERIOD_LENGTH_MS / 1000);

          const schedule = await stripe.subscriptionSchedules.create({
            from_subscription: subscriptionId,
          });
          const items = schedule.phases[0].items.map((item) => ({
            price: item.price,
            quantity: item.quantity,
          }));
          await stripe.subscriptionSchedules.update(schedule.id, {
            end_behavior: "release",
            phases: [
              {
                items,
                start_date: schedule.phases[0].start_date,
                end_date: anchor,
                proration_behavior: "none",
              },
              {
                items,
                start_date: anchor,
                proration_behavior: "none",
              },
            ],
          });
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          const user = findUserBySubscriptionId(subscription.id);
          if (user) {
            updateUser(user.id, {
              tier: "free",
              trialStart: null,
              proUnlockedEarly: false,
            });
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

// Tier timing. Overridable via env vars so you can test the full flow
// without waiting real days - e.g.
//   TRIAL_LENGTH_MS=15000 FIRST_PERIOD_LENGTH_MS=30000 npm start
const TRIAL_LENGTH_MS =
  Number(process.env.TRIAL_LENGTH_MS) || 7 * 24 * 60 * 60 * 1000;
// 7-day refund window + a full 30-day pro month = 37 days for cycle 1 only.
// From cycle 2 onward, Stripe bills on its normal ~30-day cadence.
const FIRST_PERIOD_LENGTH_MS =
  Number(process.env.FIRST_PERIOD_LENGTH_MS) || 37 * 24 * 60 * 60 * 1000;

/**
 * Resolves what a user (or guest) currently has access to.
 * tier is DISPLAYED tier - 'trial' silently becomes 'pro' once 7 days pass,
 * purely by elapsed time, with no separate billing event, or immediately if
 * the user opted into an early upgrade (proUnlockedEarly). Either way the
 * only thing that forces a user back to 'free' is the
 * customer.subscription.deleted webhook (immediate cancel after a refund,
 * or the subscription actually ending after cancel_at_period_end /
 * failed-payment exhaustion).
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

  if (!user.proUnlockedEarly && now < trialEndsAt) {
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

app.post("/register", async (req, res) => {
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

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = getUserByUsername(username);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
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
      updateUser(user.id, { stripeCustomerId: customer.id });
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
    });

    res.json({ url: checkoutSession.url });
  } catch (err) {
    console.error("Failed to create checkout session:", err);
    res.status(500).json({ error: "Could not start checkout" });
  }
});

// Lets a trial user skip ahead to Pro instead of waiting out the 7 days.
// The unused trial days are forfeited - the subscription's billing schedule
// is rewound so the current phase ends right now, and a fresh normal Pro
// month starts counting immediately from this moment (so the next $199
// charge lands 30 days from the upgrade, not 37 days from signup). No extra
// charge happens for the transition itself (proration_behavior: "none").
// This also forfeits refund eligibility, same as if the 7 days had actually
// passed - see /refund below, which is keyed off the displayed tier.
app.post("/upgrade", requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);
  const access = resolveAccess(user);

  if (access.tier !== "trial") {
    return res
      .status(400)
      .json({ error: "Early upgrade is only available during your trial" });
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(
      user.stripeSubscriptionId,
    );
    if (!subscription.schedule) {
      throw new Error(
        `Subscription ${subscription.id} has no schedule to reschedule`,
      );
    }

    const schedule = await stripe.subscriptionSchedules.retrieve(
      subscription.schedule,
    );
    const items = schedule.phases[0].items.map((item) => ({
      price: item.price,
      quantity: item.quantity,
    }));
    const now = Math.floor(Date.now() / 1000);

    await stripe.subscriptionSchedules.update(subscription.schedule, {
      end_behavior: "release",
      phases: [
        {
          items,
          start_date: schedule.phases[0].start_date,
          end_date: now,
          proration_behavior: "none",
        },
        {
          items,
          start_date: now,
          proration_behavior: "none",
        },
      ],
    });

    updateUser(user.id, { proUnlockedEarly: true });
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to upgrade early:", err);
    res.status(500).json({ error: "Could not upgrade to Pro" });
  }
});

// Within the 7-day trial: full refund + cancel immediately (no renewal).
// Once displaying as Pro - whether by the 7 days actually passing or by an
// early upgrade - no refund, just cancel_at_period_end: access continues
// through the already-paid period, then lapses on its own.
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
      );
      // invoice.payment_intent no longer exists as of API version
      // 2026-07-29.dahlia - the payment now lives under payments.data[].
      const invoice = await stripe.invoices.retrieve(
        subscription.latest_invoice,
        { expand: ["payments.data.payment.payment_intent"] },
      );
      const paymentIntentId =
        invoice.payments?.data?.[0]?.payment?.payment_intent?.id;
      if (!paymentIntentId) {
        throw new Error(
          `No payment_intent found on invoice ${invoice.id} to refund`,
        );
      }
      await stripe.refunds.create({ payment_intent: paymentIntentId });
      await stripe.subscriptions.cancel(user.stripeSubscriptionId);
      updateUser(user.id, {
        tier: "free",
        trialStart: null,
        proUnlockedEarly: false,
      });
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
