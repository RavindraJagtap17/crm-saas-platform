const httpError = require("./httpError");

// Multer's fileFilter (imageUpload.js) only sees the client-declared
// mimetype, which is attacker-controlled and easily spoofed (e.g. renaming
// a .exe to logo.png). This is the real gate: it inspects the first bytes
// of the actual uploaded buffer against known image signatures, the same
// division of labor csvUpload.js already uses (extension is a cheap
// prefilter; the real content check happens one layer up, in the service —
// see that file's own comment). SVG is deliberately never accepted here —
// an SVG can embed <script>/event-handler payloads, a real stored-XSS
// vector, and there is no sanitizer in this codebase to neutralize it.
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  // WebP container: "RIFF" <4-byte size> "WEBP"
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

function assertValidImage(file) {
  if (!file || !file.buffer) {
    throw httpError("No image file was uploaded.", 400, "IMAGE_MISSING");
  }
  const detected = detectImageType(file.buffer);
  if (!detected) {
    throw httpError("The uploaded file isn't a valid PNG, JPEG, or WebP image.", 400, "IMAGE_INVALID_CONTENT");
  }
  return detected;
}

module.exports = { detectImageType, assertValidImage };
