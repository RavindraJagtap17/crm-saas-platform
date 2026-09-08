const integrationEventModel = require("../models/integrationEventModel");
const { validateProvider } = require("./integrationConnectionService");

// Client Admin visibility only (§9/§10 of the design doc — "recent
// events", "failures") — never exposes raw_payload's full contents or
// anything beyond what a client-scoped listing needs; the full row
// (including raw_payload) is still Client-scoped by the WHERE clause in
// the model, so nothing here can leak another Client's events regardless
// of what's later added to the serialized shape.
function serialize(row) {
  return {
    id: row.id,
    provider: row.provider,
    externalLeadId: row.external_lead_id,
    eventType: row.event_type,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    crmLeadId: row.crm_lead_id,
  };
}

async function listForClient(clientId, provider, limit) {
  if (provider) validateProvider(provider);
  const rows = await integrationEventModel.listForClient(clientId, provider, limit);
  return rows.map(serialize);
}

module.exports = { listForClient, serialize };
