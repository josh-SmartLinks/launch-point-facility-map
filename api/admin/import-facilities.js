// One-time import of the committed facility list into ClubApplication, so
// every club is visible and manageable in the admin page rather than only the
// ones that arrived through the form.
//
// Idempotent: a club already present (matched on facility + city) is skipped,
// so running it twice changes nothing.
//
// Contact fields are left blank on purpose. The committed list carries no
// names, emails, or phone numbers, and this repository is public, so contact
// details are not going into it. Fill them in from the admin page or leave
// them empty.

const auth = require("../../lib/auth");
const { getDb } = require("../../lib/db");
const FACILITIES = require("../../facilities");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!auth.requireAdmin(req, res)) return;

  const db = getDb();
  if (!db) return res.status(503).json({ error: "No database configured." });

  let created = 0;
  let skipped = 0;
  const failures = [];

  try {
    for (const f of FACILITIES) {
      const existing = await db.clubApplication.findFirst({
        where: { facility: f.name, city: f.city }
      });

      if (existing) {
        skipped++;
        continue;
      }

      try {
        await db.clubApplication.create({
          data: {
            facility: f.name,
            contactName: "",
            email: "",
            phone: "",
            city: f.city,
            launchMonitor: f.sim || "",
            interest: "yes",
            notes: "Imported from the committed facility list.",
            platform: Array.isArray(f.platforms) && f.platforms.length ? f.platforms[0] : null,
            approved: true,
            approvedAt: new Date(),
            lat: f.lat,
            lng: f.lng
          }
        });
        created++;
      } catch (rowErr) {
        console.error("Import failed for", f.name, rowErr && rowErr.message);
        failures.push(f.name);
      }
    }

    return res.status(200).json({
      ok: true,
      created,
      skipped,
      failures,
      total: FACILITIES.length
    });
  } catch (err) {
    console.error("Import failed:", err && err.message);
    return res.status(500).json({ error: "Import failed. Check the logs." });
  }
};
