-- B2B2C subscription redesign: a pending employee invitation as its own
-- tracked row, separate from users.status='invited'. Needed because seat
-- accounting ("ACTIVE employees + PENDING employee invitations <= plan
-- limit") and a 7-day expiry-with-seat-release both require state this
-- schema doesn't otherwise carry — the existing users table has no
-- invitation timestamp/expiry at all (an invited user row simply sits in
-- status='invited' indefinitely). This table does not replace the
-- users-row invite flow (userService.invite / createInvitedForClient) —
-- wiring the two together is backend work for a later step; this
-- migration only adds the schema to make that possible.
CREATE TABLE employee_invitations (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id          BIGINT UNSIGNED NOT NULL,
  email              VARCHAR(255) NOT NULL,
  name               VARCHAR(255) NOT NULL,
  -- The Client Admin who sent this invitation. RESTRICT, not CASCADE —
  -- matches fk_audit_logs_user's convention: an actor's account is only
  -- ever deactivated in this system (no hard-delete path exists), but
  -- invitation history must never be able to silently vanish regardless.
  invited_by         BIGINT UNSIGNED NOT NULL,
  status             ENUM('pending', 'accepted', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
  -- Set by application logic at creation time (now + 7 days) — no DB
  -- default expression, matching this schema's existing convention of
  -- computing business-rule-driven values in code, not in SQL.
  expires_at         TIMESTAMP NOT NULL,
  -- Set once the invitation is accepted, linking it to the resulting users
  -- row — nullable/SET NULL since it's a traceability convenience, not
  -- something the invitation's own lifecycle depends on.
  accepted_user_id   BIGINT UNSIGNED NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_employee_invitations_client (client_id),
  KEY idx_employee_invitations_client_email (client_id, email),
  -- Backs both the seat-count query (client_id + status='pending') and the
  -- expiry-sweep query (status='pending' + expires_at < NOW()).
  KEY idx_employee_invitations_status (status),
  KEY idx_employee_invitations_expires_at (expires_at),

  CONSTRAINT fk_employee_invitations_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_employee_invitations_invited_by FOREIGN KEY (invited_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_employee_invitations_accepted_user FOREIGN KEY (accepted_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
