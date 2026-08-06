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
const { TOUR_LABELS, PLATFORM_LABELS } = require("../lib/pricing");
const { resolveTeams } = require("../lib/teams");
const email = require("../lib/email");

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

  // Storage and email are independent: a deployment with only one of them
  // configured should still do that one thing.
  const db = getDb();
  const session = event.data.object;

  try {
    if (event.type === "checkout.session.completed") {
      const m = session.metadata || {};

      // Stripe reports the address under customer_details on a completed
      // session and commonly leaves customer_email null, so checking only the
      // latter meant the confirmation had no recipient and was dropped.
      const recipient =
        (session.customer_details && session.customer_details.email) ||
        session.customer_email ||
        m.email ||
        "";

      const signup = {
        club: m.club || "Unknown",
        platform: m.platform || "",
        platformLabel: PLATFORM_LABELS[m.platform] || m.platform || "",
        tour: m.tour || "",
        tourLabel: TOUR_LABELS[m.tour] || m.tour || "",
        playerName: m.player || "",
        email: recipient,
        phone: m.phone || "",
        partnerPhone: m.partner_phone || null,
        buyInCents: Number(m.buy_in_cents || 0),
        feeCents: Number(m.fee_cents || 0),
        totalCents: session.amount_total || 0
      };

      // The write gets its own catch. Sharing one with the email meant any
      // database error — a missing column after a schema change, a dropped
      // connection — skipped the confirmation entirely, which is the opposite
      // of the independence this handler is supposed to have.
      let stored = false;
      if (db) {
        try {
        // upsert, not update: if the pending row never got written (database
        // was down at checkout), the paid signup still lands.
        await db.signup.upsert({
          where: { stripeSessionId: session.id },
          create: Object.assign(
            {
              stripeSessionId: session.id,
              paymentIntentId: session.payment_intent || null,
              status: "paid",
              paidAt: new Date()
            },
            {
              club: signup.club,
              platform: signup.platform,
              tour: signup.tour,
              playerName: signup.playerName,
              email: signup.email,
              phone: signup.phone,
              partnerPhone: signup.partnerPhone,
              buyInCents: signup.buyInCents,
              feeCents: signup.feeCents,
              totalCents: signup.totalCents
            }
          ),
          update: {
            status: "paid",
            paidAt: new Date(),
            paymentIntentId: session.payment_intent || null,
            totalCents: signup.totalCents,
            // Kept in step in case the pending row predates the field.
            partnerPhone: signup.partnerPhone
          }
        });
        stored = true;
        } catch (dbErr) {
          // Loud, because the payment happened and the roster now disagrees
          // with Stripe. Stripe stays the source of truth until it is fixed.
          console.error(
            "PAYMENT NOT RECORDED for session", session.id,
            "player:", signup.playerName,
            "email:", signup.email,
            "error:", dbErr && dbErr.message
          );
        }
      } else {
        console.error("Paid signup received with no database configured:", session.id);
      }

      // Work out whether this payment completes a pair, so the confirmation
      // can say so and both players hear about it at the same moment.
      let partner = null;
      if (db) {
        try {
          const sameTour = await db.signup.findMany({
            where: { tour: signup.tour, status: "paid", archived: false }
          });
          const teams = resolveTeams(sameTour);
          const me = sameTour.filter((r) => r.stripeSessionId === session.id)[0];
          const mine = me ? teams[me.id] : null;

          if (mine && (mine.status === "matched" || mine.status === "overridden")) {
            partner = mine.partner;
            signup.partnerName = partner ? partner.playerName : null;
          }
        } catch (pairErr) {
          console.error("Could not resolve pairing:", pairErr && pairErr.message);
        }
      }

      // The player has already paid, so email problems get logged, never
      // thrown — a rejected send must not trigger a Stripe retry.
      if (email.isConfigured()) {
        const confirmation = email.playerConfirmation(signup);
        const sent = await email.send({
          to: signup.email,
          subject: confirmation.subject,
          html: confirmation.html,
          replyTo: process.env.ADMIN_EMAIL
        });

        if (!sent.sent) {
          console.error(
            "Confirmation not sent for", session.id,
            "recipient:", JSON.stringify(signup.email),
            "reason:", sent.reason,
            sent.detail || ""
          );
        }

        // A pairing is only confirmed when the second player pays, so this
        // fires once and tells both of them.
        if (partner) {
          const toNew = email.partnerPaired(signup, partner);
          await email.send({
            to: signup.email,
            subject: toNew.subject,
            html: toNew.html,
            replyTo: process.env.ADMIN_EMAIL
          });

          if (partner.email) {
            const toExisting = email.partnerPaired(
              { tour: partner.tour, tourLabel: TOUR_LABELS[partner.tour] || partner.tour },
              { playerName: signup.playerName, phone: signup.phone, email: signup.email }
            );
            await email.send({
              to: partner.email,
              subject: toExisting.subject,
              html: toExisting.html,
              replyTo: process.env.ADMIN_EMAIL
            });
          }
        }

        if (process.env.ADMIN_EMAIL) {
          const notice = email.adminNotification(signup);
          await email.send({
            to: process.env.ADMIN_EMAIL,
            subject: notice.subject,
            html: notice.html,
            replyTo: signup.email
          });
        }
      }
    } else if (event.type === "checkout.session.expired" && db) {
      await db.signup.updateMany({
        where: { stripeSessionId: session.id, status: "pending" },
        data: { status: "expired" }
      });
    }

    return res.status(200).json({ received: true, stored: typeof stored === "undefined" ? null : stored });
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
