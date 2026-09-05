-- Same additive pattern, but no UNIQUE(client_id, id) is added here —
-- unlike lead_sources/lead_statuses/products, nothing references
-- custom_field_definitions via a foreign key (leads.custom_fields is a
-- JSON blob validated at the application layer against this table's
-- active rows, never a DB-level FK — unchanged from Step 4's original
-- design), so a plain client_id -> clients(id) FK is all that's needed.
ALTER TABLE custom_field_definitions
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE custom_field_definitions cfd
JOIN clients c ON c.tenant_id = cfd.tenant_id
SET cfd.client_id = c.id
WHERE cfd.client_id IS NULL;

ALTER TABLE custom_field_definitions
  ADD KEY idx_cfd_client_id (client_id),
  ADD CONSTRAINT fk_cfd_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
