# Tier-access demo

Guest / Free / Trial / Pro permission demo with a real Stripe-billed $199
subscription: charge upfront, 7-day refund window, then a full pro month,
then normal monthly renewal.

## Set up Stripe (test mode)

1. **API key** - Dashboard -> Developers -> API keys -> create a **restricted
   key** (`rk_test_...`) with Write access to Checkout Sessions, Customers,
   Subscriptions, and Refunds, and Read access to Invoices. (Prefer this over
   the full secret key - a leaked restricted key can do far less damage.)
2. **Product + Price** - Product catalog -> Add product -> name it (e.g.
   "Pro Access") -> pricing model **Recurring**, $199.00 USD, billing period
   **Monthly**. Copy the resulting Price ID (`price_...`).
3. **Webhook** - for local dev, install the [Stripe CLI](https://docs.stripe.com/stripe-cli/install)
   and run `stripe listen --forward-to localhost:3000/webhook/stripe`; copy
   the `whsec_...` it prints. For production, add a real endpoint under
   Developers -> Webhooks pointed at `https://yourdomain.com/webhook/stripe`,
   subscribed to `checkout.session.completed`, `customer.subscription.deleted`,
   and `invoice.payment_failed`.
4. Copy `.env.example` to `.env` and fill in `STRIPE_SECRET_KEY`,
   `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`.

If you'll be charging customers in the US or EU, also look at
[Stripe Tax](https://docs.stripe.com/billing/taxes/collect-taxes.md) -
enabling `automatic_tax` alone doesn't collect anything until you have an
active tax registration.

## Run it

The frontend (`client/`, React + TypeScript + Tailwind, built with Vite)
compiles to static files in `public/`, which `server.js` serves as before.
`npm start` builds it automatically via a `prestart` hook.

```
npm install
npm start
```

In a second terminal (for webhooks to reach your local server):

```
stripe listen --forward-to localhost:3000/webhook/stripe
```

Open http://localhost:3000 — sign in as a guest (just browse `/dashboard.html`
without logging in), or register an account.

For frontend development with hot reload, run the backend and the Vite dev
server in separate terminals:

```
npm start          # backend on :3000
npm run dev         # Vite dev server on :5173, proxies API calls to :3000
```

Then work against http://localhost:5173.

## The tier logic

The backend is split into `app.js` (Express wiring), `config.js` (env/const
config), `lib/stripeClient.js` (Stripe SDK singleton), `middleware/`
(session auth), `services/access.js` (tier computation), `services/billing.js`
(Subscription Schedule logic), `routes/` (auth, billing, status endpoints),
and `webhooks/stripeWebhook.js` (the Stripe webhook handler). `server.js` is
just the entry point that starts listening.

- **Register** → account starts as `free` (public section only).
- **"Start 7-day trial – $199"** → creates a Stripe Checkout Session
  (subscription mode) and redirects to Stripe. On completion, the
  `checkout.session.completed` webhook charges $199 immediately, sets
  `tier = 'trial'`, `trialStart = now`, and pushes the subscription's
  `billing_cycle_anchor` out to 37 days from now with
  `proration_behavior: 'none'` - this is what makes cycle 1 last 7 days
  (refundable) + a full 30-day pro month, without billing again during that
  stretch. From cycle 2 onward, Stripe just renews normally every ~30 days.
- For the first 7 days → limited access (`public` + `trial` sections).
- After 7 days → automatically `pro` (all 3 sections), computed on every
  request from `trialStart` - no cron job needed. Stays `pro` indefinitely
  as long as the subscription is active and renewing.
- **"Request refund"** (within the 7-day window) → refunds the payment via
  the Stripe API and cancels the subscription immediately, reverting to
  `free`.
- **"Cancel subscription"** (after 7 days) → no refund, but cancels at
  period end so it won't renew; access continues through what was already
  paid for, then the `customer.subscription.deleted` webhook flips the
  account to `free`.
- **Invoices** section on the dashboard lists the user's Stripe invoices
  (`GET /api/invoices`), each linking to Stripe's hosted invoice page.

## Testing the 7-day flow quickly

```
TRIAL_LENGTH_MS=15000 FIRST_PERIOD_LENGTH_MS=30000 npm start
```

That gives a 15-second refund window and a 30-second first billing cycle, so
you can watch the dashboard flip trial → pro without waiting real days. Use
a [Stripe test card](https://docs.stripe.com/testing) like
`4242 4242 4242 4242` at checkout.

## Notes / things to swap out before this is real

- Users persist in a local SQLite file (`data.sqlite`, via `db.js`) with
  bcrypt-hashed passwords. Fine for a single-instance deploy; swap in a
  hosted database before running multiple server instances.
- Session secret in `server.js` falls back to a placeholder — set
  `SESSION_SECRET` in `.env` to a long random string.
- Store `STRIPE_SECRET_KEY` in a real secrets vault in production, not a
  committed `.env` file.
