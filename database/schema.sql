CREATE TABLE IF NOT EXISTS group_deals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shop_domain VARCHAR(255) NOT NULL,
  shopify_product_id VARCHAR(64) NOT NULL,
  shopify_product_handle VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status ENUM('draft','scheduled','active','successful','failed','cancelled') NOT NULL DEFAULT 'draft',
  pricing_mode ENUM('per_buyer','per_unit') NOT NULL DEFAULT 'per_buyer',
  target_quantity INT UNSIGNED NOT NULL,
  current_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  retail_price DECIMAL(12,2) NULL,
  wholesale_price DECIMAL(12,2) NULL,
  group_price DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  starts_at DATETIME NULL,
  ends_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_deals_shop_status(shop_domain,status),
  INDEX idx_deals_ends_at(ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS group_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  deal_id BIGINT UNSIGNED NOT NULL,
  shopify_customer_id VARCHAR(64) NULL,
  shopify_order_id VARCHAR(64) NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  refunded_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status ENUM('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_deal_order(deal_id,shopify_order_id),
  INDEX idx_members_deal_status(deal_id,status),
  CONSTRAINT fk_members_deal FOREIGN KEY(deal_id) REFERENCES group_deals(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shop_installations (
  shop_domain VARCHAR(255) NOT NULL PRIMARY KEY,
  access_token_encrypted TEXT NULL,
  scopes TEXT NULL,
  installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shopify_webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shop_domain VARCHAR(255) NOT NULL,
  webhook_id VARCHAR(128) NOT NULL,
  topic VARCHAR(128) NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shopify_webhook(shop_domain, webhook_id),
  INDEX idx_webhook_topic(topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
