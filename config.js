require("dotenv").config();

const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-me";

// Tier timing. Overridable via env vars so you can test the full flow
// without waiting real days - e.g.
//   TRIAL_LENGTH_MS=15000 FIRST_PERIOD_LENGTH_MS=30000 npm start
const TRIAL_LENGTH_MS =
  Number(process.env.TRIAL_LENGTH_MS) || 7 * 24 * 60 * 60 * 1000;
// 7-day refund window + a full 30-day pro month = 37 days for cycle 1 only.
// From cycle 2 onward, Stripe bills on its normal ~30-day cadence.
const FIRST_PERIOD_LENGTH_MS =
  Number(process.env.FIRST_PERIOD_LENGTH_MS) || 37 * 24 * 60 * 60 * 1000;

module.exports = {
  PORT,
  APP_URL,
  SESSION_SECRET,
  TRIAL_LENGTH_MS,
  FIRST_PERIOD_LENGTH_MS,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
};
