const metaIntegrationService = require("../services/metaIntegrationService");
const metaFormFieldMappingService = require("../services/metaFormFieldMappingService");
const metaCapiEventModel = require("../models/metaCapiEventModel");
const graphClient = require("../integrations/meta/graphClient");
const httpError = require("../utils/httpError");
const asyncHandler = require("../utils/asyncHandler");
const config = require("../config");

// GET /api/meta/connect — Tenant Admin, authenticated. Returns the Meta
// authorization URL for the frontend to navigate the browser to (kept as
// a JSON response rather than a redirect so the access token stays in
// the Authorization header for this call, not a URL — see meta.routes.js).
const connect = asyncHandler(async (req, res) => {
  const result = await metaIntegrationService.beginConnect(req.tenantId, req.user.sub);
  res.json(result);
});

// GET /api/meta/oauth/callback — PUBLIC (Meta redirects the browser here
// directly; it cannot carry our Authorization header). Secured by the
// signed `state` param instead — see metaIntegrationService.verifyState.
const oauthCallback = asyncHandler(async (req, res) => {
  const { code, state, error: metaError } = req.query;

  if (metaError) {
    return res.redirect(`${config.frontendUrl}/public/admin/meta-integration.html?error=${encodeURIComponent(String(metaError))}`);
  }
  if (!code || !state) {
    return res.redirect(`${config.frontendUrl}/public/admin/meta-integration.html?error=missing_params`);
  }

  try {
    await metaIntegrationService.completeConnect(code, state);
    return res.redirect(`${config.frontendUrl}/public/admin/meta-integration.html?connected=true`);
  } catch (err) {
    return res.redirect(`${config.frontendUrl}/public/admin/meta-integration.html?error=${encodeURIComponent(err.code || "connection_failed")}`);
  }
});

const getConnection = asyncHandler(async (req, res) => {
  res.json(await metaIntegrationService.getConnection(req.tenantId));
});

const disconnect = asyncHandler(async (req, res) => {
  await metaIntegrationService.disconnect(req.tenantId);
  res.status(204).send();
});

// PATCH /api/meta/connection — Step 8: sets the Pixel/Dataset ID CAPI
// conversion events are sent to. A field on the existing Step 7
// connection, not a second connect flow — see migration 016.
const updateConnection = asyncHandler(async (req, res) => {
  const connection = await metaIntegrationService.setPixelId(req.tenantId, req.body?.pixelId);
  res.json(connection);
});

// GET /api/meta/capi/events — Step 8 §K: minimum admin visibility into
// recent conversion sends for the caller's own tenant only.
const listCapiEvents = asyncHandler(async (req, res) => {
  res.json({ events: await metaCapiEventModel.listForTenant(req.tenantId, 100) });
});

// GET /api/meta/forms — "see connected Meta forms where available" (§I).
// Requires a live, non-expired connection; fails clearly otherwise
// rather than silently returning an empty list.
const listForms = asyncHandler(async (req, res) => {
  const connection = await metaIntegrationService.getDecryptedAccessToken(req.tenantId);
  if (!connection) throw httpError("Connect a Meta account first.", 400, "META_NOT_CONNECTED");
  if (metaIntegrationService.isTokenExpired(connection.settings)) {
    throw httpError("Your Meta connection has expired. Please reconnect.", 400, "META_TOKEN_EXPIRED");
  }
  const forms = await graphClient.getLeadForms(connection.settings.page_id, connection.accessToken);
  res.json({ forms: forms.data || [] });
});

const listMappings = asyncHandler(async (req, res) => {
  res.json({ mappings: await metaFormFieldMappingService.list(req.tenantId, req.query.formId) });
});

const createMapping = asyncHandler(async (req, res) => {
  const mapping = await metaFormFieldMappingService.create(req.tenantId, req.body);
  res.status(201).json({ mapping });
});

const updateMapping = asyncHandler(async (req, res) => {
  const mapping = await metaFormFieldMappingService.update(req.tenantId, req.params.id, req.body);
  res.json({ mapping });
});

const removeMapping = asyncHandler(async (req, res) => {
  await metaFormFieldMappingService.remove(req.tenantId, req.params.id);
  res.status(204).send();
});

module.exports = {
  connect,
  oauthCallback,
  getConnection,
  disconnect,
  updateConnection,
  listCapiEvents,
  listForms,
  listMappings,
  createMapping,
  updateMapping,
  removeMapping,
};
