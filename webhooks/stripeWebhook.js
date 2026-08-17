const express = require("express");
const stripe = require("../lib/stripeClient");
const { STRIPE_WEBHOOK_SECRET } = require("../config");
const {
  getUserById,
  findUserBySubscriptionId,
  updateUser,
} = require("../db");
const { startFirstPeriodSchedule } = require("../services/billing");

const router = express.Router();

// Must see the raw request body to verify the signature, so this router is
// mounted before the global express.json() body parser in app.js.
router.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET,
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

          await startFirstPeriodSchedule(subscriptionId);
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
              cancelAt: null,
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

module.exports = router;
