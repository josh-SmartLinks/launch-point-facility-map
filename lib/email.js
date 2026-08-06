// Transactional email through Resend.
//
// Called from the Stripe webhook once a payment is confirmed. Every failure is
// caught and logged: the player has already paid at that point, so a mail
// problem must never turn into a failed webhook and a retry storm.
//
// Needs RESEND_API_KEY. Optional: EMAIL_FROM (defaults below) and ADMIN_EMAIL
// for the internal copy of each signup.

const RESEND_API = "https://api.resend.com/emails";

const FROM_NAME = "Launch Point Global Tour";

// Mail goes out as the admin address unless EMAIL_FROM says otherwise, so
// replies land in a monitored inbox and there is one address to verify in
// Resend rather than two to keep in step.
function fromAddress() {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  if (process.env.ADMIN_EMAIL) return FROM_NAME + " <" + process.env.ADMIN_EMAIL + ">";
  return FROM_NAME + " <onboarding@resend.dev>";
}

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function send({ to, subject, html, replyTo, from }) {
  if (!isConfigured()) return { sent: false, reason: "no_api_key" };
  if (!to) return { sent: false, reason: "no_recipient" };

  const payload = {
    from: from || fromAddress(),
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
      // Detail is returned so the admin diagnostic can show why, rather than
      // leaving a silent failure to guesswork.
      return { sent: false, reason: "rejected", status: r.status, detail: detail.slice(0, 500) };
    }

    return { sent: true };
  } catch (err) {
    console.error("Resend request failed:", err && err.message);
    return { sent: false, reason: "unreachable", detail: err && err.message };
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

const SITE = "https://www.launchpointglobaltour.com";
// Absolute, because an email client has no page to resolve a relative path against.
const LOGO = SITE + "/assets/logo.png";

function layout(heading, bodyHtml) {
  return [
    '<div style="font-family:Helvetica,Arial,sans-serif;background:#000;color:#fff;padding:28px;">',
    '<h1 style="font-size:20px;margin:0 0 16px;color:#fff;">' + escapeHtml(heading) + "</h1>",
    '<div style="font-size:15px;line-height:1.55;color:#e8e8e8;">' + bodyHtml + "</div>",

    // Sign-off, then the logo well below it, linked back to the site.
    '<p style="margin:30px 0 0;font-size:15px;line-height:1.55;color:#e8e8e8;">',
    "Thanks!<br />- Josh",
    "</p>",

    '<div style="margin-top:44px;">',
    '<a href="' + SITE + '" style="text-decoration:none;">',
    '<img src="' + LOGO + '" alt="Launch Point Global Tour" width="200" ' +
      'style="display:block;width:200px;max-width:70%;height:auto;border:0;" />',
    "</a>",
    "</div>",

    '<p style="margin-top:14px;font-size:12px;color:#9a9a9a;">',
    '<a href="' + SITE + '" style="color:' + BLUE + ';">launchpointglobaltour.com</a>',
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

  // What the player is told about their partner depends on what we know, so
  // nobody is left guessing whether their pairing took.
  let partnerLine =
    "<p>Your club pairs you into a two-man team before the tour starts, so watch for word from them.</p>";

  if (signup.partnerName) {
    partnerLine =
      "<p>You're paired with <strong>" + escapeHtml(signup.partnerName) + "</strong>.</p>";
  } else if (signup.partnerPhone) {
    partnerLine =
      "<p>We have your partner's number as " + escapeHtml(signup.partnerPhone) +
      ". You'll both get a note once they sign up and the pairing is confirmed.</p>";
  }

  const body = [
    "<p>You're registered, " + escapeHtml(signup.playerName) + ".</p>",
    '<table style="border-collapse:collapse;margin:18px 0;">' + rows + "</table>",
    partnerLine,
    "<p>If your club charges for bay time or a club registration fee, that is paid to the club directly. It is not part of this buy-in.</p>",
    '<p>The full schedule, format, and rules are in the <a href="https://www.launchpointglobaltour.com/proposal" style="color:' +
      BLUE +
      ';">proposal</a>.</p>'
  ].join("");

  return {
    subject: "You're in: " + (signup.tourLabel || signup.tour),
    html: layout("Registration confirmed", body)
  };
}

// Sent to both players the moment a pairing is confirmed.
function partnerPaired(signup, partner) {
  const body = [
    "<p>You're paired with <strong>" + escapeHtml(partner.playerName) + "</strong> for the " +
      escapeHtml(signup.tourLabel || signup.tour) + ".</p>",
    "<p>Reach them on " + escapeHtml(partner.phone || "the number they gave") +
      (partner.email ? " or " + escapeHtml(partner.email) : "") + ".</p>",
    "<p>You play as a two-man scramble, one scored round per week, declared before you start.</p>"
  ].join("");

  return {
    subject: "You're paired with " + partner.playerName,
    html: layout("Team confirmed", body)
  };
}

// Sent to a club that submits the interest form.
function clubConfirmation(club) {
  const rows = [
    ["Facility", club.facility],
    ["Contact", club.contactName],
    ["Location", club.city],
    ["Launch monitor", club.launchMonitor],
    ["Interested", club.interestLabel || club.interest]
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
    "<p>Thanks for putting " + escapeHtml(club.facility) + " on the list.</p>",
    '<table style="border-collapse:collapse;margin:18px 0;">' + rows + "</table>",
    "<p><strong>There is no cost for a facility to join.</strong> Nothing is locked in yet, and " +
      "you are not committed to anything by being on this list.</p>",
    "<p>We'll be in touch as the series firms up. The schedule, format, and pricing are all in " +
      'the <a href="' + SITE + '/proposal" style="color:' + BLUE + ';">proposal</a>.</p>',
    "<p>Anything to add, just reply to this email.</p>"
  ].join("");

  return {
    subject: "You're on the list: " + club.facility,
    html: layout("Club interest received", body)
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

// Resend's shared sender needs no domain verification, but only delivers to
// the account's own address. Good enough to preview a template before DNS is
// sorted out; never used for a real player confirmation.
const FALLBACK_FROM = FROM_NAME + " <onboarding@resend.dev>";

module.exports = {
  isConfigured,
  send,
  fromAddress,
  FALLBACK_FROM,
  playerConfirmation,
  partnerPaired,
  clubConfirmation,
  adminNotification
};
