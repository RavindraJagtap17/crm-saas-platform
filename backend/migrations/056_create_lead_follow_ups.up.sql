-- Real follow-up scheduling: a scheduled work item on a lead, separate
-- from lead_activities (an append-only log of what already happened) and
-- from leads itself (no follow-up history is stored there — a lead can
-- have many follow-ups over time, mirroring lead_activities' own "one
-- lead, many rows" shape). Client-scoped throughout, mirroring
-- lead_activities' post-migration-035 shape exactly: a plain client_id ->
-- clients(id) FK plus composite (client_id, x) -> leads/users(client_id,
-- id) FKs on every column that references a lead or a user, making a
-- cross-client reference structurally impossible rather than relying on
-- application code to always remember the WHERE clause.
--
-- "overdue" is deliberately NOT a status value here — it's always derived
-- as `status = 'pending' AND scheduled_at < NOW()` at query time (see
-- leadFollowUpModel.js), so there is nothing to keep in sync and no
-- scheduler job is needed to flip anything.
CREATE TABLE lead_follow_ups (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id      BIGINT UNSIGNED NOT NULL,
  lead_id        BIGINT UNSIGNED NOT NULL,
  -- Who owns doing this follow-up. NOT NULL — unlike leads.assigned_to
  -- (which starts NULL, "unassigned"), a follow-up is inherently a task
  -- for someone specific; there is no meaningful "unassigned follow-up".
  assigned_to    BIGINT UNSIGNED NOT NULL,
  scheduled_at   TIMESTAMP NOT NULL,
  status         ENUM('pending', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  notes          TEXT NULL,
  created_by     BIGINT UNSIGNED NOT NULL,
  completed_at   TIMESTAMP NULL,
  completed_by   BIGINT UNSIGNED NULL,
  cancelled_at   TIMESTAMP NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Supports the FK below and "this lead's own follow-up history" lookups.
  KEY idx_lead_follow_ups_client_lead (client_id, lead_id),
  -- Required indexes (per spec): dashboard "today's/overdue/upcoming"
  -- aggregates scan client_id + scheduled_at; status filters scan
  -- client_id + status; an employee's own list scans client_id +
  -- assigned_to + scheduled_at; a lead's own follow-up history (ordered)
  -- scans lead_id + scheduled_at directly.
  KEY idx_lead_follow_ups_client_scheduled (client_id, scheduled_at),
  KEY idx_lead_follow_ups_client_status (client_id, status),
  KEY idx_lead_follow_ups_client_assigned_scheduled (client_id, assigned_to, scheduled_at),
  KEY idx_lead_follow_ups_lead_scheduled (lead_id, scheduled_at),
  -- Supports fk_lead_follow_ups_created_by_client / _completed_by_client.
  KEY idx_lead_follow_ups_client_created_by (client_id, created_by),
  KEY idx_lead_follow_ups_client_completed_by (client_id, completed_by),

  CONSTRAINT fk_lead_follow_ups_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- A follow-up is meaningless without its lead — matches
  -- fk_lead_activities_lead_client's identical reasoning.
  CONSTRAINT fk_lead_follow_ups_lead_client FOREIGN KEY (client_id, lead_id)
    REFERENCES leads(client_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Users are only ever deactivated, never hard-deleted (see
  -- fk_lead_activities_user_client's own comment) — RESTRICT on all three
  -- user references is safe and matches that precedent.
  CONSTRAINT fk_lead_follow_ups_assigned_client FOREIGN KEY (client_id, assigned_to)
    REFERENCES users(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_lead_follow_ups_created_by_client FOREIGN KEY (client_id, created_by)
    REFERENCES users(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_lead_follow_ups_completed_by_client FOREIGN KEY (client_id, completed_by)
    REFERENCES users(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
