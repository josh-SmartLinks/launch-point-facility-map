// Archive or restore a club submission or a signup.
//
// Archiving is the normal way something leaves: the row disappears from the
// working list and, for a club, from the map, but the record stays. Nothing is
// destroyed, so a club that says no today can be restored when it changes its
// mind, and a payment record is never lost to a stray click.
//
// Permanent deletion lives in delete.js and is only offered on rows that are
// already archived.

const auth = require("../../lib/auth");
const { getDb } = require("../../lib/db");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!auth.requireAdmin(req, res)) return;

  const db = getDb();
  if (!db) return res.status(503).json({ error: "No database configured." });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const id = String(body.id || "").slice(0, 40);
  const kind = String(body.kind || "").toLowerCase();
  const archived = body.archived !== false; // default: archive

  if (!id) return res.status(400).json({ error: "Missing id." });
  if (kind !== "club" && kind !== "signup") {
    return res.status(400).json({ error: "Unknown record type." });
  }

  const data = { archived, archivedAt: archived ? new Date() : null };

  try {
    if (kind === "club") {
      // Archiving takes the club off the map too. Restoring does not put it
      // back automatically — that stays a deliberate approval.
      if (archived) data.approved = false;

      const club = await db.clubApplication.update({ where: { id }, data });
      return res.status(200).json({ ok: true, club });
    }

    const signup = await db.signup.update({ where: { id }, data });
    return res.status(200).json({ ok: true, signup });
  } catch (err) {
    console.error("Archive failed:", err && err.message);
    return res.status(500).json({ error: "Could not update that record." });
  }
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}
