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
      const [clubs, signups] = await Promise.all([
        db.clubApplication.count(),
        db.signup.count()
      ]);
      out.database.reachable = true;
      out.database.tables = { clubApplications: clubs, signups };
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
