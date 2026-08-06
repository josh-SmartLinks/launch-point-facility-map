// Admin-only health check: says which integrations are actually working, and
// when one is not, what the provider said. Silent best-effort failures are the
// right behaviour at checkout but useless for debugging, so this surfaces them
// on demand.
//
// POST { testEmail: true } also sends a real message to ADMIN_EMAIL and
// reports Resend's response verbatim.

const auth = require("../../lib/auth");
const { getDb } = require("../../lib/db");
const email = require("../../lib/email");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!auth.requireAdmin(req, res)) return;

  const out = {
    stripe: {
      keyPresent: Boolean(process.env.STRIPE_SECRET_KEY),
      mode: process.env.STRIPE_SECRET_KEY
        ? process.env.STRIPE_SECRET_KEY.startsWith("sk_live_")
          ? "live"
          : "test"
        : null,
      webhookSecretPresent: Boolean(process.env.STRIPE_WEBHOOK_SECRET)
    },
    email: {
      apiKeyPresent: Boolean(process.env.RESEND_API_KEY),
      adminEmail: process.env.ADMIN_EMAIL || null,
      // Read from the sender itself, so this can never drift from what is
      // actually used on the wire.
      from: email.fromAddress(),
      fromSource: process.env.EMAIL_FROM ? "EMAIL_FROM" : "ADMIN_EMAIL"
    },
    database: { urlPresent: Boolean(process.env.DATABASE_URL), reachable: false, tables: null }
  };

  // Does the schema actually exist? A missing table is the usual reason
  // writes vanish, and it looks identical to "no submissions yet".
  const db = getDb();
  if (db) {
    try {
      const [clubs, signups, rows] = await Promise.all([
        db.clubApplication.count(),
        db.signup.count(),
        db.signup.findMany({ select: { status: true, paidAt: true }, orderBy: { createdAt: "desc" }, take: 200 })
      ]);
      out.database.reachable = true;
      out.database.tables = { clubApplications: clubs, signups };

      // A pile of pending rows with nothing paid means Stripe's webhook is not
      // reaching this deployment, which is invisible from the tables alone.
      const byStatus = {};
      rows.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
      out.database.signupsByStatus = byStatus;

      const paid = rows.filter((r) => r.paidAt);
      // Recent hits, so "no email" can be told apart from "Stripe never called".
      let recent = [];
      try {
        recent = await db.webhookEvent.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
      } catch (logErr) {
        recent = [{ note: "webhook log unavailable: " + (logErr && logErr.message) }];
      }

      out.webhook = {
        recentDeliveries: recent,
        confirmedPayments: paid.length,
        lastConfirmedAt: paid.length ? paid[0].paidAt : null,
        note: !paid.length && rows.length
          ? "Signups exist but none are confirmed paid. If recentDeliveries is empty, Stripe is not calling this endpoint at all: check the webhook destination is in the same mode as the API key. If it shows rejected, the signing secret is from the other mode."
          : undefined
      };
    } catch (err) {
      out.database.error = (err && err.message ? err.message : String(err)).slice(0, 300);
    }
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  if (req.method === "POST" && body.testEmail) {
    if (!process.env.ADMIN_EMAIL) {
      out.email.test = { sent: false, reason: "ADMIN_EMAIL is not set" };
    } else {
      // Send the real confirmation template with sample data, so the preview
      // shows exactly what a player receives rather than a stub.
      const sample = {
        club: "Launch Point",
        platform: "sgt",
        platformLabel: "SGT / GSPro",
        tour: "fall",
        tourLabel: "Fall Tour 2026",
        playerName: "Sample Player",
        email: process.env.ADMIN_EMAIL,
        phone: "555-555-5555",
        buyInCents: 6000,
        feeCents: 211,
        totalCents: 6211
      };

      const preview = email.playerConfirmation(sample);
      let result = await email.send({
        to: process.env.ADMIN_EMAIL,
        subject: "[Preview] " + preview.subject,
        html: preview.html
      });

      // An unverified domain should not stop a preview: Resend's shared sender
      // delivers to the account's own address without verification.
      if (!result.sent && result.status === 403) {
        const retry = await email.send({
          to: process.env.ADMIN_EMAIL,
          subject: "[Preview] " + preview.subject,
          html: preview.html,
          from: email.FALLBACK_FROM
        });
        result = Object.assign({}, retry, {
          usedFallbackSender: true,
          note:
            "Your domain is not verified, so this preview was sent from " +
            email.FALLBACK_FROM +
            ". That sender only reaches your own Resend account address, so real " +
            "player confirmations still need the domain verified."
        });
      }

      out.email.test = result;
    }
  }

  return res.status(200).json(out);
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}
