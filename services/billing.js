const stripe = require("../lib/stripeClient");
const { FIRST_PERIOD_LENGTH_MS } = require("../config");

// Push the next renewal out so cycle 1 covers the 7-day refund window plus a
// full pro month, without charging again right now. current_period_start
// lives on the subscription item, not the subscription itself, as of API
// version 2026-07-29.dahlia, and existing subscriptions can no longer have
// billing_cycle_anchor set to an arbitrary date via a plain update (only
// 'now' or 'unchanged') - rescheduling requires a subscription schedule.
// Called from the checkout.session.completed webhook, right after trial
// fields are persisted for the user.
async function startFirstPeriodSchedule(subscriptionId) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
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
}

// Lets a trial user skip ahead to Pro instead of waiting out the 7 days.
// The unused trial days are forfeited - the subscription's billing schedule
// is rewound so the current phase ends right now, and a fresh normal Pro
// month starts counting immediately from this moment (so the next $199
// charge lands 30 days from the upgrade, not 37 days from signup). No extra
// charge happens for the transition itself (proration_behavior: "none").
async function rescheduleForEarlyUpgrade(subscriptionId) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
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
}

// invoice.payment_intent no longer exists as of API version
// 2026-07-29.dahlia - the payment now lives under payments.data[]. Returns
// null if no payment intent is found; callers must treat that as a hard
// error and abort rather than silently skipping the refund.
async function findPaymentIntentForRefund(subscriptionId) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const invoice = await stripe.invoices.retrieve(subscription.latest_invoice, {
    expand: ["payments.data.payment.payment_intent"],
  });
  return invoice.payments?.data?.[0]?.payment?.payment_intent?.id ?? null;
}

// Every subscription gets a Subscription Schedule attached at signup (see
// startFirstPeriodSchedule), and Stripe rejects setting cancel_at_period_end
// directly on a schedule-managed subscription ("update the schedule
// instead"). Flip the schedule's end_behavior so the current phase still
// runs to its natural end - no refund, access continues through what's
// already paid for - but once that phase completes the subscription
// cancels instead of renewing. Returns the resolved cancel_at, in ms.
async function scheduleCancellation(subscriptionId) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  if (subscription.schedule) {
    const schedule = await stripe.subscriptionSchedules.update(
      subscription.schedule,
      { end_behavior: "cancel" },
    );
    const lastPhase = schedule.phases[schedule.phases.length - 1];
    return lastPhase.end_date * 1000;
  }

  // Defensive fallback for a subscription that somehow never got a
  // schedule attached - shouldn't happen given startFirstPeriodSchedule,
  // but cheap to handle correctly.
  const updated = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
  return updated.items.data[0].current_period_end * 1000;
}

module.exports = {
  startFirstPeriodSchedule,
  rescheduleForEarlyUpgrade,
  findPaymentIntentForRefund,
  scheduleCancellation,
};
