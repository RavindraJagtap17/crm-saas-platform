const httpError = require("../utils/httpError");
const { isNonEmptyString, isOptionalString, isHexColor, isOptionalPositiveInt } = require("./primitives");

function validateCreateStatus(body) {
  if (!isNonEmptyString(body?.name, 255)) throw httpError("name is required.", 400);
  if (body.color !== undefined && body.color !== null && !isHexColor(body.color)) {
    throw httpError("color must be a hex value like #1F5C52.", 400);
  }
  if (body.sortOrder !== undefined && !Number.isInteger(Number(body.sortOrder))) {
    throw httpError("sortOrder must be an integer.", 400);
  }
  return {
    name: body.name.trim(),
    color: body.color ?? null,
    sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : 0,
    isFinal: !!body.isFinal,
  };
}

function validateUpdateStatus(body) {
  if (body.name !== undefined && !isNonEmptyString(body.name, 255)) {
    throw httpError("name must be a non-empty string.", 400);
  }
  if (body.color !== undefined && body.color !== null && !isHexColor(body.color)) {
    throw httpError("color must be a hex value like #1F5C52.", 400);
  }
  if (body.sortOrder !== undefined && !Number.isInteger(Number(body.sortOrder))) {
    throw httpError("sortOrder must be an integer.", 400);
  }
  return {
    name: body.name !== undefined ? body.name.trim() : undefined,
    color: body.color,
    sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
    isFinal: body.isFinal,
  };
}

function validateCreateSource(body) {
  if (!isNonEmptyString(body?.name, 255)) throw httpError("name is required.", 400);
  if (!isOptionalString(body.type, 50)) throw httpError("type must be a short string.", 400);
  return { name: body.name.trim(), type: body.type ?? null };
}

function validateUpdateSource(body) {
  if (body.name !== undefined && !isNonEmptyString(body.name, 255)) {
    throw httpError("name must be a non-empty string.", 400);
  }
  if (!isOptionalString(body.type, 50)) throw httpError("type must be a short string.", 400);
  return { name: body.name !== undefined ? body.name.trim() : undefined, type: body.type };
}

function validateCreateProduct(body) {
  if (!isNonEmptyString(body?.name, 255)) throw httpError("name is required.", 400);
  if (!isOptionalString(body.description, 5000)) throw httpError("description must be a string.", 400);
  return { name: body.name.trim(), description: body.description ?? null, isActive: body.isActive };
}

function validateUpdateProduct(body) {
  if (body.name !== undefined && !isNonEmptyString(body.name, 255)) {
    throw httpError("name must be a non-empty string.", 400);
  }
  if (!isOptionalString(body.description, 5000)) throw httpError("description must be a string.", 400);
  return { name: body.name, description: body.description, isActive: body.isActive };
}

function validateId(value, label = "id") {
  if (!isOptionalPositiveInt(value) || value === undefined || value === null) {
    throw httpError(`${label} must be a positive integer.`, 400);
  }
  return Number(value);
}

module.exports = {
  validateCreateStatus,
  validateUpdateStatus,
  validateCreateSource,
  validateUpdateSource,
  validateCreateProduct,
  validateUpdateProduct,
  validateId,
};
