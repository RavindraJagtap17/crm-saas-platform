ALTER TABLE lead_sources DROP FOREIGN KEY fk_lead_sources_client;
ALTER TABLE lead_sources DROP KEY uq_lead_sources_client_id_id;
ALTER TABLE lead_sources DROP KEY idx_lead_sources_client_id;
ALTER TABLE lead_sources DROP COLUMN client_id;
