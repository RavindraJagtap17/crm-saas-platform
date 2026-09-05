ALTER TABLE products DROP FOREIGN KEY fk_products_client;
ALTER TABLE products DROP KEY uq_products_client_id_id;
ALTER TABLE products DROP KEY idx_products_client_id;
ALTER TABLE products DROP COLUMN client_id;
