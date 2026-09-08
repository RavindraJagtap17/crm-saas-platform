const integrationConnectionService = require("../services/integrationConnectionService");
const integrationFieldMappingService = require("../services/integrationFieldMappingService");
const integrationEventService = require("../services/integrationEventService");
const asyncHandler = require("../utils/asyncHandler");

// Generic Lead Ingestion Foundation — Client Admin management endpoints,
// one set shared by every future provider (Google Ads, LinkedIn,
// IndiaMART, ...) instead of a bespoke controller per provider. Mirrors
// meta.controller.js's own connection/mapping shape exactly, parameterized
// by req.params.provider instead of hardcoded to Meta.

const getConnection = asyncHandler(async (req, res) => {
  res.json(await integrationConnectionService.getConnection(req.clientId, req.params.provider));
});

const updateConnection = asyncHandler(async (req, res) => {
  const connection = await integrationConnectionService.updateConnection(req.clientId, req.params.provider, req.body);
  res.json(connection);
});

const disconnect = asyncHandler(async (req, res) => {
  await integrationConnectionService.disconnect(req.clientId, req.params.provider);
  res.status(204).send();
});

const listMappings = asyncHandler(async (req, res) => {
  res.json({ mappings: await integrationFieldMappingService.list(req.clientId, req.params.provider, req.query.externalFormId) });
});

const createMapping = asyncHandler(async (req, res) => {
  const mapping = await integrationFieldMappingService.create(req.clientId, req.params.provider, req.body);
  res.status(201).json({ mapping });
});

const updateMapping = asyncHandler(async (req, res) => {
  const mapping = await integrationFieldMappingService.update(req.clientId, req.params.provider, req.params.id, req.body);
  res.json({ mapping });
});

const removeMapping = asyncHandler(async (req, res) => {
  await integrationFieldMappingService.remove(req.clientId, req.params.provider, req.params.id);
  res.status(204).send();
});

// GET /api/integrations/:provider/events — recent events for the
// caller's own client + provider only (§9/§10 of the design doc).
const listEvents = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ events: await integrationEventService.listForClient(req.clientId, req.params.provider, limit) });
});

module.exports = { getConnection, updateConnection, disconnect, listMappings, createMapping, updateMapping, removeMapping, listEvents };
