ALTER TABLE lead_activities DROP FOREIGN KEY fk_lead_activities_lead_client;
ALTER TABLE lead_activities DROP FOREIGN KEY fk_lead_activities_user_client;
ALTER TABLE lead_activities DROP FOREIGN KEY fk_lead_activities_client;
ALTER TABLE lead_activities DROP KEY idx_lead_activities_client_lead;
ALTER TABLE lead_activities DROP KEY idx_lead_activities_client_user;
ALTER TABLE lead_activities DROP COLUMN client_id;
