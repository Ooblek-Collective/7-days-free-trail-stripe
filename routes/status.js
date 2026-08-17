const express = require("express");
const stripe = require("../lib/stripeClient");
const { getUserById } = require("../db");
const requireAuth = require("../middleware/requireAuth");
const { resolveAccess } = require("../services/access");

const router = express.Router();

router.get("/api/me", (req, res) => {
  const user = req.session.userId ? getUserById(req.session.userId) : null;
  const access = resolveAccess(user);
  res.json({
    loggedIn: !!user,
    username: user ? user.username : null,
    ...access,
    cancelAt: user ? user.cancelAt : null,
  });
});

router.get("/api/invoices", requireAuth, async (req, res) => {
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

module.exports = router;
