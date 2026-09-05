ALTER TABLE web_forms DROP FOREIGN KEY fk_web_forms_client_agency;
ALTER TABLE web_forms DROP KEY idx_web_forms_client_id;
ALTER TABLE web_forms DROP KEY idx_web_forms_tenant_client;
ALTER TABLE web_forms DROP COLUMN client_id;
