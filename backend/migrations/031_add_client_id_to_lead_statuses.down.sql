ALTER TABLE lead_statuses DROP FOREIGN KEY fk_lead_statuses_created_by_client;
ALTER TABLE lead_statuses DROP FOREIGN KEY fk_lead_statuses_client;
ALTER TABLE lead_statuses DROP KEY uq_lead_statuses_client_id_id;
ALTER TABLE lead_statuses DROP KEY idx_lead_statuses_client_id;
ALTER TABLE lead_statuses DROP KEY idx_lead_statuses_client_created_by;
ALTER TABLE lead_statuses DROP COLUMN client_id;
