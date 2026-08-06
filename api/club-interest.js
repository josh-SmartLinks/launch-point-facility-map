// Club interest form. Free, no payment, so no Stripe involvement at all.
//
// Stores the submission when a database is configured and emails a copy when
// Resend is. With neither configured it still returns success rather than
// losing the lead silently — the error log is the fallback record.

const { getDb } = require("../lib/db");
const email = require("../lib/email");

const INTEREST = {
  yes: "Yes",
  maybe: "Maybe, tell me more",
  not_now: "Not right now"
};

// A launch monitor that is not Trackman feeds GSPro, which is what SGT runs on.
function guessPlatform(launchMonitor) {
  const s = String(launchMonitor || "").toLowerCase();
  if (!s) return null;
  if (s.indexOf("trackman") !== -1) return "trackman";
  return "sgt";
}

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  // Honeypot: a real person never fills a hidden field. Accept it so the bot
  // sees success and moves on, but store nothing.
  if (clean(body.website, 100)) {
    return res.status(200).json({ ok: true });
  }

  const facility = clean(body.facility, 120);
  const contactName = clean(body.contactName, 80);
  const emailAddress = clean(body.email, 200);
  const phone = clean(body.phone, 30);
  const city = clean(body.city, 120);
  const launchMonitor = clean(body.launchMonitor, 120);
  const interest = clean(body.interest, 20);
  const notes = clean(body.notes, 2000);

  if (!facility) return res.status(400).json({ error: "Enter your facility name." });
  if (!contactName) return res.status(400).json({ error: "Enter your name." });
  if (!isEmail(emailAddress)) return res.status(400).json({ error: "Enter a valid email." });
  if ((phone.match(/\d/g) || []).length < 10) {
    return res.status(400).json({ error: "Enter a phone number we can reach you at." });
  }
  if (!city) return res.status(400).json({ error: "Enter your city, state, and country." });
  if (!launchMonitor) return res.status(400).json({ error: "Tell us which launch monitor you use." });
  if (!INTEREST[interest]) return res.status(400).json({ error: "Pick one of the interest options." });

  const platform = guessPlatform(launchMonitor);

  const db = getDb();
  if (db) {
    try {
      await db.clubApplication.create({
        data: {
          facility,
          contactName,
          email: emailAddress,
          phone,
          city,
          launchMonitor,
          interest,
          notes: notes || null,
          platform
        }
      });
    } catch (dbErr) {
      console.error("Could not store club interest:", dbErr && dbErr.message);
    }
  }

  // Logged either way, so a submission is never lost to a misconfigured
  // database or mail provider.
  console.log(
    "Club interest:",
    JSON.stringify({ facility, contactName, email: emailAddress, phone, city, launchMonitor, interest })
  );

  // Confirmation to the club, so a submission is never a shot into the dark.
  if (email.isConfigured()) {
    const confirmation = email.clubConfirmation({
      facility,
      contactName,
      city,
      launchMonitor,
      interest,
      interestLabel: INTEREST[interest]
    });

    const sent = await email.send({
      to: emailAddress,
      subject: confirmation.subject,
      html: confirmation.html,
      replyTo: process.env.ADMIN_EMAIL
    });

    if (!sent.sent) {
      console.error("Club confirmation not sent to", emailAddress, sent.reason, sent.detail || "");
    }
  }

  if (email.isConfigured() && process.env.ADMIN_EMAIL) {
    const rows = [
      ["Facility", facility],
      ["Contact", contactName],
      ["Email", emailAddress],
      ["Phone", phone],
      ["Location", city],
      ["Launch monitor", launchMonitor],
      ["Series", platform === "trackman" ? "Trackman" : "SGT / GSPro"],
      ["Interested", INTEREST[interest]],
      ["Notes", notes || "(none)"]
    ]
      .map(function (r) {
        return "<li><strong>" + escapeHtml(r[0]) + ":</strong> " + escapeHtml(r[1]) + "</li>";
      })
      .join("");

    await email.send({
      to: process.env.ADMIN_EMAIL,
      subject: "Club interest: " + facility,
      html:
        '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;">' +
        "<h2>New club interest</h2><ul>" +
        rows +
        "</ul></div>",
      replyTo: emailAddress
    });
  }

  return res.status(200).json({ ok: true });
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}
