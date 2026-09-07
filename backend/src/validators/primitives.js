// Small hand-rolled validation primitives — no validation library is
// installed in this project, and none of this needs one. Each returns a
// boolean; validators compose these and throw httpError with a clear
// message on failure.

function isNonEmptyString(v, maxLength = 1000) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= maxLength;
}

function isOptionalString(v, maxLength = 1000) {
  return v === undefined || v === null || (typeof v === "string" && v.length <= maxLength);
}

function isPositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}

function isOptionalPositiveInt(v) {
  return v === undefined || v === null || isPositiveInt(v);
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Loose, intentionally permissive — real deliverability is Google's job at
// sign-in time; this just rejects obviously-malformed input.
function isLikelyEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 255;
}

function isHexColor(v) {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

// Loose, country-agnostic: digits with an optional leading +, no
// separators required — real deliverability isn't ours to verify; this
// just rejects obviously malformed input.
function isPhoneNumber(v) {
  return typeof v === "string" && /^\+?[0-9]{7,15}$/.test(v.trim());
}

// Standard 15-character GSTIN format (India): 2-digit state code, 10-char
// PAN, 1-char entity code, fixed 'Z', 1-char checksum.
function isGstin(v) {
  return typeof v === "string" && /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(v.trim().toUpperCase());
}

module.exports = {
  isNonEmptyString,
  isOptionalString,
  isPositiveInt,
  isOptionalPositiveInt,
  isPlainObject,
  isLikelyEmail,
  isHexColor,
  isPhoneNumber,
  isGstin,
};
