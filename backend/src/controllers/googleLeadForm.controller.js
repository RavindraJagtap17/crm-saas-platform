const googleLeadFormService = require("../services/googleLeadFormService");
const asyncHandler = require("../utils/asyncHandler");

// POST /api/integrations/google/connect — Client Admin, authenticated.
// Generates a fresh webhook URL + key for this Client and returns both;
// see googleLeadFormService.connect for why (no OAuth, no Google-issued
// account id to store — WE mint both values here).
const connect = asyncHandler(async (req, res) => {
  const result = await googleLeadFormService.connect(req.clientId);
  res.status(201).json(result);
});

const getConnection = asyncHandler(async (req, res) => {
  res.json(await googleLeadFormService.getConnection(req.clientId));
});

const disconnect = asyncHandler(async (req, res) => {
  await googleLeadFormService.disconnect(req.clientId);
  res.status(204).send();
});

// POST /api/integrations/google/webhook/:token — PUBLIC, Google's own
// servers call this directly (no session, no CORS-relevant Origin).
const receiveWebhook = asyncHandler(async (req, res) => {
  const { httpStatus, body } = await googleLeadFormService.handleWebhookEvent(req.params.token, req.body);
  res.status(httpStatus).json(body);
});

module.exports = { connect, getConnection, disconnect, receiveWebhook };
