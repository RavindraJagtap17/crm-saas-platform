/**
 * One consistent server-side phone normalization function, used both when
 * storing a lead's phone and when duplicate-checking it (§H of Step 4).
 *
 * Strips everything except digits. This is deliberately simple — it does
 * not attempt real international parsing (country-code detection, etc.),
 * which the spec doesn't define a format for. The trade-off is explicit:
 * "+91 98765 43210", "9876543210", and "0919876543210" normalize to
 * different digit strings. Documented as an assumption in the Step 4
 * report rather than silently guessing a phone format.
 *
 * Returns null for empty/missing input, meaning "no phone to compare" —
 * callers must skip duplicate detection entirely in that case rather than
 * matching every other lead with no phone against each other.
 */
function normalizePhone(rawPhone) {
  if (rawPhone === null || rawPhone === undefined) return null;
  const digitsOnly = String(rawPhone).replace(/\D/g, "");
  return digitsOnly.length > 0 ? digitsOnly : null;
}

module.exports = { normalizePhone };
