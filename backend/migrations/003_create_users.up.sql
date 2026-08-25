-- Every human account, any role. tenant_id is NULL only for super_admin —
-- enforcing that pairing exactly is an application-layer rule (Step 3+),
-- since MySQL CHECK constraints can't look up another table's data.
-- No password / password_hash column anywhere: Google Sign-In is the only
-- identity verifier for this system (added in a later step).
CREATE TABLE users (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NULL,
  google_id       VARCHAR(255) NULL,
  email           VARCHAR(255) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  avatar_url      VARCHAR(1024) NULL,
  role_id         BIGINT UNSIGNED NOT NULL,
  status          ENUM('invited', 'active', 'deactivated') NOT NULL DEFAULT 'invited',
  last_login_at   TIMESTAMP NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- MySQL unique indexes treat every NULL as distinct, so this correctly
  -- allows any number of invited users with no google_id yet, while still
  -- guaranteeing no two accounts ever share a linked Google account.
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_google_id (google_id),
  KEY idx_users_tenant_id (tenant_id),
  KEY idx_users_role_id (role_id),

  -- Referenced by composite (tenant_id, id) foreign keys from leads,
  -- lead_activities, lead_status_history, and lead_statuses, so a lead can
  -- only ever be assigned to / logged by a user in its own tenant.
  UNIQUE KEY uq_users_tenant_id_id (tenant_id, id),

  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
