// Creates a Stripe Checkout session for one two-man team entering one tour.
//
// Prices live server-side (api/pricing.js) so a tampered client cannot change
// what gets charged. The card processing fee is added as its own line item, so
// the full buy-in reaches the prize pot and the payer covers Stripe's cut.

const { TOUR_LABELS, PLATFORM_LABELS, TEAM_SIZE, quote } = require("./pricing");

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
  const captainEmail = clean(body.captainEmail, 200);
  const players = Array.isArray(body.players) ? body.players : [];

  const priced = quote(tour);
  if (!priced) {
    return res.status(400).json({ error: "Pick a tour." });
  }
  if (!PLATFORM_LABELS[platform]) {
    return res.status(400).json({ error: "Pick a platform." });
  }
  if (!club) {
    return res.status(400).json({ error: "Pick your club." });
  }
  if (!isEmail(captainEmail)) {
    return res.status(400).json({ error: "Enter a valid email for the receipt." });
  }

  const names = players.map((p) => clean(p, 80)).filter(Boolean);
  if (names.length !== TEAM_SIZE) {
    return res.status(400).json({ error: "Enter both players on the team." });
  }

  const origin =
    req.headers.origin ||
    "https://" + (req.headers["x-forwarded-host"] || req.headers.host || "www.launchpointglobaltour.com");

  const entryLabel =
    TOUR_LABELS[tour] + " — " + PLATFORM_LABELS[platform] + " — team of " + TEAM_SIZE;

  const params = {
    mode: "payment",
    success_url: origin + "/signup.html?status=success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: origin + "/signup.html?status=cancelled",
    customer_email: captainEmail,

    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(priced.subtotal),
    "line_items[0][price_data][product_data][name]": entryLabel,
    "line_items[0][price_data][product_data][description]":
      club + " — " + names.join(" & "),

    "line_items[1][quantity]": "1",
    "line_items[1][price_data][currency]": "usd",
    "line_items[1][price_data][unit_amount]": String(priced.fee),
    "line_items[1][price_data][product_data][name]": "Card processing fee",
    "line_items[1][price_data][product_data][description]":
      "Covers card processing so the full buy-in goes to the pot.",

    "metadata[club]": club,
    "metadata[platform]": platform,
    "metadata[tour]": tour,
    "metadata[player_1]": names[0],
    "metadata[player_2]": names[1],
    "metadata[buy_in_cents]": String(priced.subtotal),
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
