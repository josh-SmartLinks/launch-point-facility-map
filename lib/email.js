// Transactional email through Resend.
//
// Called from the Stripe webhook once a payment is confirmed. Every failure is
// caught and logged: the player has already paid at that point, so a mail
// problem must never turn into a failed webhook and a retry storm.
//
// Needs RESEND_API_KEY. Optional: EMAIL_FROM (defaults below) and ADMIN_EMAIL
// for the internal copy of each signup.

const RESEND_API = "https://api.resend.com/emails";

const DEFAULT_FROM = "Launch Point Global Tour <signups@launchpointglobaltour.com>";

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function send({ to, subject, html, replyTo }) {
  if (!isConfigured()) return { sent: false, reason: "no_api_key" };
  if (!to) return { sent: false, reason: "no_recipient" };

  const payload = {
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  };
  if (replyTo) payload.reply_to = replyTo;

  try {
    const r = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("Resend rejected the message:", r.status, detail.slice(0, 300));
      return { sent: false, reason: "rejected" };
    }

    return { sent: true };
  } catch (err) {
    console.error("Resend request failed:", err && err.message);
    return { sent: false, reason: "unreachable" };
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function money(cents) {
  return "$" + (Number(cents || 0) / 100).toFixed(2);
}

const BLUE = "#1179BF";

function layout(heading, bodyHtml) {
  return [
    '<div style="font-family:Helvetica,Arial,sans-serif;background:#000;color:#fff;padding:28px;">',
    '<h1 style="font-size:20px;margin:0 0 16px;color:#fff;">' + escapeHtml(heading) + "</h1>",
    '<div style="font-size:15px;line-height:1.55;color:#e8e8e8;">' + bodyHtml + "</div>",
    '<p style="margin-top:26px;font-size:12px;color:#9a9a9a;">',
    'Launch Point Global Tour · <a href="https://www.launchpointglobaltour.com" style="color:' +
      BLUE + ';">launchpointglobaltour.com</a>',
    "</p>",
    "</div>"
  ].join("");
}

// Confirmation to the player who just paid.
function playerConfirmation(signup) {
  const rows = [
    ["Club", signup.club],
    ["Tour", signup.tourLabel || signup.tour],
    ["Platform", signup.platformLabel || signup.platform],
    ["Buy-in", money(signup.buyInCents)],
    ["Card processing fee", money(signup.feeCents)],
    ["Total paid", money(signup.totalCents)]
  ]
    .map(function (r) {
      return (
        '<tr><td style="padding:5px 14px 5px 0;color:#9a9a9a;">' +
        escapeHtml(r[0]) +
        '</td><td style="padding:5px 0;color:#fff;">' +
        escapeHtml(r[1]) +
        "</td></tr>"
      );
    })
    .join("");

  const body = [
    "<p>You're registered, " + escapeHtml(signup.playerName) + ".</p>",
    '<table style="border-collapse:collapse;margin:18px 0;">' + rows + "</table>",
    "<p>Your club pairs you into a two-man team before the tour starts, so watch for word from them.</p>",
    "<p>If your club charges for bay time or a club registration fee, that is paid to the club directly. It is not part of this buy-in.</p>",
    '<p>The full schedule, format, and rules are in the <a href="https://www.launchpointglobaltour.com/proposal.html" style="color:' +
      BLUE +
      ';">proposal</a>.</p>'
  ].join("");

  return {
    subject: "You're in: " + (signup.tourLabel || signup.tour),
    html: layout("Registration confirmed", body)
  };
}

// Internal copy so a signup is visible without opening Stripe.
function adminNotification(signup) {
  const body = [
    "<p><strong>" + escapeHtml(signup.playerName) + "</strong> registered.</p>",
    "<ul>",
    "<li>Club: " + escapeHtml(signup.club) + "</li>",
    "<li>Tour: " + escapeHtml(signup.tourLabel || signup.tour) + "</li>",
    "<li>Platform: " + escapeHtml(signup.platformLabel || signup.platform) + "</li>",
    "<li>Email: " + escapeHtml(signup.email) + "</li>",
    "<li>Phone: " + escapeHtml(signup.phone) + "</li>",
    "<li>Paid: " + escapeHtml(money(signup.totalCents)) +
      " (buy-in " + escapeHtml(money(signup.buyInCents)) +
      " + fee " + escapeHtml(money(signup.feeCents)) + ")</li>",
    "</ul>"
  ].join("");

  return {
    subject: "New signup: " + signup.playerName + " (" + signup.club + ")",
    html: layout("New tour signup", body)
  };
}

module.exports = { isConfigured, send, playerConfirmation, adminNotification };
