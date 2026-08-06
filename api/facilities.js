// The map's facility list: the committed clubs in facilities.js plus any
// approved submissions from the database.
//
// The static file stays the source of truth for the founding clubs, so the map
// still works with no database, and an approved submission is additive. If the
// database is unreachable the static list is returned rather than an error —
// a broken query should never empty the map.

const FACILITIES = require("../facilities");
const { getDb } = require("../lib/db");

module.exports = async (req, res) => {
  // Short cache: approvals should show up quickly without hammering the DB.
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");

  const staticNames = {};
  FACILITIES.forEach((f) => {
    staticNames[f.name.toLowerCase()] = true;
  });

  const db = getDb();
  if (!db) return res.status(200).json({ facilities: FACILITIES, source: "static" });

  try {
    const approved = await db.clubApplication.findMany({
      where: { approved: true, archived: false, lat: { not: null }, lng: { not: null } },
      orderBy: { approvedAt: "asc" }
    });

    const extra = approved
      .map((c) => ({
        name: c.mapName || c.facility,
        city: c.city,
        lat: c.lat,
        lng: c.lng,
        sim: c.launchMonitor || undefined,
        platforms: c.platform ? [c.platform] : undefined
      }))
      // A club already in the committed list wins, so approving a duplicate
      // does not produce two pins.
      .filter((c) => !staticNames[String(c.name).toLowerCase()]);

    return res.status(200).json({
      facilities: FACILITIES.concat(extra),
      source: extra.length ? "static+approved" : "static"
    });
  } catch (err) {
    console.error("Facilities query failed:", err && err.message);
    return res.status(200).json({ facilities: FACILITIES, source: "static" });
  }
};
