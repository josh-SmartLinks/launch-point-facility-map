// Admin session handling.
//
// One shared password (ADMIN_PASSWORD) exchanged for a signed cookie. No user
// table, because there is one administrator. The cookie carries an expiry and
// an HMAC over it, so it cannot be forged or extended without SESSION_SECRET.
//
// Requires ADMIN_PASSWORD and SESSION_SECRET. With either missing, admin
// endpoints refuse everything rather than falling open.

const crypto = require("crypto");

const COOKIE_NAME = "lp_admin";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function isConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
}

// Constant-time compare so a wrong password cannot be found byte by byte.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Still spend the comparison, then fail.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function sign(value) {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(value)
    .digest("hex");
}

function checkPassword(password) {
  if (!isConfigured()) return false;
  return safeEqual(password || "", process.env.ADMIN_PASSWORD);
}

function issueToken() {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = String(expires);
  return payload + "." + sign(payload);
}

function verifyToken(token) {
  if (!isConfigured() || !token) return false;

  const parts = String(token).split(".");
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  const expected = sign(payload);

  if (!safeEqual(signature, expected)) return false;

  const expires = Number(payload);
  return Number.isFinite(expires) && expires > Date.now();
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res) {
  res.setHeader("Set-Cookie", [
    COOKIE_NAME +
      "=" +
      issueToken() +
      "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" +
      MAX_AGE_SECONDS
  ]);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", [
    COOKIE_NAME + "=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  ]);
}

// Returns true when the request carries a valid session. Writes the 401 itself
// so every admin route handles rejection identically.
function requireAdmin(req, res) {
  if (!isConfigured()) {
    res.status(503).json({ error: "Admin is not configured." });
    return false;
  }
  if (!verifyToken(parseCookies(req)[COOKIE_NAME])) {
    res.status(401).json({ error: "Not signed in." });
    return false;
  }
  return true;
}

module.exports = {
  COOKIE_NAME,
  isConfigured,
  checkPassword,
  setSessionCookie,
  clearSessionCookie,
  requireAdmin
};
