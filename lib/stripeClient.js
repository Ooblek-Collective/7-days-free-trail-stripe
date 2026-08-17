const Stripe = require("stripe");
const { STRIPE_SECRET_KEY } = require("../config");

if (!STRIPE_SECRET_KEY) {
  console.warn(
    "STRIPE_SECRET_KEY is not set - copy .env.example to .env and fill it " +
      "in. The server will boot, but /subscribe, /refund and /api/invoices " +
      "will fail until it's configured.",
  );
}

module.exports = Stripe(STRIPE_SECRET_KEY || "sk_test_placeholder");
