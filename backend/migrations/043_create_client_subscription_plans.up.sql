-- B2B2C subscription redesign: Agency-scoped Client plan catalog — each
-- agency manages its OWN set of plans for its clients to choose from
-- ("Agency Admin creates and manages Client subscription plans... can
-- create both monthly and yearly Client plans... decides each plan's
-- price and maximum active-employee limit"). Shaped after the existing
-- subscription_plans (018) but tenant-scoped (that table is global/flat)
-- and without a razorpay_plan_id — the Client-side Razorpay integration
-- mechanism (Route vs. per-connected-account Orders/Subscriptions) is an
-- open design question left for a later step; nothing here presumes a
-- particular mechanism.
CREATE TABLE client_subscription_plans (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id             BIGINT UNSIGNED NOT NULL,
  name                  VARCHAR(255) NOT NULL,
  -- Smallest currency unit, matching subscription_plans.price.
  price                 BIGINT UNSIGNED NOT NULL,
  currency              VARCHAR(3) NOT NULL DEFAULT 'INR',
  -- VARCHAR, not ENUM — matches subscription_plans.billing_cycle's
  -- existing convention; app-validated to exactly 'monthly' or 'yearly'.
  billing_cycle         VARCHAR(20) NOT NULL,
  -- Deliberately a NEW, distinctly-named column — NOT tenants.employee_limit
  -- (that column is dead/unused under the B2B2C model, see tenantModel.js)
  -- and NOT subscription_plans.max_clients (an unrelated, agency-level
  -- CLIENT-count limit). This is the per-CLIENT-PLAN maximum ACTIVE
  -- employee count ("Each plan has price and maximum active-employee
  -- limit"). Always a concrete number — unlike max_clients, the approved
  -- business rules have no "unlimited" concept for this limit, so it is
  -- NOT NULL rather than nullable-means-unlimited.
  max_active_employees  INT UNSIGNED NOT NULL,
  -- Deactivating a plan removes it from what a Client may newly select or
  -- renew onto, without touching any existing subscriber — mirrors
  -- subscription_plans.is_active exactly ("Deactivated plan cannot be
  -- selected by new Clients... Existing subscribed Clients continue until
  -- their current paid period ends").
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_client_subscription_plans_tenant (tenant_id),
  KEY idx_client_subscription_plans_tenant_active (tenant_id, is_active),
  -- Composite-FK target: required so client_subscriptions (044) can
  -- enforce "this plan belongs to the same agency as this client" at the
  -- database level, not just by convention — the exact pattern already
  -- used throughout this schema (see clients.uq_clients_tenant_id_id).
  UNIQUE KEY uq_client_subscription_plans_tenant_id_id (tenant_id, id),

  CONSTRAINT fk_client_subscription_plans_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
