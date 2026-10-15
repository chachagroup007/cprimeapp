const crypto = require("node:crypto");

function normalizeShop(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value)
    ? value.toLowerCase() : null;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifySessionToken(token, apiKey, secret) {
  if (!token || token.length > 12000 || !apiKey || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { return null; }
  if (header.alg !== "HS256" || header.typ !== "JWT") return null;
  const expected = crypto.createHmac("sha256", secret)
    .update(parts[0] + "." + parts[1]).digest("base64url");
  if (!safeEqual(expected, parts[2])) return null;
  const shop = normalizeShop(String(payload.dest || "").replace(/^https?:\/\//i, ""));
  if (!shop || payload.aud !== apiKey || payload.iss !== "https://" + shop + "/admin") return null;
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
  if (Number.isFinite(payload.nbf) && payload.nbf > now + 30) return null;
  if (Number.isFinite(payload.iat) && payload.iat > now + 60) return null;
  return { shop, payload };
}

function requireShopifySession(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get("Authorization") || "");
  const session = match && verifySessionToken(match[1], process.env.SHOPIFY_API_KEY, process.env.SHOPIFY_API_SECRET);
  if (!session) return res.status(401).json({ error: "Valid Shopify session token required" });
  req.shopifySession = session;
  return next();
}

module.exports = { normalizeShop, verifySessionToken, requireShopifySession, safeEqual };
