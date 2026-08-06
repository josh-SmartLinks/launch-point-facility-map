// Bulk-imports club details from a pasted spreadsheet export.
//
// The roster lives in spreadsheets, not in this repository, because the
// repository is public and these are real people's phone numbers. So the data
// arrives by paste, through an authenticated request, and is matched to the
// existing club rows by facility name.
//
// Handles the Microsoft Forms export directly: a header row names the columns,
// cells may be quoted, and a quoted cell may contain newlines (a couple of the
// locations are typed across two lines). Without a header row it falls back to
// identifying fields by what they look like.
//
// Send dryRun to preview the match before anything is written.

const auth = require("../../lib/auth");
const { getDb } = require("../../lib/db");

// ---------- Parsing ----------

// Splits TSV/CSV respecting quotes, including newlines inside quoted cells.
function parseTable(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  const delimiter = text.indexOf("\t") !== -1 ? "\t" : ",";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  row.push(cell);
  rows.push(row);

  return rows
    .map((r) => r.map((c) => c.replace(/\s+/g, " ").trim()))
    .filter((r) => r.some(Boolean));
}

// Header text -> field name. Matched loosely so wording changes survive.
const HEADER_MAP = [
  [/facility/i, "facility"],
  [/launch monitor/i, "launchMonitor"],
  [/city|state|country|location/i, "city"],
  [/phone/i, "phone"],
  [/e-?mail/i, "email"],
  [/interested|interest/i, "interest"],
  [/anything|question|note/i, "notes"],
  [/^name$|your name|contact/i, "contactName"]
];

function mapHeader(cells) {
  const map = {};
  cells.forEach((h, i) => {
    for (const [pattern, field] of HEADER_MAP) {
      if (pattern.test(h) && map[field] === undefined) {
        map[field] = i;
        return;
      }
    }
  });
  return map.facility === undefined ? null : map;
}

function normaliseInterest(value) {
  const v = String(value || "").toLowerCase();
  if (v.indexOf("not right now") !== -1 || v.indexOf("no") === 0) return "not_now";
  if (v.indexOf("maybe") !== -1) return "maybe";
  if (v.indexOf("yes") !== -1) return "yes";
  return null;
}

// "anonymous" is what the form records when it collects no address.
function realEmail(value) {
  const v = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

// ---------- Matching ----------

function key(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/\(.*?\)/g, " ")   // "Indoor Golf RVA (currently two facilities)"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Exact, then prefix, then containment. Enough to survive "1872 Golf aclu"
// against "1872 Golf Club" only if a human fixes it, which the report shows.
function findClub(clubs, name) {
  const k = key(name);
  if (!k) return null;

  let hit = clubs.find((c) => key(c.facility) === k);
  if (hit) return hit;

  hit = clubs.find((c) => key(c.facility).startsWith(k) || k.startsWith(key(c.facility)));
  if (hit) return hit;

  const words = k.split(" ").filter((w) => w.length > 3);
  if (words.length) {
    hit = clubs.find((c) => {
      const ck = key(c.facility);
      return words.every((w) => ck.indexOf(w) !== -1);
    });
    if (hit) return hit;
  }

  return null;
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!auth.requireAdmin(req, res)) return;

  const db = getDb();
  if (!db) return res.status(503).json({ error: "No database configured." });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const text = String(body.text || "");
  const dryRun = body.dryRun === true;
  const overwrite = body.overwrite === true;

  if (!text.trim()) return res.status(400).json({ error: "Paste the export first." });

  const table = parseTable(text);
  if (!table.length) return res.status(400).json({ error: "Could not read any rows." });

  const header = mapHeader(table[0]);
  if (!header) {
    return res.status(400).json({
      error: 'No header row found. Include the row starting with "Id" and "Facility name".'
    });
  }

  const parsed = table
    .slice(1)
    .map((cells) => ({
      facility: cells[header.facility] || "",
      contactName: header.contactName !== undefined ? cells[header.contactName] || "" : "",
      email: header.email !== undefined ? realEmail(cells[header.email]) : "",
      phone: header.phone !== undefined ? cells[header.phone] || "" : "",
      city: header.city !== undefined ? cells[header.city] || "" : "",
      launchMonitor: header.launchMonitor !== undefined ? cells[header.launchMonitor] || "" : "",
      interest: header.interest !== undefined ? normaliseInterest(cells[header.interest]) : null,
      notes: header.notes !== undefined ? cells[header.notes] || "" : ""
    }))
    .filter((r) => r.facility);

  if (!parsed.length) return res.status(400).json({ error: "No rows with a facility name." });

  try {
    const clubs = await db.clubApplication.findMany();

    const matched = [];
    const unmatched = [];

    for (const row of parsed) {
      const club = findClub(clubs, row.facility);

      if (!club) {
        unmatched.push(row.facility);
        continue;
      }

      // Fill blanks by default so a hand correction survives a re-paste.
      const data = {};
      const consider = (field, value) => {
        if (!value) return;
        if (overwrite || !club[field]) data[field] = value;
      };

      consider("contactName", row.contactName);
      consider("email", row.email);
      consider("phone", row.phone);
      consider("launchMonitor", row.launchMonitor);
      consider("notes", row.notes);
      if (row.interest && (overwrite || club.interest !== row.interest)) {
        data.interest = row.interest;
      }

      matched.push({
        submitted: row.facility,
        matchedTo: club.facility,
        exact: key(row.facility) === key(club.facility),
        willSet: Object.keys(data)
      });

      if (!dryRun && Object.keys(data).length) {
        await db.clubApplication.update({ where: { id: club.id }, data });
      }
    }

    return res.status(200).json({
      ok: true,
      dryRun,
      rows: parsed.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      // Fuzzy matches are called out so a wrong pairing is visible.
      fuzzy: matched.filter((m) => !m.exact),
      matched,
      unmatched
    });
  } catch (err) {
    console.error("Contact import failed:", err && err.message);
    return res.status(500).json({ error: "Import failed. Check the logs." });
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}

module.exports = handler;

// Exposed so the parser can be exercised against a real export without a
// database or a live request.
module.exports._internals = { parseTable, mapHeader, findClub, key, normaliseInterest };
