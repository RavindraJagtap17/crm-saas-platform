const productModel = require("../models/productModel");
const httpError = require("../utils/httpError");
const { validateCreateProduct, validateUpdateProduct } = require("../validators/configValidators");

async function list(clientId, includeInactive) {
  return productModel.list(clientId, { includeInactive });
}

async function create(clientId, body) {
  const clean = validateCreateProduct(body);
  return productModel.create(clientId, clean);
}

async function update(clientId, id, body) {
  const existing = await productModel.findById(clientId, id);
  if (!existing) throw httpError("Product not found.", 404);
  const patch = validateUpdateProduct(body);
  return productModel.update(clientId, id, patch);
}

async function requireBelongsToClient(clientId, id) {
  const product = await productModel.findById(clientId, id);
  if (!product) throw httpError("product_id does not belong to your client.", 400);
  return product;
}

module.exports = { list, create, update, requireBelongsToClient };
