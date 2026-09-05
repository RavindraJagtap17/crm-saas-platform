ALTER TABLE custom_field_definitions DROP FOREIGN KEY fk_cfd_client;
ALTER TABLE custom_field_definitions DROP KEY idx_cfd_client_id;
ALTER TABLE custom_field_definitions DROP COLUMN client_id;
