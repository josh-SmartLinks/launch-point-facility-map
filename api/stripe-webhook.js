// Stripe webhook: the authoritative record of who actually paid.
//
// The browser redirect after checkout is a hint, not proof — a player can close
// the tab, and anyone can type ?status=success. This endpoint is what marks a
// signup paid, because Stripe calls it server-to-server with a signature.
//
// Point a Stripe webhook at https://<domain>/api/stripe-webhook for the
// checkout.session.completed and checkout.session.expired events, then put the
// signing secret in STRIPE_WEBHOOK_SECRET.

const Stripe = require("stripe");
const { getDb } = require("../lib/db");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!key || !webhookSecret) {
    console.error("Webhook hit but Stripe env vars are missing.");
    return res.status(503).json({ error: "Not configured" });
  }

  let event;
  try {
    const stripe = new Stripe(key);
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, req.headers["stripe-signature"], webhookSecret);
  } catch (err) {
    // A bad signature means it did not come from Stripe. Reject it.
    console.error("Webhook signature check failed:", err && err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  const db = getDb();
  if (!db) {
    // Nothing to write to, but tell Stripe we got it so it stops retrying.
    console.error("Webhook received with no database configured:", event.type);
    return res.status(200).json({ received: true, stored: false });
  }

  try {
    const session = event.data.object;

    if (event.type === "checkout.session.completed") {
      const m = session.metadata || {};

      // upsert, not update: if the pending row never got written (database
      // was down at checkout), the paid signup still lands.
      await db.signup.upsert({
        where: { stripeSessionId: session.id },
        create: {
          stripeSessionId: session.id,
          paymentIntentId: session.payment_intent || null,
          status: "paid",
          paidAt: new Date(),
          club: m.club || "Unknown",
          platform: m.platform || "",
          tour: m.tour || "",
          playerName: m.player || "",
          email: session.customer_email || "",
          phone: m.phone || "",
          buyInCents: Number(m.buy_in_cents || 0),
          feeCents: Number(m.fee_cents || 0),
          totalCents: session.amount_total || 0
        },
        update: {
          status: "paid",
          paidAt: new Date(),
          paymentIntentId: session.payment_intent || null,
          totalCents: session.amount_total || 0
        }
      });
    } else if (event.type === "checkout.session.expired") {
      await db.signup.updateMany({
        where: { stripeSessionId: session.id, status: "pending" },
        data: { status: "expired" }
      });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    // A 500 makes Stripe retry, which is what we want for a transient
    // database problem.
    console.error("Webhook handling failed:", err && err.message);
    return res.status(500).json({ error: "Handler failed" });
  }
}

module.exports = handler;

// Signature verification needs the exact bytes Stripe signed, so the parsed
// body is no good here. This must be attached after the handler assignment —
// assigning module.exports afterwards would drop it.
module.exports.config = {
  api: { bodyParser: false }
};
