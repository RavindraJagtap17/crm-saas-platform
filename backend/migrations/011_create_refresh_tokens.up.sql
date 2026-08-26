-- Server-side record of active refresh tokens, added in Step 3 to make
-- rotation and revocation possible. Only a hash of the raw token is ever
-- stored — the raw value exists only in the httpOnly cookie on the
-- client and briefly in memory on the server while issuing/checking it.
--
-- ON DELETE CASCADE on user_id (unlike the RESTRICT used for "who did
-- this" references in Step 2) is deliberate: this table is pure session
-- state, not business/audit history, so if a user row is ever removed
-- there is nothing worth keeping here.
CREATE TABLE refresh_tokens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  revoked_at  TIMESTAMP NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY idx_refresh_tokens_user (user_id),

  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
