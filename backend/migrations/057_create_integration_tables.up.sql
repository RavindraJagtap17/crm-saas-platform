-- Generic Lead Ingestion Foundation — provider-neutral tables for every
-- FUTURE integration (Google Ads, LinkedIn, IndiaMART, ...). Deliberately
-- separate from, and never referenced by, Meta's own existing tables
-- (meta_integration_settings, meta_form_field_mappings, meta_capi_events,
-- webhook_logs) or leads.meta_lead_id — Meta keeps working exactly as it
-- does today, permanently, on its own tables. See the "Lead Ingestion
-- Architecture" design doc, §11, for why generic tables (not one more
-- provider-specific table set per provider) is the right call now that
-- four more providers are planned.
--
-- Client-scoped only (no tenant_id column) — matches lead_follow_ups
-- (migration 056), the most recent purely Client-Admin-facing table in
-- this schema: nothing here is ever read/written by Agency- or
-- platform-level code, so there is no tenant_id use to carry.

-- A. One row per Client's connection to one provider. Two independent
-- UNIQUE constraints together give the same "unambiguous resolution"
-- guarantee meta_integration_settings already proves out one level up:
-- at most one connection per (Client, provider), and a given provider
-- account can never be connected to more than one Client.
CREATE TABLE integration_connections (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id              BIGINT UNSIGNED NOT NULL,
  provider               VARCHAR(50) NOT NULL,
  external_account_id    VARCHAR(255) NOT NULL,
  status                 ENUM('connected', 'disconnected', 'expired', 'error') NOT NULL DEFAULT 'connected',
  -- Never plaintext — AES-256-GCM ciphertext via utils/encryption.js,
  -- exactly like meta_integration_settings.access_token_encrypted.
  -- Nullable: a connection row can exist before credentials are actually
  -- saved (e.g. mid-OAuth-flow), same as this being the only nullable
  -- secret-bearing column in the schema's existing precedent allows for.
  credentials_encrypted  TEXT NULL,
  -- Non-secret, provider-specific settings (e.g. a Pixel-ID-equivalent,
  -- a default source name) — never credentials; those only ever go in
  -- credentials_encrypted above.
  config                 JSON NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_integration_connections_client_provider (client_id, provider),
  UNIQUE KEY uq_integration_connections_provider_account (provider, external_account_id),
  KEY idx_integration_connections_status (status),

  CONSTRAINT fk_integration_connections_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- B. External field -> CRM field, generalizing meta_form_field_mappings
-- one level up (adds `provider`, otherwise the identical shape). Applied
-- at ingestion time; validated at save time by the service layer against
-- the Client's own active custom field definitions (never enforced at
-- the database level, since "is this crm_field_key currently valid" is a
-- point-in-time business rule, not a structural one — same reasoning
-- metaFormFieldMappingService.assertValidCrmFieldKey already established).
CREATE TABLE integration_field_mappings (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id           BIGINT UNSIGNED NOT NULL,
  provider            VARCHAR(50) NOT NULL,
  -- A constant placeholder (e.g. "default") is expected/valid for a
  -- provider with no per-form concept (IndiaMART) — kept in the key
  -- anyway so every provider shares one mapping shape.
  external_form_id    VARCHAR(255) NOT NULL,
  external_field_key  VARCHAR(255) NOT NULL,
  crm_field_key       VARCHAR(100) NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- At most one mapping per external field, per form, per provider, per
  -- Client — prevents a duplicate/conflicting mapping for the same key.
  UNIQUE KEY uq_integration_field_mappings_unique (client_id, provider, external_form_id, external_field_key),
  KEY idx_integration_field_mappings_client_provider (client_id, provider),

  CONSTRAINT fk_integration_field_mappings_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- C. One row per external lead event, from every future provider. Doubles
-- as the audit log AND the DB-backed retry queue — the exact same "state-
-- machine columns on one domain table ARE the queue" pattern
-- meta_capi_events already established (see that migration's own
-- comment), generalized across providers instead of re-implemented per
-- provider. `status`+`attempts`+`next_attempt_at` together are the queue;
-- `provider`+`external_lead_id`+received/processed timestamps+crm_lead_id
-- together are the audit trail.
--
-- client_id is nullable on purpose, same reasoning as webhook_logs.
-- tenant_id: an event that fails to resolve to a Client (an unknown
-- external_account_id) is exactly the case most worth being able to see
-- afterward, so it must still be loggable without one.
CREATE TABLE integration_events (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         BIGINT UNSIGNED NULL,
  provider          VARCHAR(50) NOT NULL,
  external_lead_id  VARCHAR(255) NOT NULL,
  event_type        VARCHAR(100) NULL,
  received_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at      TIMESTAMP NULL,
  status            ENUM('received', 'processing', 'processed', 'duplicate', 'failed') NOT NULL DEFAULT 'received',
  attempts          INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMP NULL,
  -- Safe, sanitized text only — never a raw provider response body, never
  -- a credential. Matches meta_capi_events.last_error's own discipline.
  last_error        VARCHAR(500) NULL,
  crm_lead_id       BIGINT UNSIGNED NULL,
  -- The provider's own lead/contact payload — may contain personal data,
  -- handled the same as webhook_logs.payload today (JSON, application-
  -- level access only). Must NEVER contain a credential/secret — the
  -- ingestion layer builds this from the provider's LEAD payload, never
  -- from request headers or the connection's own credentials.
  raw_payload       JSON NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- The idempotency guarantee itself (§6 of the design doc): the same
  -- provider delivering the same external lead twice can never be
  -- recorded as two separate events, which is what makes "already
  -- processed" detectable with a single indexed lookup rather than a
  -- race-prone read-then-write.
  UNIQUE KEY uq_integration_events_provider_external_lead (provider, external_lead_id),
  -- Backs the retry sweep's own due-row scan (mirrors meta_capi_events'
  -- idx_meta_capi_events_status_next_attempt exactly).
  KEY idx_integration_events_status_next_attempt (status, next_attempt_at),
  -- Backs both FKs below (a (client_id, crm_lead_id) prefix also serves
  -- plain client_id lookups) and the Client Admin's own "recent events"
  -- listing.
  KEY idx_integration_events_client_lead (client_id, crm_lead_id),

  CONSTRAINT fk_integration_events_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- SET NULL, not CASCADE — deleting one lead should never delete the
  -- event that created it; the event remains a meaningful audit record
  -- ("this lead existed, was created from this event, and was later
  -- deleted") even after the lead itself is gone.
  CONSTRAINT fk_integration_events_lead FOREIGN KEY (client_id, crm_lead_id)
    REFERENCES leads(client_id, id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
