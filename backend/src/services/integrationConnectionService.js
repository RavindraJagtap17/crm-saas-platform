const integrationConnectionModel = require("../models/integrationConnectionModel");
const httpError = require("../utils/httpError");
const { encrypt } = require("../utils/encryption");
const { isNonEmptyString, isPlainObject } = require("../validators/primitives");

const VALID_STATUSES = ["connected", "disconnected", "expired", "error"];

// No fixed provider allowlist here on purpose — this is the generic
// foundation, built before any of Google/LinkedIn/IndiaMART actually
// exist as code. A provider is just the string key its own future
// adapter will use consistently (e.g. "google", "linkedin", "indiamart"),
// validated only for shape, matching lead_sources.type's own established
// "free string, service layer constrains it" precedent.
function validateProvider(provider) {
  if (!isNonEmptyString(provider, 50) || !/^[a-z0-9_]+$/.test(provider)) {
    throw httpError("provider must be a lowercase alphanumeric/underscore string.", 400);
  }
  return provider;
}

// Never includes credentials_encrypted or anything derived from it —
// same discipline as metaIntegrationService.serializeConnection.
function serialize(row) {
  if (!row) return { connected: false };
  return {
    connected: row.status === "connected",
    provider: row.provider,
    externalAccountId: row.external_account_id,
    status: row.status,
    config: row.config,
    hasCredentials: !!row.credentials_encrypted,
    connectedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getConnection(clientId, provider) {
  validateProvider(provider);
  const row = await integrationConnectionModel.findByClientAndProvider(clientId, provider);
  return serialize(row);
}

function validateUpdateInput(body) {
  const clean = {};
  if (body?.externalAccountId !== undefined) {
    if (!isNonEmptyString(body.externalAccountId, 255)) throw httpError("externalAccountId must be a non-empty string.", 400);
    clean.externalAccountId = body.externalAccountId.trim();
  }
  if (body?.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) throw httpError(`status must be one of: ${VALID_STATUSES.join(", ")}.`, 400);
    clean.status = body.status;
  }
  if (body?.credentials !== undefined) {
    if (!isNonEmptyString(body.credentials, 10000)) throw httpError("credentials must be a non-empty string.", 400);
    clean.credentials = body.credentials;
  }
  if (body?.config !== undefined) {
    if (body.config !== null && !isPlainObject(body.config)) throw httpError("config must be an object.", 400);
    clean.config = body.config;
  }
  return clean;
}

/**
 * Generic Client Admin management endpoint (§10 of the foundation task).
 * A real OAuth connect/callback flow is provider-specific and explicitly
 * out of scope here (the next task, Google Ads, adds its own) — this is
 * the plain "create or update the connection row" path any provider's
 * admin UI can call once it has an externalAccountId/credential/config
 * to save. `credentials`, if given, is encrypted here — the caller never
 * handles ciphertext itself, matching how metaIntegrationService.
 * completeConnect is the only place that ever calls encrypt() today.
 */
async function updateConnection(clientId, provider, body) {
  validateProvider(provider);
  const clean = validateUpdateInput(body);
  if (Object.keys(clean).length === 0) {
    throw httpError("At least one of externalAccountId, status, credentials, or config is required.", 400);
  }
  if (clean.externalAccountId === undefined) {
    const existing = await integrationConnectionModel.findByClientAndProvider(clientId, provider);
    if (!existing) throw httpError("externalAccountId is required to create a new connection.", 400);
  }

  try {
    const row = await integrationConnectionModel.upsert(clientId, provider, {
      externalAccountId: clean.externalAccountId,
      status: clean.status,
      credentialsEncrypted: clean.credentials !== undefined ? encrypt(clean.credentials) : undefined,
      config: clean.config,
    });
    return serialize(row);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw httpError("This account is already connected to another client.", 409, "INTEGRATION_ACCOUNT_ALREADY_CONNECTED");
    }
    throw err;
  }
}

async function disconnect(clientId, provider) {
  validateProvider(provider);
  const removed = await integrationConnectionModel.remove(clientId, provider);
  if (!removed) throw httpError("No connection to remove.", 404);
}

/**
 * §6/§7 of the design doc — the ONLY function a future provider adapter
 * should ever call to turn "this external account sent us an event" into
 * a Client id. Returns null (never throws) for an unknown account, same
 * "not found is a valid, expected outcome" shape
 * metaLeadService.resolveClientByPageId already uses — a webhook handler
 * treats that as "nothing to do", not a 500.
 */
async function resolveClientByExternalAccount(provider, externalAccountId) {
  const row = await integrationConnectionModel.findByProviderAndAccount(provider, externalAccountId);
  return row ? row.client_id : null;
}

module.exports = { getConnection, updateConnection, disconnect, resolveClientByExternalAccount, serialize, validateProvider };
