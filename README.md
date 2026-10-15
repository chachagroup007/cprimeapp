# ChachaPrime Group Buying App

Node.js/Express backend and embedded administration starter for the ChachaPrime Shopify group-buying workflow.

## Current features

- Process health and database readiness endpoints
- Store-scoped public deal listing and single-deal API
- Shopify OAuth installation with HMAC and state validation
- Encrypted offline access-token storage in MySQL
- Embedded admin dashboard shell using Shopify App Bridge
- Protected admin API for listing, creating, activating, scheduling, and cancelling deals
- Product validation against the Shopify Admin GraphQL API before a deal is created
- Verified, deduplicated Shopify webhook handling for paid orders, refunds, app uninstall, and privacy requests
- Partial-refund quantity tracking and deal target/expiry status refresh
- Automated token-validation tests and GitHub Actions syntax/test workflow

## Required environment variables

See `.env.example`. Never commit a real `.env` file or paste secrets into issues/chat.

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: Hostinger MySQL connection.
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`: credentials for the Shopify app.
- `SHOPIFY_APP_URL`: app base URL, e.g. `https://app.chachaprime.com`.
- `SHOPIFY_SCOPES`: `read_products,read_orders` for the current implementation.
- `ALLOWED_ORIGINS`: exact storefront origins allowed by browser CORS.
- `SHOPIFY_STORE_DOMAIN`: default store domain for setup/reference; OAuth validates each installation's shop domain separately.

## Shopify app setup

1. Set the app URL to `https://app.chachaprime.com` and the embedded app path to `/admin`.
2. Add the allowed redirect URL `https://app.chachaprime.com/auth/callback`.
3. Configure app scopes to match `SHOPIFY_SCOPES`.
4. The OAuth callback attempts to register these webhook topics automatically: `orders/paid`, `refunds/create`, `app/uninstalled`, `customers/data_request`, `customers/redact`, and `shop/redact`. Review the Shopify app webhook settings after installation and resolve any registration warnings.
5. Run `database/schema.sql` against the Hostinger database before using the app.
6. Run `npm ci`, `npm run check`, and `npm test` before deploying.

The OAuth callback attempts to register subscriptions, but API or permission errors can prevent some topics from being created. Verify all topics and callback URLs in Shopify before testing orders.

## API overview

### Public
- `GET /health` — process health only.
- `GET /ready` — verifies database connectivity.
- `GET /api/deals?shop=your-store.myshopify.com` — list active deals for one store.
- `GET /api/deals/:id?shop=your-store.myshopify.com` — fetch one active deal for that store.

### Shopify installation
- `GET /auth?shop=your-store.myshopify.com` — begin OAuth.
- `GET /auth/callback` — validates HMAC and state, exchanges code, and stores an encrypted offline token.
- `GET /admin?shop=your-store.myshopify.com&host=...` — embedded admin UI; must be opened inside Shopify Admin.

### Shopify webhooks
- `POST /webhooks/orders/paid`
- `POST /webhooks/refunds/create`
- `POST /webhooks/app/uninstalled`
- `POST /webhooks/customers/data_request`
- `POST /webhooks/customers/redact`
- `POST /webhooks/shop/redact`

Webhook requests must include valid Shopify HMAC and webhook headers. Confirm the subscriptions are present in Shopify after installation.

### Protected admin API
Send a short-lived Shopify App Bridge session token as `Authorization: Bearer <session-token>`.
- `GET /api/admin/deals`
- `POST /api/admin/deals`
- `PATCH /api/admin/deals/:id/status`

## Remaining production work

This is not yet certified or verified as production-ready. Before a live store uses it, test the complete install, embedded admin, webhook, checkout, refund, privacy, and uninstall flows in a Shopify development store. Additional work may include Shopify billing (if monetized), robust partial-refund reconciliation for complex multi-line orders, scheduled background jobs independent of storefront traffic, race-condition and integration tests, monitoring, backups, and review of Shopify's current app distribution and compliance requirements.

Access tokens are encrypted using key material derived from `SHOPIFY_API_SECRET`; rotating that secret requires a planned token re-encryption/reinstallation procedure. Keep database backups and all secrets in hosting environment settings, never in GitHub.
