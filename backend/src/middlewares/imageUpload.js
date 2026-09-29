const multer = require("multer");
const httpError = require("../utils/httpError");

// White-label logo/favicon upload — same shape as csvUpload.js (the only
// other file-upload path in this app), reusing the already-installed
// multer dependency rather than adding a new one. memoryStorage, never
// disk-via-multer: the buffer is validated (mimetype here, real magic-byte
// signature one layer up in tenantService — see imageSignature.js) before
// anything is written to disk, and the eventual disk path is entirely
// server-chosen (see uploadStorage.js), never the client's filename.
const MAX_IMAGE_FILE_SIZE = 1 * 1024 * 1024; // 1MB — generous for a logo/favicon, tight enough to bound abuse

// SVG is deliberately excluded: it can embed <script>/event-handler
// payloads and this app has no SVG sanitizer, so accepting it would be a
// stored-XSS vector the moment it's rendered.
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    // Cheap prefilter only — mimetype is client-declared and spoofable.
    // The real content check is assertValidImage() in tenantService,
    // against the actual uploaded bytes.
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(httpError("Only PNG, JPEG, or WebP images are accepted.", 400, "IMAGE_INVALID_FILE_TYPE"));
    }
    cb(null, true);
  },
});

// Wraps multer's single-file handler so a Multer-specific error reaches
// errorHandler in the same httpError/asyncHandler-compatible shape every
// other validation failure in this app already uses — identical pattern to
// csvUploadSingle in csvUpload.js.
function imageUploadSingle(fieldName) {
  const handler = upload.single(fieldName);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(httpError(`File is too large — the maximum image size is ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)}MB.`, 400, "IMAGE_FILE_TOO_LARGE"));
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
        return next(httpError("Upload exactly one image file.", 400, "IMAGE_INVALID_UPLOAD"));
      }
      next(err.status ? err : httpError(err.message || "Could not process the uploaded file.", 400));
    });
  };
}

module.exports = { imageUploadSingle, MAX_IMAGE_FILE_SIZE };
