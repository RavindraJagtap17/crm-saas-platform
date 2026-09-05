-- B2B2C restructure: Meta becomes fully client-scoped, Client-Admin-
-- managed (previously agency-level). Additive: tenant_id and its existing
-- uq_meta_integration_tenant constraint stay intact for now. page_id
-- remains globally unique (unchanged) — a real Meta Page can only ever
-- belong to one client, same reasoning as the old one-per-tenant rule,
-- just one level down. Encrypted token storage (access_token_encrypted)
-- is untouched — no change to how/what is encrypted.
ALTER TABLE meta_integration_settings
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE meta_integration_settings mis
JOIN clients c ON c.tenant_id = mis.tenant_id
SET mis.client_id = c.id
WHERE mis.client_id IS NULL;

ALTER TABLE meta_integration_settings
  ADD UNIQUE KEY uq_meta_integration_client (client_id),
  ADD CONSTRAINT fk_meta_integration_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
