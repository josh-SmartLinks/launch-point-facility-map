// Creates a Stripe Checkout session for one player entering one tour.
//
// Buy-in is per individual. Clubs pair their own players into two-man teams,
// so no partner is collected here.
//
// Prices live server-side (lib/pricing.js) so a tampered client cannot change
// what gets charged. The card processing fee is added as its own line item, so
// the full buy-in reaches the prize pot and the payer covers Stripe's cut.

const { TOUR_LABELS, PLATFORM_LABELS, quote } = require("../lib/pricing");
const { getDb } = require("../lib/db");
const FACILITIES = require("../facilities");

const OTHER_CLUB = "Other / not listed";

// Clubs are validated against the real list so the field cannot be used to
// write arbitrary text into Stripe records and the roster.
const VALID_CLUBS = FACILITIES.reduce(
  (acc, f) => {
    acc[f.name] = true;
    return acc;
  },
  { [OTHER_CLUB]: true }
);

const STRIPE_API = "https://api.stripe.com/v1";

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Stripe's REST API takes form encoding with bracketed keys, not JSON.
function encode(params) {
  return Object.keys(params)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
    .join("&");
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^sk_(test|live)_/.test(key)) {
    return res.status(503).json({ error: "Signup is not open yet." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  const tour = clean(body.tour, 20).toLowerCase();
  const platform = clean(body.platform, 20).toLowerCase();
  const club = clean(body.club, 120);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 30);
  const playerName = clean(body.playerName, 80);

  const priced = quote(tour);
  if (!priced) {
    return res.status(400).json({ error: "Pick a tour." });
  }
  if (!PLATFORM_LABELS[platform]) {
    return res.status(400).json({ error: "Pick a platform." });
  }
  if (!VALID_CLUBS[club]) {
    return res.status(400).json({ error: "Pick your club." });
  }
  if (!isEmail(email)) {
    return res.status(400).json({ error: "Enter a valid email for the receipt." });
  }
  if (!playerName) {
    return res.status(400).json({ error: "Enter the player's name." });
  }
  // Loose on formatting, strict on being reachable: enough digits to be a
  // real number.
  if ((phone.match(/\d/g) || []).length < 10) {
    return res.status(400).json({ error: "Enter a phone number we can reach you at." });
  }

  // Never build the redirect from a caller-supplied header. A request with
  // Origin: https://evil.com would otherwise produce a real Stripe Checkout
  // page on this account that hands the payer off to someone else's site
  // afterwards. Only these hosts are allowed.
  const origin = allowedOrigin(req);

  const entryLabel =
    TOUR_LABELS[tour] + ", " + PLATFORM_LABELS[platform] + ", one player";

  const params = {
    mode: "payment",
    success_url: origin + "/signup?status=success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: origin + "/signup?status=cancelled",
    customer_email: email,

    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(priced.buyIn),
    "line_items[0][price_data][product_data][name]": entryLabel,
    "line_items[0][price_data][product_data][description]": club + ": " + playerName,

    "line_items[1][quantity]": "1",
    "line_items[1][price_data][currency]": "usd",
    "line_items[1][price_data][unit_amount]": String(priced.fee),
    "line_items[1][price_data][product_data][name]": "Card processing fee",
    "line_items[1][price_data][product_data][description]":
      "Covers card processing so the full buy-in goes to the pot.",

    "metadata[club]": club,
    "metadata[platform]": platform,
    "metadata[tour]": tour,
    "metadata[player]": playerName,
    "metadata[phone]": phone,
    // Carried explicitly: the completed-session payload often leaves
    // customer_email null and reports the address under customer_details.
    "metadata[email]": email,
    "metadata[buy_in_cents]": String(priced.buyIn),
    "metadata[fee_cents]": String(priced.fee)
  };

  try {
    const r = await fetch(STRIPE_API + "/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: encode(params)
    });

    const data = await r.json();

    if (!r.ok) {
      console.error("Stripe error:", data && data.error);
      return res.status(502).json({ error: "Could not start checkout. Try again." });
    }

    // Record the attempt as pending. The webhook flips it to paid, so an
    // abandoned checkout stays visible as a lead rather than vanishing.
    // A logging failure must never block a payment, hence the catch.
    const db = getDb();
    if (db) {
      try {
        await db.signup.upsert({
          where: { stripeSessionId: data.id },
          create: {
            stripeSessionId: data.id,
            status: "pending",
            club,
            platform,
            tour,
            playerName,
            email,
            phone,
            buyInCents: priced.buyIn,
            feeCents: priced.fee,
            totalCents: priced.total
          },
          update: {}
        });
      } catch (dbErr) {
        console.error("Could not record signup:", dbErr && dbErr.message);
      }
    }

    return res.status(200).json({ url: data.url });
  } catch (err) {
    console.error("Checkout request failed:", err);
    return res.status(502).json({ error: "Could not reach the payment processor." });
  }
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}

// The canonical site, plus whatever Vercel deployment URL this is running on
// (so preview deployments can be tested), and nothing else.
const CANONICAL_ORIGIN = "https://www.launchpointglobaltour.com";

function allowedOrigin(req) {
  const candidates = [CANONICAL_ORIGIN];

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) candidates.push("https://" + vercelUrl);

  const sent = clean(req.headers.origin, 200);
  if (sent && candidates.indexOf(sent) !== -1) return sent;

  return CANONICAL_ORIGIN;
}
