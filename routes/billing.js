const express = require("express");
const stripe = require("../lib/stripeClient");
const { APP_URL, STRIPE_PRICE_ID } = require("../config");
const { getUserById, updateUser } = require("../db");
const requireAuth = require("../middleware/requireAuth");
const { resolveAccess } = require("../services/access");
const {
  rescheduleForEarlyUpgrade,
  findPaymentIntentForRefund,
  scheduleCancellation,
} = require("../services/billing");

const router = express.Router();

// Starts checkout for the $199/month subscription. The webhook handler
// (checkout.session.completed) is what actually flips the user to 'trial'
// once Stripe confirms the charge - this route just creates the session.
router.post("/subscribe", requireAuth, async (req, res) => {
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
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
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
// This forfeits refund eligibility, same as if the 7 days had actually
// passed - see /refund below, which is keyed off the displayed tier.
router.post("/upgrade", requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);
  const access = resolveAccess(user);

  if (access.tier !== "trial") {
    return res
      .status(400)
      .json({ error: "Early upgrade is only available during your trial" });
  }

  try {
    await rescheduleForEarlyUpgrade(user.stripeSubscriptionId);
    updateUser(user.id, { proUnlockedEarly: true });
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to upgrade early:", err);
    res.status(500).json({ error: "Could not upgrade to Pro" });
  }
});

// Within the 7-day trial: full refund + cancel immediately (no renewal).
// Once displaying as Pro - whether by the 7 days actually passing or by an
// early upgrade - no refund, just a scheduled cancellation: access
// continues through the already-paid period, then lapses on its own.
router.post("/refund", requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);

  if (!user.stripeSubscriptionId) {
    return res.status(400).json({ error: "No active subscription" });
  }

  if (user.cancelAt) {
    return res
      .status(400)
      .json({ error: "Cancellation is already scheduled" });
  }

  const access = resolveAccess(user);

  try {
    if (access.tier === "trial") {
      const paymentIntentId = await findPaymentIntentForRefund(
        user.stripeSubscriptionId,
      );
      if (!paymentIntentId) {
        // Do NOT proceed to cancel without refunding - that would leave the
        // customer charged, unrefunded, and told it succeeded.
        throw new Error(
          `No payment_intent found for subscription ${user.stripeSubscriptionId} to refund`,
        );
      }
      await stripe.refunds.create({ payment_intent: paymentIntentId });
      await stripe.subscriptions.cancel(user.stripeSubscriptionId);
      updateUser(user.id, {
        tier: "free",
        trialStart: null,
        proUnlockedEarly: false,
        cancelAt: null,
      });
    } else {
      const cancelAt = await scheduleCancellation(user.stripeSubscriptionId);
      updateUser(user.id, { cancelAt });
      // Tier flips to 'free' automatically via the
      // customer.subscription.deleted webhook once the period ends.
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Refund/cancel failed:", err);
    res.status(500).json({ error: "Could not process refund" });
  }
});

module.exports = router;
