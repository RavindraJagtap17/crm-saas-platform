const indiamartLeadFormService = require("../services/indiamartLeadFormService");
const asyncHandler = require("../utils/asyncHandler");

// POST /api/integrations/indiamart/connect — Client Admin, authenticated.
// Mints a fresh webhook URL for this Client and returns it; see
// indiamartLeadFormService.connect for why there's no credential/key to
// generate (IndiaMART's Push API provides nothing to verify with).
const connect = asyncHandler(async (req, res) => {
  const result = await indiamartLeadFormService.connect(req.clientId);
  res.status(201).json(result);
});

const getConnection = asyncHandler(async (req, res) => {
  res.json(await indiamartLeadFormService.getConnection(req.clientId));
});

const disconnect = asyncHandler(async (req, res) => {
  await indiamartLeadFormService.disconnect(req.clientId);
  res.status(204).send();
});

// POST /api/integrations/indiamart/webhook/:token — PUBLIC, IndiaMART's
// own servers call this directly (no session, no CORS-relevant Origin).
const receiveWebhook = asyncHandler(async (req, res) => {
  const { httpStatus, body } = await indiamartLeadFormService.handleWebhookEvent(req.params.token, req.body);
  res.status(httpStatus).json(body);
});

module.exports = { connect, getConnection, disconnect, receiveWebhook };
