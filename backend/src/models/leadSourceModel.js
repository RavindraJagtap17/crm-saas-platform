const pool = require("../config/db");
const clientModel = require("./clientModel");

// tenant_id is still NOT NULL/no-default on this table (Phase B additive
// strategy) — create() populates it, resolved from client_id, purely to
// satisfy that constraint; never read back or used for scoping.

async function list(clientId) {
  const [rows] = await pool.query(
    `SELECT id, client_id, name, type, created_at, updated_at
     FROM lead_sources WHERE client_id = ? ORDER BY name ASC`,
    [clientId]
  );
  return rows;
}

async function findById(clientId, id) {
  const [rows] = await pool.query(
    `SELECT id, client_id, name, type, created_at, updated_at
     FROM lead_sources WHERE id = ? AND client_id = ? LIMIT 1`,
    [id, clientId]
  );
  return rows[0] || null;
}

async function findByName(clientId, name) {
  const [rows] = await pool.query(
    `SELECT id, client_id, name, type, created_at, updated_at
     FROM lead_sources WHERE client_id = ? AND name = ? LIMIT 1`,
    [clientId, name]
  );
  return rows[0] || null;
}

async function create(clientId, { name, type }) {
  const tenantId = await clientModel.findTenantIdForClient(clientId);
  const [result] = await pool.query(
    `INSERT INTO lead_sources (tenant_id, client_id, name, type) VALUES (?, ?, ?, ?)`,
    [tenantId, clientId, name, type || null]
  );
  return findById(clientId, result.insertId);
}

async function update(clientId, id, { name, type }) {
  const [result] = await pool.query(
    `UPDATE lead_sources SET
       name = COALESCE(?, name),
       type = COALESCE(?, type)
     WHERE id = ? AND client_id = ?`,
    [name ?? null, type ?? null, id, clientId]
  );
  if (result.affectedRows === 0) return null;
  return findById(clientId, id);
}

// Manual lead entry (§C) needs a canonical "Manual" source per client.
// Idempotent: returns the existing one if it's already been created,
// otherwise creates it. No hard-coded cross-client/global row — each
// client gets its own, created lazily on first use.
const MANUAL_SOURCE_NAME = "Manual";
const MANUAL_SOURCE_TYPE = "manual";

async function findOrCreateManualSource(clientId) {
  const existing = await findByName(clientId, MANUAL_SOURCE_NAME);
  if (existing) return existing;
  return create(clientId, { name: MANUAL_SOURCE_NAME, type: MANUAL_SOURCE_TYPE });
}

// Same pattern for Meta-sourced leads (§H: "Source is represented as
// Meta Ads") — each client gets its own row, created lazily the first
// time a Meta lead actually arrives for that client.
const META_SOURCE_NAME = "Meta Ads";
const META_SOURCE_TYPE = "meta";

async function findOrCreateMetaSource(clientId) {
  const existing = await findByName(clientId, META_SOURCE_NAME);
  if (existing) return existing;
  return create(clientId, { name: META_SOURCE_NAME, type: META_SOURCE_TYPE });
}

module.exports = { list, findById, findByName, create, update, findOrCreateManualSource, findOrCreateMetaSource };
