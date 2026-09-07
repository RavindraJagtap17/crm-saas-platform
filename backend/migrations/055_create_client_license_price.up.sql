-- The ONE global price an Agency pays per Client added (new business
-- model) — Super Admin sets/updates it, exactly mirroring
-- agency_subscription_plan's own singleton pattern (migration 041):
-- singleton_guard's UNIQUE key makes a second row a constraint violation
-- rather than an application-only convention.
--
-- Deliberately a NEW, separate table from agency_subscription_plan rather
-- than repurposing it — that table (and the flat "one Agency plan, pay
-- yearly to use the CRM at all" model it represents) is scheduled for
-- removal in a later step; this table must not depend on or be entangled
-- with something being deleted.
--
-- No billing_cycle column: unlike the old Agency plan, a Client license's
-- term is fixed at exactly one year by business rule, not configurable.
-- No row is inserted by this migration — the actual price is a Super
-- Admin business decision to be set later via its own endpoint, never
-- invented here (same reasoning as migration 041's own header comment).
CREATE TABLE client_license_price (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  singleton_guard  TINYINT UNSIGNED NOT NULL DEFAULT 1,
  -- Smallest currency unit, matching every other price column in this schema.
  price            BIGINT UNSIGNED NOT NULL,
  currency         VARCHAR(3) NOT NULL DEFAULT 'INR',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_client_license_price_singleton (singleton_guard)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
