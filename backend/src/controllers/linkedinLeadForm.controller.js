const linkedinLeadFormService = require("../services/linkedinLeadFormService");
const asyncHandler = require("../utils/asyncHandler");
const config = require("../config");

// GET /api/integrations/linkedin/connect — Client Admin, authenticated.
// ownerType/ownerId are supplied by the admin (see linkedinLeadFormService
// for why LinkedIn's Lead Sync API offers no "list my accounts" endpoint
// to pick from) and carried through the OAuth redirect inside the signed
// state param, same as googleLeadFormService needs nothing extra but
// metaIntegrationService.beginConnect carries clientId/adminUserId.
const connect = asyncHandler(async (req, res) => {
  const result = linkedinLeadFormService.beginConnect(req.clientId, req.user.sub, req.query.ownerType, req.query.ownerId);
  res.json(result);
});

// GET /api/integrations/linkedin/oauth/callback — PUBLIC (LinkedIn
// redirects the browser here directly). Secured by the signed `state`
// param, identical reasoning to meta.controller.oauthCallback.
const oauthCallback = asyncHandler(async (req, res) => {
  const { code, state, error: linkedinError } = req.query;

  if (linkedinError) {
    return res.redirect(`${config.frontendUrl}/admin/linkedin-integration?error=${encodeURIComponent(String(linkedinError))}`);
  }
  if (!code || !state) {
    return res.redirect(`${config.frontendUrl}/admin/linkedin-integration?error=missing_params`);
  }

  try {
    await linkedinLeadFormService.completeConnect(code, state);
    return res.redirect(`${config.frontendUrl}/admin/linkedin-integration?connected=true`);
  } catch (err) {
    return res.redirect(`${config.frontendUrl}/admin/linkedin-integration?error=${encodeURIComponent(err.code || "connection_failed")}`);
  }
});

const getConnection = asyncHandler(async (req, res) => {
  res.json(await linkedinLeadFormService.getConnection(req.clientId));
});

const disconnect = asyncHandler(async (req, res) => {
  await linkedinLeadFormService.disconnect(req.clientId);
  res.status(204).send();
});

// GET /api/integrations/linkedin/forms — "see connected LinkedIn forms
// where available" (mirrors Meta's own /forms, §I precedent).
const listForms = asyncHandler(async (req, res) => {
  res.json({ forms: await linkedinLeadFormService.listForms(req.clientId) });
});

// GET /api/integrations/linkedin/webhook/:token — PUBLIC. LinkedIn's
// challenge-response validation handshake (initial + ~2-hourly re-check).
const validateWebhook = asyncHandler(async (req, res) => {
  const { httpStatus, body } = await linkedinLeadFormService.handleChallengeValidation(req.params.token, req.query.challengeCode);
  res.status(httpStatus).json(body);
});

// POST /api/integrations/linkedin/webhook/:token — PUBLIC. Needs the raw
// body for X-LI-Signature verification — see linkedinLeadForm.routes.js.
const receiveWebhook = asyncHandler(async (req, res) => {
  const { httpStatus, body } = await linkedinLeadFormService.handleWebhookEvent(req.params.token, req.rawBody, req.headers["x-li-signature"]);
  res.status(httpStatus).json(body);
});

module.exports = { connect, oauthCallback, getConnection, disconnect, listForms, validateWebhook, receiveWebhook };
