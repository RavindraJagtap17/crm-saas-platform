const multer = require("multer");
const httpError = require("../utils/httpError");

// Scoped narrowly to Lead CSV Import — this app has no general file-upload
// system (confirmed absent in the earlier product-gap audit), and this
// isn't meant to become one. memoryStorage, never disk: the whole point is
// to parse the file, validate it, and discard the bytes — nothing about a
// CSV import needs the raw file to outlive one request (see
// leadImportService's own in-memory preview-token comment for what DOES
// need to survive between preview and confirm, which is the parsed rows,
// not the file itself).
const MAX_IMPORT_FILE_SIZE = 2 * 1024 * 1024; // 2MB — see leadImportService.js for the sizing rationale

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    // Browsers are inconsistent about the mimetype they report for a
    // .csv file (text/csv, application/vnd.ms-excel, or even
    // application/octet-stream depending on OS/browser) — the extension
    // is the only reliably-present signal, so that's the real gate here;
    // csv-parse itself is what actually proves the CONTENT is valid CSV.
    if (!/\.csv$/i.test(file.originalname || "")) {
      return cb(httpError("Only .csv files are accepted.", 400, "IMPORT_INVALID_FILE_TYPE"));
    }
    cb(null, true);
  },
});

// Wraps multer's own single-file handler so a Multer-specific error
// (oversized file, wrong field name) comes out as the same httpError/
// asyncHandler-compatible shape every other validation failure in this
// app already uses, instead of multer's own error object reaching
// errorHandler unrecognized.
function csvUploadSingle(fieldName) {
  const handler = upload.single(fieldName);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(httpError(`File is too large — the maximum import file size is ${MAX_IMPORT_FILE_SIZE / (1024 * 1024)}MB.`, 400, "IMPORT_FILE_TOO_LARGE"));
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
        return next(httpError("Upload exactly one CSV file.", 400, "IMPORT_INVALID_UPLOAD"));
      }
      next(err.status ? err : httpError(err.message || "Could not process the uploaded file.", 400));
    });
  };
}

module.exports = { csvUploadSingle, MAX_IMPORT_FILE_SIZE };
