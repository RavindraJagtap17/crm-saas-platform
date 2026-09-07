-- New business model: there is no Client<->Agency subscription any more
-- (client_subscription_plans/client_subscriptions, migrations 043/044,
-- are scheduled for removal in a later step). Instead, the AGENCY pays
-- the PLATFORM once per Client added, valid for exactly one year, paid
-- through the platform's own Razorpay account (never a per-Agency
-- connected account). One row per Client, updated in place across its
-- lifecycle — the same "one row per X" shape as client_subscriptions
-- (uq_client_subscriptions_client) and agency_subscriptions
-- (uq_agency_subscriptions_tenant), but deliberately simpler: no plan_id
-- (there is only ONE global price — see client_license_price, migration
-- 055), no upgrade/downgrade, no grace period (a lapsed license locks
-- that Client's workspace immediately — the business rule is "renew or
-- it's locked", not a soft grace window).
--
-- tenant_id is redundant with clients.tenant_id but kept in place,
-- exactly like client_subscriptions.tenant_id (044) and payments.tenant_id
-- (020) before it — required so fk_client_licenses_tenant_client can be
-- the composite (tenant_id, client_id) -> (tenant_id, id) pattern used
-- throughout this schema, making it structurally impossible for a
-- license to reference another agency's client.
CREATE TABLE client_licenses (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id            BIGINT UNSIGNED NOT NULL,
  client_id            BIGINT UNSIGNED NOT NULL,
  -- Smallest currency unit, matching every other price column in this
  -- schema (subscription_plans.price etc.) — a snapshot of what was
  -- actually paid at purchase/renewal time, not a live reference to
  -- client_license_price.price (so a later Super Admin price change can
  -- never silently alter what an already-active license was charged).
  price                BIGINT UNSIGNED NOT NULL,
  currency             VARCHAR(3) NOT NULL DEFAULT 'INR',
  -- pending: Order created, awaiting payment confirmation (Client stays
  -- locked). active: paid, current_period_end in the future. expired:
  -- current_period_end has passed with no renewal — locks the Client.
  status               ENUM('pending', 'active', 'expired') NOT NULL DEFAULT 'pending',
  razorpay_order_id    VARCHAR(64) NULL,
  razorpay_payment_id  VARCHAR(64) NULL,
  current_period_end   TIMESTAMP NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- "One license per Client" — enforced at the database level exactly
  -- like uq_client_subscriptions_client does today.
  UNIQUE KEY uq_client_licenses_client (client_id),
  UNIQUE KEY uq_client_licenses_razorpay_order_id (razorpay_order_id),
  -- Exposed for the same reason every other tenant-owned table in this
  -- schema exposes it: lets a future tenant-owned child table target this
  -- row via the established composite-FK pattern.
  UNIQUE KEY uq_client_licenses_tenant_id_id (tenant_id, id),
  KEY idx_client_licenses_tenant (tenant_id),

  CONSTRAINT fk_client_licenses_tenant_client FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients(tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
