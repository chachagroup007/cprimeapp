# ChachaPrime Group Buying App

Node.js/Express backend for the ChachaPrime Shopify group-buying workflow.

## Current features

- Health endpoint: `GET /health`
- Database readiness endpoint: `GET /ready`
- Public active-deal endpoints: `GET /api/deals` and `GET /api/deals/:id`
- Shopify OAuth installation callback with HMAC and state validation
- Encrypted offline Shopify access-token storage in MySQL
- Verified Shopify webhook endpoint with event deduplication
- Initial order-paid/refund webhook processing for matching group deals
- Protected Shopify session-token API for listing, creating, and changing deal status
- Automated tests for Shopify session token validation
- CI workflow runs syntax checks and tests

## Required environment variables

See `.env.example`. Never commit a real `.env` file or paste secrets into issues/chat.

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: Hostinger MySQL connection.
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`: credentials for the Shopify app.
- `SHOPIFY_APP_URL`: app base URL, e.g. `https://app.chachaprime.com`.
- `SHOPIFY_SCOPES`: start with `read_products,read_orders` for the current implementation.
- `ALLOWED_ORIGINS`: exact storefront origins allowed by browser CORS.
- `SHOPIFY_STORE_DOMAIN`: default store domain for setup/reference; each OAuth installation validates the shop domain separately.

## Shopify app setup

1. Set the app URL to `https://app.chachaprime.com`.
2. Add the allowed redirect URL `https://app.chachaprime.com/auth/callback`.
3. Configure the app's OAuth scopes to match `SHOPIFY_SCOPES`.
4. Configure webhook subscriptions that point to `https://app.chachaprime.com/webhooks/orders/paid`, `https://app.chachaprime.com/webhooks/refunds/create`, and `https://app.chachaprime.com/webhooks/app/uninstalled`.
5. Run `database/schema.sql` against the Hostinger database before using the app.
6. Run `npm ci`, `npm run check`, and `npm test` before deploying.

## API overview

### Public
- `GET /health` — process health only; does not prove database connectivity.
- `GET /ready` — verifies database connectivity.
- `GET /api/deals` — list active, in-window deals.
- `GET /api/deals/:id` — fetch one active, in-window deal.

### Shopify installation
- `GET /auth?shop=your-store.myshopify.com` — begin OAuth.
- `GET /auth/callback` — validates HMAC and state, exchanges code, and stores an encrypted offline token.

### Shopify webhooks
- `POST /webhooks/orders/paid`
- `POST /webhooks/refunds/create`
- `POST /webhooks/app/uninstalled`

Webhook requests must include valid Shopify HMAC and webhook headers. Configure subscriptions in Shopify; creating these routes does not subscribe the app automatically.

### Protected admin API
Send a short-lived Shopify App Bridge session token as `Authorization: Bearer <session-token>`.
- `GET /api/admin/deals`
- `POST /api/admin/deals`
- `PATCH /api/admin/deals/:id/status`

## Important limitations before production

This repository is an evolving integration and must be tested in a Shopify development store before live use. The current code does not yet provide a complete embedded Admin UI/App Bridge frontend, automated webhook subscription registration, automatic deal-expiry/target-quantity transitions, full refund/partial-refund reconciliation, full end-to-end order placement, billing, privacy-compliance webhooks, or a comprehensive authorization/integration test suite. Do not represent it as production-ready until these items are implemented and verified.

Access tokens are encrypted using key material derived from `SHOPIFY_API_SECRET`; rotating that secret requires a planned token re-encryption/reinstallation procedure. Keep backups of the database and keep all secrets in the hosting environment, never in GitHub.
