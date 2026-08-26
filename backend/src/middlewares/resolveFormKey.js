const publicFormService = require("../services/publicFormService");
const asyncHandler = require("../utils/asyncHandler");

// Attaches req.form. A missing, unknown, or inactive formKey all produce
// the exact same 404 — deliberately indistinguishable, so a caller can't
// use the response to probe which formKeys exist or are merely disabled.
const resolveFormKey = asyncHandler(async (req, res, next) => {
  req.form = await publicFormService.resolveActiveForm(req.params.formKey);
  next();
});

module.exports = resolveFormKey;
