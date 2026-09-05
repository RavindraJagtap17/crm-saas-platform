ALTER TABLE meta_form_field_mappings DROP FOREIGN KEY fk_mffm_client;
ALTER TABLE meta_form_field_mappings DROP KEY uq_mffm_client_form_field;
ALTER TABLE meta_form_field_mappings DROP KEY idx_mffm_client;
ALTER TABLE meta_form_field_mappings DROP COLUMN client_id;
