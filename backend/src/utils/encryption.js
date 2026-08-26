const crypto = require("crypto");
const config = require("../config");

/**
 * AES-256-GCM, used to encrypt Meta access tokens at rest (§A/§L). GCM is
 * an authenticated mode — decryption fails loudly if the ciphertext was
 * tampered with, not just silently returns garbage.
 *
 * Output layout: base64(iv[12] || authTag[16] || ciphertext). A random
 * IV per call means the same plaintext never produces the same
 * ciphertext twice, without needing to track IVs separately.
 */
function getKey() {
  const keyHex = config.encryptionKey;
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256.");
  }
  return key;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decrypt(ciphertextB64) {
  const buf = Buffer.from(ciphertextB64, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
