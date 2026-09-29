const fs = require("fs");
const path = require("path");

// Single place resolving where uploaded tenant images live on disk.
// Defaults to backend/uploads (sibling of src/, resolved relative to this
// file rather than process.cwd() — same convention config/index.js uses
// for .env). Overridable via UPLOAD_DIR for deployments that mount a
// different persistent volume; app.js's express.static mount serves
// exactly this root under /uploads.
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "../../uploads");

// Tenant-scoped, never client-influenced: the only input is req.tenantId,
// which tenantScope.js resolves solely from the verified JWT. There is no
// client-suppliable field anywhere in this path, so there is no IDOR/path-
// traversal surface for one tenant to reach another tenant's directory.
function tenantUploadDir(tenantId) {
  return path.join(UPLOAD_ROOT, "tenants", String(tenantId));
}

// basename is always a fixed, server-chosen string ("logo" / "favicon"),
// never the client's original filename — removes any user-controlled
// segment from the path entirely. Removes any existing file sharing that
// basename regardless of extension first, so switching file types (e.g.
// logo.png -> logo.webp) never leaves an orphaned file behind.
function removeExistingWithBasename(dir, basename) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(`${basename}.`)) {
      fs.unlinkSync(path.join(dir, entry));
    }
  }
}

// Writes the already-content-validated buffer to
// <tenantUploadDir>/<basename>.<ext> and returns the public, static-served
// path to store on the tenant row (e.g. /uploads/tenants/17/logo.png).
function saveTenantImage(tenantId, basename, ext, buffer) {
  const dir = tenantUploadDir(tenantId);
  fs.mkdirSync(dir, { recursive: true });
  removeExistingWithBasename(dir, basename);
  fs.writeFileSync(path.join(dir, `${basename}.${ext}`), buffer);
  return `/uploads/tenants/${tenantId}/${basename}.${ext}`;
}

function deleteTenantImage(tenantId, basename) {
  removeExistingWithBasename(tenantUploadDir(tenantId), basename);
}

module.exports = { UPLOAD_ROOT, tenantUploadDir, saveTenantImage, deleteTenantImage };
