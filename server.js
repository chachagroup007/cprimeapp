require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.disable("x-powered-by");
app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (health checks, server-to-server requests).
      if (!origin) return callback(null, true);
      return callback(null, allowedOrigins.includes(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "256kb" }));

let pool;

function getDatabase() {
  const required = ["DB_HOST", "DB_NAME", "DB_USER"];
  const missing = required.filter((key) => !process.env[key]);
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

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "chachaprime-group-buying",
    version: "0.2.0",
  });
});

app.get(
  "/ready",
  asyncRoute(async (_req, res) => {
    await getDatabase().query("SELECT 1");
    res.status(200).json({ ok: true, database: "connected" });
  }),
);

// Public storefront API: do not expose drafts or deals outside their live window.
app.get(
  "/api/deals",
  asyncRoute(async (_req, res) => {
    const [deals] = await getDatabase().execute(
      `SELECT id, title, shopify_product_id, status, pricing_mode,
              target_quantity, current_quantity, retail_price, wholesale_price,
              group_price, currency, starts_at, ends_at, created_at
       FROM group_deals
       WHERE status = 'active'
         AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
         AND ends_at > UTC_TIMESTAMP()
       ORDER BY ends_at ASC
       LIMIT 100`,
    );

    res.set("Cache-Control", "no-store");
    res.status(200).json({ deals });
  }),
);

app.get(
  "/api/deals/:id",
  asyncRoute(async (req, res) => {
    if (!/^[1-9]\d{0,19}$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid deal id" });
    }

    const [deals] = await getDatabase().execute(
      `SELECT id, title, shopify_product_id, status, pricing_mode,
              target_quantity, current_quantity, retail_price, wholesale_price,
              group_price, currency, starts_at, ends_at, created_at
       FROM group_deals
       WHERE id = ?
         AND status = 'active'
         AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
         AND ends_at > UTC_TIMESTAMP()
       LIMIT 1`,
      [req.params.id],
    );

    if (!deals.length) return res.status(404).json({ error: "Deal not found" });
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ deal: deals[0] });
  }),
);

app.use((err, _req, res, _next) => {
  // Keep details in server logs only; never return database/secret details to clients.
  console.error("Request failed:", err.code || "UNEXPECTED_ERROR", err.message);
  if (err.code === "DATABASE_CONFIG_MISSING") {
    return res.status(503).json({ error: "Service is not configured yet" });
  }
  return res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

app.listen(port, "0.0.0.0", () => {
  console.log("ChachaPrime API listening on", port);
});
