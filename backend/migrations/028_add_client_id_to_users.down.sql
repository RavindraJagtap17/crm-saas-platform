ALTER TABLE users DROP FOREIGN KEY fk_users_client;
ALTER TABLE users DROP KEY uq_users_client_id_id;
ALTER TABLE users DROP KEY idx_users_client_id;
ALTER TABLE users DROP COLUMN client_id;
