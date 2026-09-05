const clientBillingService = require("../services/clientBillingService");
const asyncHandler = require("../utils/asyncHandler");

const listPlans = asyncHandler(async (req, res) => {
  res.json({ plans: await clientBillingService.listActivePlans(req.tenantId) });
});

const getSubscription = asyncHandler(async (req, res) => {
  res.json(await clientBillingService.getCurrentSubscription(req.tenantId, req.clientId));
});

const chooseSubscription = asyncHandler(async (req, res) => {
  const result = await clientBillingService.chooseSubscription(req.tenantId, req.clientId, req.body);
  res.status(201).json(result);
});

// Step 8E — retries a failed/abandoned INITIAL purchase attempt. Body is
// deliberately ignored: nothing about which subscription/plan/agency to
// act on is ever accepted from the request — entirely derived from the
// authenticated Client scope, exactly like every other action in this file.
const retryPayment = asyncHandler(async (req, res) => {
  const result = await clientBillingService.retryPayment(req.tenantId, req.clientId);
  res.status(201).json(result);
});

// Step 9B — re-serves Checkout for the CURRENT renewal Order (created by
// the client-renewal-orders scheduler job). Body ignored, same discipline
// as retryPayment: nothing about which subscription/plan/agency to act on
// is ever accepted from the request.
const payRenewal = asyncHandler(async (req, res) => {
  const result = await clientBillingService.payRenewal(req.tenantId, req.clientId);
  res.status(200).json(result);
});

// Step 10 — schedules a downgrade for the NEXT renewal. Only `planId` is
// ever read from the body (validated against the caller's own Agency/
// Client scope inside the service) — no tenantId/clientId/accountId/
// amount/token is ever accepted from the request.
const requestDowngrade = asyncHandler(async (req, res) => {
  const result = await clientBillingService.requestDowngrade(req.tenantId, req.clientId, req.body);
  res.status(200).json(result);
});

// Step 10 — creates a prorated upgrade Order, immediately. Only `planId`
// is ever read from the body — the amount charged is computed entirely
// server-side (clientBillingService.computeUpgradeProration), never
// accepted from the request.
const requestUpgrade = asyncHandler(async (req, res) => {
  const result = await clientBillingService.requestUpgrade(req.tenantId, req.clientId, req.body);
  res.status(201).json(result);
});

const cancelSubscription = asyncHandler(async (req, res) => {
  res.json({ subscription: await clientBillingService.cancelSubscription(req.clientId) });
});

module.exports = { listPlans, getSubscription, chooseSubscription, retryPayment, payRenewal, requestDowngrade, requestUpgrade, cancelSubscription };
