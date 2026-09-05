const productService = require("../services/productService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const includeInactive = req.user.role === "client_admin" && req.query.includeInactive === "true";
  res.json({ products: await productService.list(req.clientId, includeInactive) });
});

const create = asyncHandler(async (req, res) => {
  const product = await productService.create(req.clientId, req.body);
  res.status(201).json({ product });
});

const update = asyncHandler(async (req, res) => {
  const product = await productService.update(req.clientId, req.params.id, req.body);
  res.json({ product });
});

module.exports = { list, create, update };
