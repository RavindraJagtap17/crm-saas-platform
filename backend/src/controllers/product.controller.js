const productService = require("../services/productService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const includeInactive = req.user.role === "tenant_admin" && req.query.includeInactive === "true";
  res.json({ products: await productService.list(req.tenantId, includeInactive) });
});

const create = asyncHandler(async (req, res) => {
  const product = await productService.create(req.tenantId, req.body);
  res.status(201).json({ product });
});

const update = asyncHandler(async (req, res) => {
  const product = await productService.update(req.tenantId, req.params.id, req.body);
  res.json({ product });
});

module.exports = { list, create, update };
