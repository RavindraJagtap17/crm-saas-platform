-- Additive pattern, same as meta_integration_settings.
ALTER TABLE meta_form_field_mappings
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE meta_form_field_mappings mffm
JOIN clients c ON c.tenant_id = mffm.tenant_id
SET mffm.client_id = c.id
WHERE mffm.client_id IS NULL;

ALTER TABLE meta_form_field_mappings
  ADD UNIQUE KEY uq_mffm_client_form_field (client_id, meta_form_id, meta_field_key),
  ADD KEY idx_mffm_client (client_id),
  ADD CONSTRAINT fk_mffm_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
