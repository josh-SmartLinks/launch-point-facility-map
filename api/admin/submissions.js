// Everything the admin page shows: club submissions and paid signups.

const auth = require("../../lib/auth");
const { getDb } = require("../../lib/db");

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

    const paid = signups.filter((s) => s.status === "paid");

    return res.status(200).json({
      clubs,
      signups,
      totals: {
        clubs: clubs.length,
        clubsApproved: clubs.filter((c) => c.approved).length,
        signupsPaid: paid.length,
        // Buy-in only: the card fee is not part of the pot.
        potCents: paid.reduce((sum, s) => sum + (s.buyInCents || 0), 0)
      }
    });
  } catch (err) {
    console.error("Admin submissions query failed:", err && err.message);
    return res.status(500).json({ error: "Could not load submissions." });
  }
};
