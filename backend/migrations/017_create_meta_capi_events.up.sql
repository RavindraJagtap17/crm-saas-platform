-- Step 8: one row per lead that ever reached its tenant's configured
-- final/conversion status (lead_statuses.is_final). Doubles as the
-- DB-backed job queue for sending — there is no separate job-queue table
-- or external broker in this codebase (src/jobs/ was only ever a Step 1
-- scaffold), and adding one wholesale for a single job type would be
-- exactly the "duplicate the entire job system unnecessarily" the spec
-- warns against. `status` + `retry_count` + `next_attempt_at` together
-- ARE the queue: a worker selects due rows, claims one, processes it.
CREATE TABLE meta_capi_events (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  lead_id            BIGINT UNSIGNED NOT NULL,
  event_name         VARCHAR(100) NOT NULL,
  -- Deterministic, derived from lead_id (see metaCapiService.js) — passed
  -- to Meta as the event's own `event_id` so Meta's side also dedupes a
  -- send that gets retried after we already succeeded but crashed before
  -- recording it (a second, independent idempotency layer on top of the
  -- UNIQUE constraint below, which stops us from ever queuing twice).
  meta_event_id      VARCHAR(128) NOT NULL,
  status             ENUM('pending', 'processing', 'sent', 'failed_temporary', 'failed_permanent')
                       NOT NULL DEFAULT 'pending',
  retry_count        INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at    TIMESTAMP NULL,
  -- Safe, sanitized text only — never a raw Meta response body (which
  -- could echo back request fields), never a token. See metaCapiService.js.
  last_error         VARCHAR(500) NULL,
  meta_response_code VARCHAR(50) NULL,
  sent_at            TIMESTAMP NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- The idempotency guarantee itself (§H): at most one CAPI event per
  -- lead, ever — a lead that re-enters a final status (or a retried
  -- status-change request) can never queue a second send.
  UNIQUE KEY uq_meta_capi_events_tenant_lead (tenant_id, lead_id),
  KEY idx_meta_capi_events_status_next_attempt (status, next_attempt_at),

  CONSTRAINT fk_meta_capi_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_meta_capi_events_lead FOREIGN KEY (tenant_id, lead_id)
    REFERENCES leads(tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
