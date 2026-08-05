// Exchanges the admin password for a signed session cookie.

const auth = require("../../lib/auth");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "DELETE") {
    auth.clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!auth.isConfigured()) {
    return res.status(503).json({ error: "Admin is not configured." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  if (!auth.checkPassword(body.password)) {
    // Deliberately slow and vague: no hint about which part was wrong.
    await new Promise((r) => setTimeout(r, 600));
    return res.status(401).json({ error: "Wrong password." });
  }

  auth.setSessionCookie(res);
  return res.status(200).json({ ok: true });
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}
