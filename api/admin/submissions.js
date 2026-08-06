// Everything the admin page shows: club submissions and paid signups.

const auth = require("../../lib/auth");
const { getDb } = require("../../lib/db");
const { resolveTeams } = require("../../lib/teams");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!auth.requireAdmin(req, res)) return;

  const db = getDb();
  if (!db) {
    return res.status(503).json({ error: "No database configured." });
  }

  try {
    const [clubs, signups] = await Promise.all([
      db.clubApplication.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      db.signup.findMany({ orderBy: { createdAt: "desc" }, take: 500 })
    ]);

    // Archived rows are still returned so the admin page can show them on
    // request, but every total counts only what is live.
    const activeClubs = clubs.filter((c) => !c.archived);
    const activeSignups = signups.filter((s) => !s.archived);
    const paid = activeSignups.filter((s) => s.status === "paid");

    // Pairing is derived, not stored, so it is always current.
    const teams = resolveTeams(signups);
    const signupsWithTeams = signups.map((s) => {
      const t = teams[s.id] || {};
      return Object.assign({}, s, {
        partnerStatus: t.status || "none",
        partnerReason: t.reason || "",
        partnerName: t.partner ? t.partner.playerName : null,
        partnerId: t.partner ? t.partner.id : null
      });
    });

    return res.status(200).json({
      clubs,
      signups: signupsWithTeams,
      totals: {
        clubs: activeClubs.length,
        clubsApproved: activeClubs.filter((c) => c.approved).length,
        clubsArchived: clubs.length - activeClubs.length,
        signupsPaid: paid.length,
        signupsArchived: signups.length - activeSignups.length,
        // Buy-in only: the card fee is not part of the pot.
        potCents: paid.reduce((sum, s) => sum + (s.buyInCents || 0), 0)
      }
    });
  } catch (err) {
    console.error("Admin submissions query failed:", err && err.message);
    return res.status(500).json({ error: "Could not load submissions." });
  }
};
