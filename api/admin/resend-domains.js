// Talks to Resend's domains API with the deployment's own key.
//
// GET  lists domains with their status and per-record verification state.
// POST { verify: true, id } triggers verification for one domain.
//
// The point is to get Resend's own answer rather than inferring it from DNS
// lookups, which can disagree with what Resend's resolvers see.

const auth = require("../../lib/auth");

const RESEND_API = "https://api.resend.com/domains";

async function callResend(path, method) {
  const r = await fetch(RESEND_API + (path || ""), {
    method: method || "GET",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    }
  });

  const text = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = { raw: text.slice(0, 500) };
  }

  return { status: r.status, ok: r.ok, body: parsed };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!auth.requireAdmin(req, res)) return;

  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: "RESEND_API_KEY is not set." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  try {
    if (req.method === "POST" && body.verify) {
      const id = String(body.id || "").slice(0, 100);
      if (!id) return res.status(400).json({ error: "Missing domain id." });

      const verify = await callResend("/" + id + "/verify", "POST");
      // Verification is asynchronous, so read the domain back for its status.
      const after = await callResend("/" + id, "GET");

      return res.status(200).json({ verifyResponse: verify, domain: after });
    }

    const list = await callResend("", "GET");
    return res.status(200).json(list);
  } catch (err) {
    console.error("Resend domains call failed:", err && err.message);
    return res.status(502).json({ error: "Could not reach Resend: " + (err && err.message) });
  }
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}
