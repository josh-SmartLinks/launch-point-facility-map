// Approve or un-approve a club submission, which is what puts it on the map.
//
// Approving needs coordinates. If none are supplied, the club's free-text
// location is geocoded once here rather than on every map load. A club that
// cannot be geocoded is rejected with a clear message so the admin can enter
// coordinates by hand instead of it silently landing at (0, 0).

const auth = require("../../lib/auth");
const { getDb } = require("../../lib/db");

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

async function geocode(place) {
  const url =
    NOMINATIM + "?format=json&limit=1&q=" + encodeURIComponent(place);

  try {
    const r = await fetch(url, {
      headers: {
        // Nominatim's usage policy requires identifying the caller.
        "User-Agent": "launchpointglobaltour.com admin (Josh@launchpointsim.com)"
      }
    });
    if (!r.ok) return null;

    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return null;

    return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
  } catch (err) {
    console.error("Geocode failed:", err && err.message);
    return null;
  }
}

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
  if (!id) return res.status(400).json({ error: "Missing id." });

  try {
    const club = await db.clubApplication.findUnique({ where: { id } });
    if (!club) return res.status(404).json({ error: "Not found." });

    // Un-approving just hides it from the map; the record stays.
    if (body.approved === false) {
      const updated = await db.clubApplication.update({
        where: { id },
        data: { approved: false, approvedAt: null }
      });
      return res.status(200).json({ ok: true, club: updated });
    }

    let lat = body.lat === undefined || body.lat === "" ? club.lat : Number(body.lat);
    let lng = body.lng === undefined || body.lng === "" ? club.lng : Number(body.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const found = await geocode(club.city);
      if (!found) {
        return res.status(422).json({
          error:
            'Could not find "' + club.city + '" on the map. Enter latitude and longitude by hand.'
        });
      }
      lat = found.lat;
      lng = found.lng;
    }

    const platform =
      body.platform === "sgt" || body.platform === "trackman"
        ? body.platform
        : club.platform;

    const mapName = body.mapName ? String(body.mapName).slice(0, 120) : club.mapName;

    const updated = await db.clubApplication.update({
      where: { id },
      data: { approved: true, approvedAt: new Date(), lat, lng, platform, mapName }
    });

    return res.status(200).json({ ok: true, club: updated });
  } catch (err) {
    console.error("Approve failed:", err && err.message);
    return res.status(500).json({ error: "Could not update that club." });
  }
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}
