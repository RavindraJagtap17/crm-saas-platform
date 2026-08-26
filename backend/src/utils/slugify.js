// Turns an agency name into a URL/identifier-safe slug. Not unique by
// itself — tenantModel.generateUniqueSlug() handles collisions.
function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

module.exports = { slugify };
