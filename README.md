# Tier-access demo

Guest / Free / Trial / Pro permission demo with a fake $199 trial payment.

## Run it

```
npm install
npm start
```

Open http://localhost:3000 — sign in as a guest (just browse `/dashboard.html`
without logging in), or register an account.

## The tier logic (server.js)

- **Register** → account starts as `free` (public section only).
- **"Start 7-day trial – $199"** on the dashboard → `POST /subscribe` fakes a
  charge and sets `tier = 'trial'`, `trialStart = now`.
- For the first 7 days → limited access (`public` + `trial` sections).
- After 7 days, with no refund → automatically becomes `pro` (all 3 sections)
  for the rest of the ~30-day period. This flip is computed on every request
  from `trialStart`, not stored as a separate state — no cron job needed.
- **"Refund"** at any point → `POST /refund` resets straight to `free`.

## Testing the 7-day flow quickly

Waiting 7 real days to see the trial→pro flip is impractical, so the trial
and pro window lengths are overridable via env vars:

```
TRIAL_LENGTH_MS=15000 PRO_LENGTH_MS=30000 npm start
```

That gives you a 15-second "trial" and a 30-second total pro window, so you
can watch the dashboard countdown hit zero and flip to Pro in real time.

## Notes / things to swap out before this is real

- Users are stored in memory (`server.js`, the `users` object) — restarting
  the server wipes everyone. Swap in a real database.
- Passwords are stored in plain text for simplicity — never do this outside
  a demo; use bcrypt or similar.
- `/subscribe` doesn't call Stripe — it's a fake charge as requested. Wiring
  it to real Stripe billing is a separate step (see our earlier discussion
  on `billing_cycle_anchor` / webhook-driven vs. app-logic-driven access).
- Session secret in `server.js` is a placeholder — replace it and load it
  from an environment variable.
