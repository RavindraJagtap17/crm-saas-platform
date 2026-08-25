-- One record per subscribing agency. Root of the multi-tenant model —
-- every other tenant-owned table points back to this table's id.
CREATE TABLE tenants (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                  VARCHAR(255) NOT NULL,
  slug                  VARCHAR(255) NOT NULL,
  status                ENUM('pending_payment', 'active', 'suspended', 'canceled')
                          NOT NULL DEFAULT 'pending_payment',
  employee_limit        INT UNSIGNED NOT NULL DEFAULT 3,
  logo_url              VARCHAR(1024) NULL,
  brand_primary_color   VARCHAR(7) NULL,
  theme_settings        JSON NULL,
  subdomain             VARCHAR(255) NULL,
  custom_domain         VARCHAR(255) NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_tenants_slug (slug),
  UNIQUE KEY uq_tenants_subdomain (subdomain),
  UNIQUE KEY uq_tenants_custom_domain (custom_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
