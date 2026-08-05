// Reports whether this deployment can actually take payments.
//
// The signup page calls this on load and stays hidden unless it comes back
// enabled, so a deploy without a Stripe key never shows a checkout form that
// would fail. Presence of the env var is not enough — the key is verified
// against Stripe so a stale or revoked key also reads as "not configured".

const { TOUR_LABELS, PLATFORM_LABELS, quote } = require("../lib/pricing");

const STRIPE_API = "https://api.stripe.com/v1";

// Server-side prices, so the page never quotes a total Stripe won't charge.
function priceTable() {
  return {
    platforms: PLATFORM_LABELS,
    tours: Object.keys(TOUR_LABELS).map((t) => quote(t))
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const key = process.env.STRIPE_SECRET_KEY;

  if (!key || !/^sk_(test|live)_/.test(key)) {
    return res.status(200).json({ enabled: false, reason: "no_key" });
  }

  try {
    const r = await fetch(STRIPE_API + "/balance", {
      headers: { Authorization: "Bearer " + key }
    });

    if (!r.ok) {
      return res.status(200).json({ enabled: false, reason: "key_rejected" });
    }

    return res.status(200).json({
      enabled: true,
      mode: key.startsWith("sk_live_") ? "live" : "test",
      pricing: priceTable()
    });
  } catch (err) {
    // Network trouble reaching Stripe — fail closed rather than show a form
    // that cannot complete.
    return res.status(200).json({ enabled: false, reason: "unreachable" });
  }
};
