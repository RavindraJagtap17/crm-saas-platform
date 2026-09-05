const httpError = require("../utils/httpError");
const { isNonEmptyString, isOptionalPositiveInt } = require("./primitives");

// Bare hostnames only — no protocol, no path, no port. Kept deliberately
// simple (exact-hostname match, no wildcards) rather than inventing a
// pattern-matching scheme the spec didn't ask for. "localhost" is
// special-cased since it's the one standard hostname with no dot — real
// public domains always have one, so this doesn't loosen the check for
// anything that would actually appear on the public internet.
const HOSTNAME_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$|^localhost$/i;

function validateAllowedDomains(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw httpError("allowedDomains must be an array of hostnames (e.g. \"example.com\").", 400);
  }
  const cleaned = value.map((d) => String(d).trim().toLowerCase()).filter(Boolean);
  for (const domain of cleaned) {
    if (!HOSTNAME_PATTERN.test(domain)) {
      throw httpError(`"${domain}" is not a valid hostname. Use a bare domain like "example.com" — no https:// or path.`, 400);
    }
  }
  return [...new Set(cleaned)];
}

function validateCreateForm(body) {
  if (!isNonEmptyString(body?.name, 255)) throw httpError("name is required.", 400);
  // B2B2C restructure: every form now targets exactly one client — this is
  // what makes web_forms a dual-scoped (Category C) resource. Required,
  // never inferred/defaulted, and validated against the caller's own
  // agency by webFormService.requireOwnClient — never trusted on its own.
  if (!isOptionalPositiveInt(body?.clientId) || !body?.clientId) {
    throw httpError("clientId is required.", 400);
  }
  if (!isOptionalPositiveInt(body?.sourceId) || !body?.sourceId) {
    throw httpError("sourceId is required.", 400);
  }
  if (!isOptionalPositiveInt(body?.productId)) throw httpError("productId must be a positive integer.", 400);

  return {
    name: body.name.trim(),
    clientId: Number(body.clientId),
    sourceId: Number(body.sourceId),
    productId: body.productId ? Number(body.productId) : undefined,
    allowedDomains: validateAllowedDomains(body.allowedDomains) || [],
  };
}

function validateUpdateForm(body) {
  if (body.name !== undefined && !isNonEmptyString(body.name, 255)) {
    throw httpError("name must be a non-empty string.", 400);
  }
  if (body.sourceId !== undefined && !isOptionalPositiveInt(body.sourceId)) {
    throw httpError("sourceId must be a positive integer.", 400);
  }
  if (body.productId !== undefined && body.productId !== null && !isOptionalPositiveInt(body.productId)) {
    throw httpError("productId must be a positive integer or null.", 400);
  }

  return {
    name: body.name !== undefined ? body.name.trim() : undefined,
    sourceId: body.sourceId !== undefined ? Number(body.sourceId) : undefined,
    productId: body.productId !== undefined ? (body.productId === null ? null : Number(body.productId)) : undefined,
    allowedDomains: validateAllowedDomains(body.allowedDomains),
    isActive: body.isActive,
  };
}

module.exports = { validateCreateForm, validateUpdateForm, validateAllowedDomains, HOSTNAME_PATTERN };
