const express = require("express");
const { requireShopifySession } = require("../lib/shopify-security");

function createAdminRouter({ getDatabase, shopifyGraphql }) {
  const router = express.Router();

  router.get("/deals", requireShopifySession, async (req, res, next) => {
    try {
      const [deals] = await getDatabase().execute(
        `SELECT id, shopify_product_id, title, status, pricing_mode, target_quantity,
                current_quantity, retail_price, wholesale_price, group_price, currency,
                starts_at, ends_at, created_at, updated_at
         FROM group_deals WHERE shop_domain = ? ORDER BY created_at DESC LIMIT 200`,
        [req.shopifySession.shop],
      );
      res.json({ deals });
    } catch (error) { next(error); }
  });

  router.post("/deals", requireShopifySession, async (req, res, next) => {
    try {
      const body = req.body || {};
      const productId = String(body.shopify_product_id || "").trim();
      const target = Number(body.target_quantity);
      const price = Number(body.group_price);
      const endsAt = new Date(body.ends_at || "");
      const currency = String(body.currency || "USD").toUpperCase();

      if (!/^(?:\d{1,20}|gid:\/\/shopify\/Product\/\d{1,20})$/.test(productId))
        return res.status(400).json({ error: "A valid Shopify product ID is required" });
      if (!Number.isSafeInteger(target) || target < 1 || target > 100000000)
        return res.status(400).json({ error: "target_quantity must be a positive whole number" });
      if (!Number.isFinite(price) || price <= 0 || price > 1000000000)
        return res.status(400).json({ error: "group_price must be greater than zero" });
      if (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= Date.now())
        return res.status(400).json({ error: "ends_at must be a future date" });
      if (!/^[A-Z]{3}$/.test(currency))
        return res.status(400).json({ error: "currency must be a three-letter currency code" });

      const gid = productId.startsWith("gid://") ? productId : "gid://shopify/Product/" + productId;
      const data = await shopifyGraphql(req.shopifySession.shop,
        "query ProductForDeal($id: ID!) { product(id: $id) { id title handle status } }", { id: gid });
      const product = data && data.product;
      if (!product || product.status === "ARCHIVED")
        return res.status(404).json({ error: "Shopify product not found or archived" });

      const title = String(body.title || product.title).trim().slice(0, 255);
      const startsAt = body.starts_at ? new Date(body.starts_at) : null;
      if (body.starts_at && (!Number.isFinite(startsAt.getTime()) || startsAt >= endsAt))
        return res.status(400).json({ error: "starts_at must be before ends_at" });

      const [insert] = await getDatabase().execute(
        `INSERT INTO group_deals
         (shop_domain, shopify_product_id, shopify_product_handle, title, status, pricing_mode, target_quantity,
          current_quantity, group_price, currency, starts_at, ends_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?, ?, ?)`,
        [req.shopifySession.shop, String(product.id.split("/").pop()), String(product.handle), title,
          body.pricing_mode === "per_unit" ? "per_unit" : "per_buyer", target,
          price.toFixed(2), currency,
          startsAt ? startsAt.toISOString().slice(0, 19).replace("T", " ") : null,
          endsAt.toISOString().slice(0, 19).replace("T", " ")],
      );
      return res.status(201).json({ ok: true, id: insert.insertId, status: "draft" });
    } catch (error) { next(error); }
  });

  router.patch("/deals/:id/status", requireShopifySession, async (req, res, next) => {
    const id = req.params.id;
    const status = String(req.body && req.body.status || "");
    if (!/^[1-9]\d{0,19}$/.test(id))
      return res.status(400).json({ error: "Invalid deal id" });
    if (!["scheduled", "active", "cancelled"].includes(status))
      return res.status(400).json({ error: "Allowed status values: scheduled, active, cancelled" });

    let connection;
    try {
      connection = await getDatabase().getConnection();
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        "SELECT id, shopify_product_id, status, starts_at, ends_at FROM group_deals WHERE id = ? AND shop_domain = ? FOR UPDATE",
        [id, req.shopifySession.shop],
      );
      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Deal not found" });
      }
      const deal = rows[0];
      const now = Date.now();
      const starts = deal.starts_at ? new Date(deal.starts_at).getTime() : null;
      const ends = new Date(deal.ends_at).getTime();
      const allowed =
        (deal.status === "draft" && ["scheduled", "active", "cancelled"].includes(status)) ||
        (deal.status === "scheduled" && ["active", "cancelled"].includes(status)) ||
        (deal.status === "active" && status === "cancelled");
      if (!allowed) {
        await connection.rollback();
        return res.status(409).json({ error: "This deal status transition is not allowed" });
      }
      if (status === "active") {
        const [existing] = await connection.execute(
          "SELECT id FROM group_deals WHERE shop_domain = ? AND shopify_product_id = ? AND status = 'active' AND id <> ? LIMIT 1 FOR UPDATE",
          [req.shopifySession.shop, deal.shopify_product_id, id],
        );
        if (existing.length) {
          await connection.rollback();
          return res.status(409).json({ error: "Another active deal already exists for this product" });
        }
      }
      if (status === "active" && ((starts !== null && starts > now) || ends <= now)) {
        await connection.rollback();
        return res.status(400).json({ error: "Deal dates do not allow activation yet" });
      }
      if (status === "scheduled" && starts === null) {
        await connection.rollback();
        return res.status(400).json({ error: "Set starts_at before scheduling a deal" });
      }
      await connection.execute("UPDATE group_deals SET status = ? WHERE id = ?", [status, id]);
      await connection.commit();
      return res.json({ ok: true, id: Number(id), status });
    } catch (error) {
      if (connection) await connection.rollback();
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  return router;
}

module.exports = createAdminRouter;
