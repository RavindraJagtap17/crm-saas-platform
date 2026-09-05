const agencyRazorpayConnectService = require("../services/agencyRazorpayConnectService");
const asyncHandler = require("../utils/asyncHandler");
const config = require("../config");

// GET /api/agency-razorpay/connect — Agency Admin, authenticated. Returns
// the authorization URL as JSON (not a server-side redirect) so this call
// itself still travels with the normal Authorization header — mirrors
// meta.controller.js's connect exactly, same reasoning.
const connect = asyncHandler(async (req, res) => {
  const result = agencyRazorpayConnectService.beginConnect(req.tenantId, req.user.sub);
  res.json(result);
});

// GET /api/agency-razorpay/oauth/callback — PUBLIC. Razorpay redirects the
// browser here directly; it cannot present our Authorization header.
// Secured entirely by the signed `state` param — see
// agencyRazorpayConnectService.verifyState.
const oauthCallback = asyncHandler(async (req, res) => {
  const { code, state, error: rzpError } = req.query;

  if (rzpError) {
    return res.redirect(`${config.frontendUrl}/public/agency/razorpay-connect.html?error=${encodeURIComponent(String(rzpError))}`);
  }
  if (!code || !state) {
    return res.redirect(`${config.frontendUrl}/public/agency/razorpay-connect.html?error=missing_params`);
  }

  try {
    await agencyRazorpayConnectService.completeConnect(String(code), String(state));
    return res.redirect(`${config.frontendUrl}/public/agency/razorpay-connect.html?connected=true`);
  } catch (err) {
    return res.redirect(`${config.frontendUrl}/public/agency/razorpay-connect.html?error=${encodeURIComponent(err.code || "connection_failed")}`);
  }
});

const getConnection = asyncHandler(async (req, res) => {
  res.json(await agencyRazorpayConnectService.getConnection(req.tenantId));
});

const disconnect = asyncHandler(async (req, res) => {
  res.json(await agencyRazorpayConnectService.disconnect(req.tenantId));
});

module.exports = { connect, oauthCallback, getConnection, disconnect };
