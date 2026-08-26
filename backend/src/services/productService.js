const productModel = require("../models/productModel");
const httpError = require("../utils/httpError");
const { validateCreateProduct, validateUpdateProduct } = require("../validators/configValidators");

async function list(tenantId, includeInactive) {
  return productModel.list(tenantId, { includeInactive });
}

async function create(tenantId, body) {
  const clean = validateCreateProduct(body);
  return productModel.create(tenantId, clean);
}

async function update(tenantId, id, body) {
  const existing = await productModel.findById(tenantId, id);
  if (!existing) throw httpError("Product not found.", 404);
  const patch = validateUpdateProduct(body);
  return productModel.update(tenantId, id, patch);
}

async function requireBelongsToTenant(tenantId, id) {
  const product = await productModel.findById(tenantId, id);
  if (!product) throw httpError("product_id does not belong to your tenant.", 400);
  return product;
}

module.exports = { list, create, update, requireBelongsToTenant };
