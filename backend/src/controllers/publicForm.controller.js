const publicFormService = require("../services/publicFormService");
const asyncHandler = require("../utils/asyncHandler");

// GET /api/public/lead-form/:formKey
const getConfig = asyncHandler(async (req, res) => {
  const config = await publicFormService.getPublicConfig(req.form);
  res.json(config);
});

// POST /api/public/lead-form/:formKey/submit
const submit = asyncHandler(async (req, res) => {
  const result = await publicFormService.submitPublicLead(req.form, req.body);
  // Identical response whether or not the honeypot fired — never signal
  // detection back to whatever submitted it.
  res.status(201).json({ success: true, message: "Thanks — we'll be in touch shortly." });
  void result;
});

module.exports = { getConfig, submit };
