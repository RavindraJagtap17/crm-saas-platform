const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const resolveFormKey = require("../middlewares/resolveFormKey");
const checkFormOrigin = require("../middlewares/checkFormOrigin");
const controller = require("../controllers/publicForm.controller");

const router = express.Router();

// This router's CORS policy is deliberately its own, separate from the
// app-wide one in app.js (which is a strict allowlist for the
// authenticated frontend only). A public embeddable widget can run on
// literally any tenant's website, so the origin can't be known in
// advance the way it can for our own frontend — CORS here just needs to
// let the browser through so it can read the response; the REAL
// per-tenant security decision is checkFormOrigin below, enforced at the
// application layer where a meaningful 403 can be returned instead of an
// opaque browser-blocked network error. No credentials (cookies) are
// ever used on this router, which is what makes reflecting any origin
// safe here.
router.use(cors({ origin: true, credentials: false }));

// Small, explicit body limit — a lead submission is tiny; this narrows
// the abuse surface independent of the app's general JSON limit.
router.use(express.json({ limit: "20kb" }));

const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // No custom keyGenerator — the library's default already keys on
  // req.ip with correct, bypass-safe IPv6 normalization built in.
  handler: (req, res) => {
    res.status(429).json({ error: "Too many submissions from this network. Please try again later." });
  },
});

router.get("/:formKey", resolveFormKey, checkFormOrigin, controller.getConfig);
router.post("/:formKey/submit", submitLimiter, resolveFormKey, checkFormOrigin, controller.submit);

module.exports = router;
