const { TRIAL_LENGTH_MS } = require("../config");

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

module.exports = { resolveAccess };
