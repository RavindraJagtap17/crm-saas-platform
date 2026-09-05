-- Same additive pattern as lead_sources (migration 030).
ALTER TABLE products
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE products p
JOIN clients c ON c.tenant_id = p.tenant_id
SET p.client_id = c.id
WHERE p.client_id IS NULL;

ALTER TABLE products
  ADD UNIQUE KEY uq_products_client_id_id (client_id, id),
  ADD KEY idx_products_client_id (client_id),
  ADD CONSTRAINT fk_products_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
