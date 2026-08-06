// Works out who is partnered with whom.
//
// Players pair by giving their partner's phone number at signup. Nothing is
// written at that point, because the partner may not have signed up yet, so
// pairing is derived from the numbers whenever it is needed. An admin can
// override a pairing by hand, and that always wins.
//
// A pairing is only valid inside the same tour: the same two people can be a
// team in Fall and not in Spring.

// Compares numbers by digits alone, so "(781) 859-9522" and "7818599522"
// match, using the last ten to survive a leading country code.
function normalisePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

const STATUS = {
  NONE: "none",           // no partner given
  MATCHED: "matched",     // both named each other
  ONE_SIDED: "one_sided", // this player named someone who named nobody, or someone else
  WAITING: "waiting",     // named a number that has not signed up for this tour
  OVERRIDDEN: "overridden"// paired by an admin
};

// Returns a map of signup id -> { status, partner, reason }.
function resolveTeams(signups) {
  const live = signups.filter((s) => !s.archived);

  // Index by tour, since a pairing only holds within one tour.
  const byTourPhone = {};
  live.forEach((s) => {
    const k = s.tour + "|" + normalisePhone(s.phone);
    if (!byTourPhone[k]) byTourPhone[k] = [];
    byTourPhone[k].push(s);
  });

  const byId = {};
  live.forEach((s) => {
    byId[s.id] = s;
  });

  const out = {};

  live.forEach((s) => {
    // An admin override settles it, whatever the numbers say.
    if (s.partnerSignupId) {
      const partner = byId[s.partnerSignupId];
      out[s.id] = {
        status: STATUS.OVERRIDDEN,
        partner: partner || null,
        reason: partner ? "Set by an admin." : "Set by an admin, but that signup is gone."
      };
      return;
    }

    const wanted = normalisePhone(s.partnerPhone);
    if (!wanted) {
      out[s.id] = { status: STATUS.NONE, partner: null, reason: "No partner given." };
      return;
    }

    const candidates = (byTourPhone[s.tour + "|" + wanted] || []).filter((c) => c.id !== s.id);

    if (!candidates.length) {
      out[s.id] = {
        status: STATUS.WAITING,
        partner: null,
        reason: "That number has not signed up for this tour yet."
      };
      return;
    }

    // Prefer the one who named this player back.
    const mutual = candidates.filter(
      (c) => normalisePhone(c.partnerPhone) === normalisePhone(s.phone)
    )[0];

    if (mutual) {
      out[s.id] = { status: STATUS.MATCHED, partner: mutual, reason: "Both named each other." };
      return;
    }

    out[s.id] = {
      status: STATUS.ONE_SIDED,
      partner: candidates[0],
      reason: "They named someone else, or nobody."
    };
  });

  // Archived signups are still reported, just never paired.
  signups
    .filter((s) => s.archived)
    .forEach((s) => {
      out[s.id] = { status: STATUS.NONE, partner: null, reason: "Archived." };
    });

  return out;
}

module.exports = { normalisePhone, resolveTeams, STATUS };
