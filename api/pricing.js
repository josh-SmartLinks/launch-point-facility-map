// Tour pricing and the card-fee gross-up, shared by the checkout endpoint and
// exposed to the signup page so the quoted total always matches what Stripe
// charges. Prices are per player; teams are two-man.

const PER_PLAYER = {
  fall: 6000,     // cents
  winter: 6000,
  spring: 5000,
  bundle: 17000   // all three tours, paid at Fall registration
};

const TOUR_LABELS = {
  fall: "Fall Tour 2026",
  winter: "Winter Tour 2027",
  spring: "Spring Tour 2027",
  bundle: "Season Bundle (Fall + Winter + Spring)"
};

const PLATFORM_LABELS = {
  sgt: "SGT / GSPro",
  trackman: "Trackman"
};

// Stripe's standard US card rate. The buy-in must land in the pot whole, so the
// payer covers the fee: gross = (net + fixed) / (1 - pct).
const FEE_PCT = 0.029;
const FEE_FIXED = 30; // cents

// Returns cents to add on top of `net` so that Stripe's cut leaves `net` behind.
function processingFee(net) {
  const gross = Math.ceil((net + FEE_FIXED) / (1 - FEE_PCT));
  return gross - net;
}

const TEAM_SIZE = 2;

function quote(tour) {
  const perPlayer = PER_PLAYER[tour];
  if (!perPlayer) return null;

  const subtotal = perPlayer * TEAM_SIZE;
  const fee = processingFee(subtotal);

  return {
    tour,
    tourLabel: TOUR_LABELS[tour],
    perPlayer,
    teamSize: TEAM_SIZE,
    subtotal,
    fee,
    total: subtotal + fee
  };
}

module.exports = {
  PER_PLAYER,
  TOUR_LABELS,
  PLATFORM_LABELS,
  TEAM_SIZE,
  processingFee,
  quote
};
