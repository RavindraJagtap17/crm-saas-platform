const clientService = require("../services/clientService");
const clientLicenseService = require("../services/clientLicenseService");
const asyncHandler = require("../utils/asyncHandler");
const logger = require("../utils/logger");

const list = asyncHandler(async (req, res) => {
  res.json({ clients: await clientService.list(req.tenantId) });
});

const get = asyncHandler(async (req, res) => {
  res.json({ client: await clientService.get(req.tenantId, req.params.id) });
});

// "Agency pays per Client" restructure: Client creation always succeeds
// locally first, then a License purchase is initiated as a separate,
// best-effort step — same two-step orchestration pattern used throughout
// this restructure. If Razorpay is unreachable, the Client still exists —
// checkout is null, and the Agency Admin can retry via
// POST /api/clients/:id/license/renew (initiateForClient is the same
// function either way).
const create = asyncHandler(async (req, res) => {
  const client = await clientService.create(req.tenantId, req.body);
  let checkout = null;
  try {
    ({ checkout } = await clientLicenseService.initiateForClient(req.tenantId, client.id));
  } catch (err) {
    logger.warn(`Client creation: could not initiate license payment for client_id=${client.id}: ${err.message}`);
  }
  res.status(201).json({ client, checkout });
});

const getLicense = asyncHandler(async (req, res) => {
  res.json({ license: await clientLicenseService.getForClient(req.tenantId, req.params.id) });
});

const renewLicense = asyncHandler(async (req, res) => {
  const result = await clientLicenseService.initiateForClient(req.tenantId, req.params.id);
  res.status(201).json(result);
});

const setStatus = asyncHandler(async (req, res) => {
  const client = await clientService.setStatus(req.tenantId, req.params.id, req.body, req.user.sub);
  res.json({ client });
});

const inviteAdmin = asyncHandler(async (req, res) => {
  const user = await clientService.inviteClientAdmin(req.tenantId, req.params.id, req.body, req.user.sub);
  res.status(201).json({ user });
});

const limit = asyncHandler(async (req, res) => {
  res.json({ maxClients: await clientService.effectiveClientLimit(req.tenantId) });
});

// ---- Custom field management (Agency Admin owns this, per the
// post-Phase-D ownership fix) ----

const listCustomFields = asyncHandler(async (req, res) => {
  res.json({ customFields: await clientService.listCustomFields(req.tenantId, req.params.id) });
});

const createCustomField = asyncHandler(async (req, res) => {
  const customField = await clientService.createCustomField(req.tenantId, req.params.id, req.body);
  res.status(201).json({ customField });
});

const updateCustomField = asyncHandler(async (req, res) => {
  const customField = await clientService.updateCustomField(req.tenantId, req.params.id, req.params.fieldId, req.body);
  res.json({ customField });
});

// ---- Read-only lead source/product visibility, for Website Form building ----

const listLeadSources = asyncHandler(async (req, res) => {
  res.json({ sources: await clientService.listLeadSources(req.tenantId, req.params.id) });
});

const listProducts = asyncHandler(async (req, res) => {
  res.json({ products: await clientService.listProducts(req.tenantId, req.params.id) });
});

module.exports = {
  list,
  get,
  create,
  getLicense,
  renewLicense,
  setStatus,
  inviteAdmin,
  limit,
  listCustomFields,
  createCustomField,
  updateCustomField,
  listLeadSources,
  listProducts,
};
