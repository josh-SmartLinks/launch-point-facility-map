// Overrides a pairing by hand.
//
// Pairing normally comes from the two phone numbers, but people mistype, sign
// up with a different number than they gave, or ask to swap. Setting a partner
// here wins over the numbers, on both signups, so the pair agrees from either
// side. Clearing it hands the pair back to the phone matching.

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
  const partnerId = body.partnerId ? String(body.partnerId).slice(0, 40) : null;

  if (!id) return res.status(400).json({ error: "Missing signup id." });
  if (partnerId === id) return res.status(400).json({ error: "A player cannot partner themselves." });

  try {
    const signup = await db.signup.findUnique({ where: { id } });
    if (!signup) return res.status(404).json({ error: "Signup not found." });

    // Clearing: drop the override on this signup and on whoever pointed here.
    if (!partnerId) {
      await db.signup.update({ where: { id }, data: { partnerSignupId: null } });
      await db.signup.updateMany({
        where: { partnerSignupId: id },
        data: { partnerSignupId: null }
      });
      return res.status(200).json({ ok: true, cleared: true });
    }

    const partner = await db.signup.findUnique({ where: { id: partnerId } });
    if (!partner) return res.status(404).json({ error: "That partner signup does not exist." });

    if (partner.tour !== signup.tour) {
      return res.status(409).json({
        error: "Those two are in different tours (" + signup.tour + " and " + partner.tour + ")."
      });
    }

    // Free both from any pairing they are already in, so nobody ends up in two
    // teams at once.
    await db.signup.updateMany({
      where: { partnerSignupId: { in: [id, partnerId] } },
      data: { partnerSignupId: null }
    });

    await db.signup.update({ where: { id }, data: { partnerSignupId: partnerId } });
    await db.signup.update({ where: { id: partnerId }, data: { partnerSignupId: id } });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Set partner failed:", err && err.message);
    return res.status(500).json({ error: "Could not set that pairing." });
  }
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}
