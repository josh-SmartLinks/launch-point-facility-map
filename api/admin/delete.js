// Permanent deletion. The normal way to remove something is archive.js, which
// keeps the record; this destroys it.
//
// Only archived rows can be deleted, so removing anything is always two
// deliberate steps. Paid signups need confirmPaid on top of that, because the
// row is the record of money taken.

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

  if (!id) return res.status(400).json({ error: "Missing id." });
  if (kind !== "club" && kind !== "signup") {
    return res.status(400).json({ error: "Unknown record type." });
  }

  try {
    if (kind === "club") {
      const club = await db.clubApplication.findUnique({ where: { id } });
      if (!club) return res.status(404).json({ error: "Not found." });
      if (!club.archived) {
        return res.status(409).json({ error: "Archive it first, then delete." });
      }
      await db.clubApplication.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    }

    const signup = await db.signup.findUnique({ where: { id } });
    if (!signup) return res.status(404).json({ error: "Not found." });

    if (!signup.archived) {
      return res.status(409).json({ error: "Archive it first, then delete." });
    }

    if (signup.status === "paid" && body.confirmPaid !== true) {
      return res.status(409).json({
        error:
          "That signup is paid. Deleting it removes the record of a real payment. Confirm to proceed."
      });
    }

    await db.signup.delete({ where: { id } });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Delete failed:", err && err.message);
    return res.status(500).json({ error: "Could not delete that record." });
  }
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}
