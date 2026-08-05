// Prisma client for the serverless functions.
//
// Deliberately best-effort: if DATABASE_URL is missing, or the client has not
// been generated, this returns null instead of throwing. Signup must keep
// working even when the database does not — a player should never be blocked
// from paying because logging failed.
//
// The instance is cached on globalThis so warm lambda invocations reuse one
// connection instead of opening a new pool per request.

let cached = globalThis.__lpPrisma;

function getDb() {
  if (cached !== undefined) return cached;

  if (!process.env.DATABASE_URL) {
    cached = null;
    globalThis.__lpPrisma = cached;
    return cached;
  }

  try {
    const { PrismaClient } = require("@prisma/client");
    cached = new PrismaClient();
  } catch (err) {
    console.error("Prisma client unavailable:", err && err.message);
    cached = null;
  }

  globalThis.__lpPrisma = cached;
  return cached;
}

module.exports = { getDb };
