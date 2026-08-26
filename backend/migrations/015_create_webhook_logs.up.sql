-- Raw inbound webhook capture, for debugging/replay (§C.7). tenant_id is
-- nullable on purpose — an event that fails to resolve to a tenant (an
-- unknown page_id, for example) is exactly the case most worth being able
-- to see afterward, so it must still be loggable without one.
CREATE TABLE webhook_logs (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source           VARCHAR(50) NOT NULL,
  tenant_id        BIGINT UNSIGNED NULL,
  event_type       VARCHAR(100) NULL,
  payload          JSON NULL,
  signature_valid  BOOLEAN NOT NULL DEFAULT FALSE,
  processed        BOOLEAN NOT NULL DEFAULT FALSE,
  error            TEXT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_webhook_logs_source (source),
  KEY idx_webhook_logs_tenant (tenant_id),

  CONSTRAINT fk_webhook_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
