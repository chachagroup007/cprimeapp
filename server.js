require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const mysql = require("mysql2/promise");
const createAdminRouter = require("./routes/admin");

const app = express();
app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  frameguard: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.shopify.com"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'", "https://admin.shopify.com", "https://*.myshopify.com"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      formAction: ["'self'"],
    },
  },
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, allowedOrigins.includes(origin));
  },
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({
  limit: "512kb",
  verify(req, _res, buffer) { req.rawBody = Buffer.from(buffer); },
}));

let pool;
function getDatabase() {
  const missing = ["DB_HOST", "DB_NAME", "DB_USER"].filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error("Database environment is not configured");
    error.code = "DATABASE_CONFIG_MISSING";
    throw error;
  }
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 20,
      charset: "utf8mb4",
      timezone: "Z",
    });
  }
  return pool;
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    const error = new Error("Required application configuration is missing");
    error.code = "APP_CONFIG_MISSING";
    throw error;
  }
  return value;
}

function normalizeShop(shop) {
  return typeof shop === "string" && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)
    ? shop.toLowerCase()
    : null;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyQueryHmac(query, secret) {
  const received = query.hmac;
  if (typeof received !== "string" || !/^[a-f0-9]{64}$/i.test(received)) return false;
  const message = Object.keys(query)
    .filter((key) => key !== "hmac" && key !== "signature")
    .sort()
    .map((key) => `${key}=${Array.isArray(query[key]) ? query[key].join(",") : query[key]}`)
    .join("&");
  const calculated = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return safeEqual(calculated, received.toLowerCase());
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { cookies[key] = decodeURIComponent(value); } catch { /* ignore malformed cookie */ }
  }
  return cookies;
}

function encryptionKey() {
  // Uses the app secret as key material; rotating SHOPIFY_API_SECRET requires token re-encryption.
  return crypto.createHash("sha256")
    .update("chachaprime-token-encryption-v1:")
    .update(requiredEnv("SHOPIFY_API_SECRET"))
    .digest();
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

function decryptToken(payload) {
  const [version, ivText, tagText, dataText] = String(payload || "").split(".");
  if (version !== "v1" || !ivText || !tagText || !dataText) throw new Error("Invalid encrypted token format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64")), decipher.final()]).toString("utf8");
}

function verifyWebhook(req) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const received = req.get("X-Shopify-Hmac-Sha256");
  if (!secret || !received || !req.rawBody) return false;
  const calculated = crypto.createHmac("sha256", secret).update(req.rawBody).digest("base64");
  return safeEqual(calculated, received);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.use(express.static(path.join(__dirname, "public"), { index: false, dotfiles: "deny", maxAge: "1h" }));

app.get("/", (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  return res.redirect(302, "/admin" + (query ? "?" + query : ""));
});

app.get("/admin", (_req, res) => {
  const html = fs.readFileSync(path.join(__dirname, "public", "admin.html"), "utf8");
  const apiKey = String(process.env.SHOPIFY_API_KEY || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  res.type("html").send(html.replace('<meta name="shopify-api-key" content="">',
    '<meta name="shopify-api-key" content="' + apiKey + '">'));
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "chachaprime-group-buying", version: "0.4.0" });
});

app.get("/ready", asyncRoute(async (_req, res) => {
  await getDatabase().query("SELECT 1");
  res.status(200).json({ ok: true, database: "connected" });
}));

// Start Shopify OAuth installation from Shopify's app installation URL.
app.get("/auth", asyncRoute(async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  if (!shop) return res.status(400).send("A valid *.myshopify.com shop domain is required.");

  const apiKey = requiredEnv("SHOPIFY_API_KEY");
  requiredEnv("SHOPIFY_API_SECRET");
  const appUrl = requiredEnv("SHOPIFY_APP_URL").replace(/\/$/, "");
  const scopes = (process.env.SHOPIFY_SCOPES || "read_products,read_orders,write_orders")
    .split(",").map((scope) => scope.trim()).filter(Boolean).join(",");
  const state = crypto.randomBytes(32).toString("hex");

  res.cookie("cp_oauth_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 10 * 60 * 1000,
  });
  const target = new URL(`https://${shop}/admin/oauth/authorize`);
  target.searchParams.set("client_id", apiKey);
  target.searchParams.set("scope", scopes);
  target.searchParams.set("redirect_uri", `${appUrl}/auth/callback`);
  target.searchParams.set("state", state);
  return res.redirect(302, target.toString());
}));

async function registerWebhookSubscriptions(shop, accessToken) {
  const appUrl = requiredEnv("SHOPIFY_APP_URL").replace(/\\/$/, "");
  const topics = [
    "ORDERS_PAID",
    "REFUNDS_CREATE",
    "APP_UNINSTALLED",
    "CUSTOMERS_DATA_REQUEST",
    "CUSTOMERS_REDACT",
    "SHOP_REDACT",
  ];
  const paths = {
    ORDERS_PAID: "orders/paid",
    REFUNDS_CREATE: "refunds/create",
    APP_UNINSTALLED: "app/uninstalled",
    CUSTOMERS_DATA_REQUEST: "customers/data_request",
    CUSTOMERS_REDACT: "customers/redact",
    SHOP_REDACT: "shop/redact",
  };
  const endpoint = "https://" + shop + "/admin/api/2026-07/graphql.json";
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
    Accept: "application/json",
  };
  const existingResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: "query ExistingWebhooks { webhookSubscriptions(first: 100) { nodes { id topic callbackUrl } } }",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!existingResponse.ok) throw new Error("Could not inspect Shopify webhook subscriptions");
  const existingData = await existingResponse.json();
  if (existingData.errors?.length) throw new Error("Could not inspect Shopify webhook subscriptions");
  const existing = existingData.data?.webhookSubscriptions?.nodes || [];
  const errors = [];

  for (const topic of topics) {
    const callbackUrl = appUrl + "/webhooks/" + paths[topic];
    const found = existing.some((item) => item.topic === topic && item.callbackUrl === callbackUrl);
    if (found) continue;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: "mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) { userErrors { field message } webhookSubscription { id topic callbackUrl } } }",
        variables: { topic, input: { callbackUrl, format: "JSON" } },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      errors.push(topic + ": HTTP " + response.status);
      continue;
    }
    const result = await response.json();
    const userErrors = result.data?.webhookSubscriptionCreate?.userErrors || [];
    if (result.errors?.length || userErrors.length) {
      errors.push(topic + ": " + (userErrors.map((item) => item.message).join("; ") || "GraphQL error"));
    }
  }
  return errors;
}

app.get("/auth/callback", asyncRoute(async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  if (!shop || !verifyQueryHmac(req.query, requiredEnv("SHOPIFY_API_SECRET"))) {
    return res.status(400).send("Shopify callback signature is invalid.");
  }
  const stateCookie = parseCookies(req.headers.cookie).cp_oauth_state;
  res.clearCookie("cp_oauth_state", { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  if (!stateCookie || !safeEqual(stateCookie, req.query.state)) {
    return res.status(400).send("OAuth state validation failed. Please retry installation.");
  }
  if (typeof req.query.code !== "string" || req.query.code.length > 512) {
    return res.status(400).send("Shopify authorization code is missing.");
  }

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: requiredEnv("SHOPIFY_API_KEY"),
      client_secret: requiredEnv("SHOPIFY_API_SECRET"),
      code: req.query.code,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    console.error("Shopify token exchange failed with HTTP", response.status);
    return res.status(502).send("Shopify authorization could not be completed. Please retry.");
  }
  const tokenData = await response.json();
  if (typeof tokenData.access_token !== "string" || !tokenData.access_token) {
    return res.status(502).send("Shopify did not return an access token.");
  }

  await getDatabase().execute(
    `INSERT INTO shop_installations (shop_domain, access_token_encrypted, scopes)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE access_token_encrypted = VALUES(access_token_encrypted),
       scopes = VALUES(scopes), updated_at = CURRENT_TIMESTAMP`,
    [shop, encryptToken(tokenData.access_token), tokenData.scope || process.env.SHOPIFY_SCOPES || ""],
  );
  let webhookWarning = "";
  try {
    const webhookErrors = await registerWebhookSubscriptions(shop, tokenData.access_token);
    if (webhookErrors.length) {
      webhookWarning = " Installation succeeded, but some webhook subscriptions need attention: " + webhookErrors.join(" | ");
      console.error("Shopify webhook subscription setup issues for", shop, webhookErrors);
    }
  } catch (error) {
    webhookWarning = " Installation succeeded, but webhook subscriptions could not be verified. Check the app's webhook settings.";
    console.error("Shopify webhook registration failed for", shop, error.message);
  }
  console.info("Shopify app installed for", shop);
  return res.status(200).send("ChachaPrime app connected successfully. You may close this page." + webhookWarning);
}));

// Shopify webhook endpoints must be configured in the Shopify Partner/Dev Dashboard.
app.post("/webhooks/*", asyncRoute(async (req, res) => {
  if (!verifyWebhook(req)) return res.status(401).json({ error: "Invalid webhook signature" });

  const shop = normalizeShop(req.get("X-Shopify-Shop-Domain"));
  const topic = String(req.get("X-Shopify-Topic") || req.params.topic || "").toLowerCase();
  const webhookId = req.get("X-Shopify-Webhook-Id");
  if (!shop || !webhookId || webhookId.length > 128) {
    return res.status(400).json({ error: "Invalid webhook headers" });
  }

  const connection = await getDatabase().getConnection();
  try {
    await connection.beginTransaction();
    const [eventResult] = await connection.execute(
      "INSERT IGNORE INTO shopify_webhook_events (shop_domain, webhook_id, topic) VALUES (?, ?, ?)",
      [shop, webhookId, topic],
    );
    if (eventResult.affectedRows === 0) {
      await connection.commit();
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const payload = req.body || {};
    if (topic === "orders/paid") {
      const orderId = String(payload.admin_graphql_api_id || payload.id || "");
      const orderCurrency = String(payload.currency || "USD").toUpperCase().slice(0, 3);
      const rawLineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
      const groupedItems = new Map();
      for (const rawItem of rawLineItems) {
        const productId = String(rawItem.product_id || "");
        const quantity = Math.max(0, Math.floor(Number(rawItem.quantity) || 0));
        if (!productId || !quantity) continue;
        const unitPrice = Number(rawItem.price);
        const entry = groupedItems.get(productId) || { product_id: productId, quantity: 0, totalAmount: 0 };
        entry.quantity += quantity;
        entry.totalAmount += (Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0) * quantity;
        groupedItems.set(productId, entry);
      }
      const lineItems = Array.from(groupedItems.values(), (item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        price: item.quantity ? item.totalAmount / item.quantity : 0,
      }));

      for (const item of lineItems) {
        const productId = String(item.product_id || "");
        const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
        if (!productId || !quantity || !orderId) continue;

        const [deals] = await connection.execute(
          `SELECT id, group_price, currency, pricing_mode FROM group_deals
           WHERE shop_domain = ? AND shopify_product_id = ? AND status = 'active'
             AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
             AND ends_at > UTC_TIMESTAMP()
           ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
          [shop, productId],
        );
        for (const deal of deals) {
          const linePrice = Number(item.price || deal.group_price);
          const [memberResult] = await connection.execute(
            `INSERT IGNORE INTO group_members
             (deal_id, shopify_customer_id, shopify_order_id, quantity, counted_quantity, amount, currency, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'paid')`,
            [deal.id, payload.customer?.id ? String(payload.customer.id) : null, orderId, quantity,
              deal.pricing_mode === "per_buyer" ? 1 : quantity,
              Number.isFinite(linePrice) ? linePrice * quantity : Number(deal.group_price) * quantity,
              orderCurrency || deal.currency || "USD"],
          );
          if (memberResult.affectedRows > 0) {
            await connection.execute(
              "UPDATE group_deals SET current_quantity = current_quantity + ? WHERE id = ?",
              [deal.pricing_mode === "per_buyer" ? 1 : quantity, deal.id],
            );
          }
        }
      }
      // Lock in success once the target has been met; the transaction makes this atomic
      // with the order event's member and quantity updates.
      await connection.execute(
        "UPDATE group_deals SET status = 'successful' WHERE shop_domain = ? AND status = 'active' AND current_quantity >= target_quantity",
        [shop],
      );
    } else if (topic === "refunds/create") {
      const orderId = String(payload.order_id || "");
      const refundedItems = Array.isArray(payload.refund_line_items) ? payload.refund_line_items : [];
      if (orderId && refundedItems.length) {
        for (const refundItem of refundedItems) {
          const productId = String(refundItem.line_item?.product_id || "");
          const refundQuantity = Math.max(0, Math.floor(Number(refundItem.quantity) || 0));
          if (!productId || !refundQuantity) continue;
          const [deals] = await connection.execute(
            "SELECT gd.id, gd.pricing_mode FROM group_deals gd WHERE gd.shop_domain = ? AND gd.shopify_product_id = ? AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.deal_id = gd.id AND gm.shopify_order_id = ?)",
            [shop, productId, orderId],
          );
          for (const deal of deals) {
            const [members] = await connection.execute(
              "SELECT id, deal_id, quantity, counted_quantity, refunded_quantity FROM group_members WHERE deal_id = ? AND shopify_order_id = ? AND status IN ('paid','refunded') FOR UPDATE",
              [deal.id, orderId],
            );
            for (const member of members) {
              const remaining = Math.max(0, Number(member.quantity) - Number(member.refunded_quantity || 0));
              const toRefund = Math.min(remaining, refundQuantity);
              if (!toRefund) continue;
              const nextRefunded = Number(member.refunded_quantity || 0) + toRefund;
              const nextStatus = nextRefunded >= Number(member.quantity) ? "refunded" : "paid";
              const contributionToRemove = deal.pricing_mode === "per_buyer"
                ? (nextRefunded >= Number(member.quantity) ? Number(member.counted_quantity || 0) : 0)
                : toRefund;
              await connection.execute(
                "UPDATE group_members SET refunded_quantity = ?, counted_quantity = GREATEST(0, counted_quantity - ?), status = ? WHERE id = ?",
                [nextRefunded, contributionToRemove, nextStatus, member.id],
              );
              await connection.execute(
                "UPDATE group_deals SET current_quantity = GREATEST(0, current_quantity - ?) WHERE id = ?",
                [contributionToRemove, member.deal_id],
              );
              break;
            }
          }
        }
      }
    } else if (topic === "customers/redact") {
      const customerId = payload.customer?.id ? String(payload.customer.id) : "";
      if (customerId) {
        await connection.execute(
          "DELETE FROM group_members WHERE shopify_customer_id = ? AND deal_id IN (SELECT id FROM group_deals WHERE shop_domain = ?)",
          [customerId, shop],
        );
      }
    } else if (topic === "customers/data_request") {
      // Acknowledge the verified request. Customer identifiers are not exposed by public APIs.
      console.info("Received verified customer data request for", shop);
    } else if (topic === "shop/redact") {
      await connection.execute(
        "DELETE FROM group_members WHERE deal_id IN (SELECT id FROM group_deals WHERE shop_domain = ?)",
        [shop],
      );
      await connection.execute("DELETE FROM group_deals WHERE shop_domain = ?", [shop]);
      await connection.execute("DELETE FROM shop_installations WHERE shop_domain = ?", [shop]);
      await connection.execute("DELETE FROM shopify_webhook_events WHERE shop_domain = ?", [shop]);
    } else if (topic === "app/uninstalled") {
      await connection.execute(
        "UPDATE group_deals SET status = 'cancelled' WHERE shop_domain = ? AND status IN ('draft','scheduled','active')",
        [shop],
      );
      await connection.execute(
        "DELETE FROM shop_installations WHERE shop_domain = ?",
        [shop],
      );
    }

    await connection.commit();
    return res.status(200).json({ ok: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));


async function shopifyGraphql(shop, query, variables = {}) {
  const [rows] = await getDatabase().execute(
    "SELECT access_token_encrypted FROM shop_installations WHERE shop_domain = ? LIMIT 1",
    [shop],
  );
  if (!rows.length || !rows[0].access_token_encrypted) {
    const error = new Error("Shop is not installed");
    error.code = "SHOP_NOT_INSTALLED";
    throw error;
  }
  const accessToken = decryptToken(rows[0].access_token_encrypted);
  const response = await fetch("https://" + shop + "/admin/api/2026-07/graphql.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new Error("Shopify Admin API request failed");
    error.code = "SHOPIFY_API_ERROR";
    throw error;
  }
  const result = await response.json();
  if (Array.isArray(result.errors) && result.errors.length) {
    const error = new Error("Shopify Admin API returned GraphQL errors");
    error.code = "SHOPIFY_GRAPHQL_ERROR";
    throw error;
  }
  return result.data;
}

app.use("/api/admin", createAdminRouter({ getDatabase, shopifyGraphql }));

async function refreshDealStatuses() {
  const database = getDatabase();
  await database.execute(
    "UPDATE group_deals SET status = 'active' WHERE status = 'scheduled' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP()) AND ends_at > UTC_TIMESTAMP()",
  );
  await database.execute(
    "UPDATE group_deals SET status = 'successful' WHERE status = 'active' AND current_quantity >= target_quantity",
  );
  await database.execute(
    "UPDATE group_deals SET status = CASE WHEN current_quantity >= target_quantity THEN 'successful' ELSE 'failed' END WHERE status IN ('active','scheduled') AND ends_at <= UTC_TIMESTAMP()",
  );
}

app.get("/api/deals", asyncRoute(async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  if (!shop) return res.status(400).json({ error: "A valid shop query parameter is required" });
  await refreshDealStatuses();
  const [deals] = await getDatabase().execute(
    `SELECT id, title, shopify_product_id, shopify_product_handle, status, pricing_mode,
            target_quantity, current_quantity, retail_price, wholesale_price,
            group_price, currency, starts_at, ends_at, created_at
     FROM group_deals
     WHERE shop_domain = ? AND status = 'active'
       AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
       AND ends_at > UTC_TIMESTAMP()
     ORDER BY ends_at ASC
     LIMIT 100`,
    [shop],
  );
  res.set("Cache-Control", "no-store");
  return res.status(200).json({ deals });
}));

app.get("/api/deals/:id", asyncRoute(async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  if (!shop) return res.status(400).json({ error: "A valid shop query parameter is required" });
  await refreshDealStatuses();
  if (!/^[1-9]\d{0,19}$/.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid deal id" });
  }
  const [deals] = await getDatabase().execute(
    `SELECT id, title, shopify_product_id, shopify_product_handle, status, pricing_mode,
            target_quantity, current_quantity, retail_price, wholesale_price,
            group_price, currency, starts_at, ends_at, created_at
     FROM group_deals
     WHERE id = ? AND shop_domain = ? AND status = 'active'
       AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
       AND ends_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [req.params.id, shop],
  );
  if (!deals.length) return res.status(404).json({ error: "Deal not found" });
  res.set("Cache-Control", "no-store");
  return res.status(200).json({ deal: deals[0] });
}));

app.use((err, _req, res, _next) => {
  console.error("Request failed:", err.code || "UNEXPECTED_ERROR", err.message);
  if (err.code === "DATABASE_CONFIG_MISSING" || err.code === "APP_CONFIG_MISSING") {
    return res.status(503).json({ error: "Service is not configured yet" });
  }
  return res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
app.listen(port, "0.0.0.0", () => console.log("ChachaPrime API listening on", port));

if (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER) {
  const dealStatusTimer = setInterval(() => {
    refreshDealStatuses().catch((error) => {
      console.error("Scheduled deal status refresh failed:", error.code || error.message);
    });
  }, 60_000);
  dealStatusTimer.unref();
}
