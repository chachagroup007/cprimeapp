const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { normalizeShop, verifySessionToken } = require("../lib/shopify-security");

const apiKey = "test-api-key";
const secret = "test-app-secret";

function makeToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    aud: apiKey,
    dest: "https://sample-store.myshopify.com",
    iss: "https://sample-store.myshopify.com/admin",
    sub: "12345",
    iat: now,
    nbf: now - 1,
    exp: now + 60,
    ...overrides,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret)
    .update(header + "." + payload).digest("base64url");
  return header + "." + payload + "." + signature;
}

test("normalizes valid Shopify shop domains", () => {
  assert.equal(normalizeShop("Sample-Store.myshopify.com"), "sample-store.myshopify.com");
  assert.equal(normalizeShop("evil.example"), null);
  assert.equal(normalizeShop("https://sample-store.myshopify.com"), null);
});

test("accepts a correctly signed, unexpired Shopify session token", () => {
  const result = verifySessionToken(makeToken(), apiKey, secret);
  assert.equal(result.shop, "sample-store.myshopify.com");
});

test("rejects a token signed with the wrong secret", () => {
  assert.equal(verifySessionToken(makeToken(), apiKey, "wrong-secret"), null);
});

test("rejects a token with the wrong audience", () => {
  assert.equal(verifySessionToken(makeToken({ aud: "another-key" }), apiKey, secret), null);
});

test("rejects expired session tokens", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(verifySessionToken(makeToken({ exp: now - 1 }), apiKey, secret), null);
});

test("rejects issuer and destination mismatch", () => {
  assert.equal(verifySessionToken(makeToken({ dest: "https://other.myshopify.com" }), apiKey, secret), null);
  assert.equal(verifySessionToken(makeToken({ iss: "https://evil.example/admin" }), apiKey, secret), null);
});

test("rejects malformed JWTs", () => {
  assert.equal(verifySessionToken("not-a-token", apiKey, secret), null);
  assert.equal(verifySessionToken("", apiKey, secret), null);
});
