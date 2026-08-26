const dashboardService = require("../services/dashboardService");
const asyncHandler = require("../utils/asyncHandler");

const summary = asyncHandler(async (req, res) => {
  const data =
    req.user.role === "tenant_admin"
      ? await dashboardService.summaryForAdmin(req.tenantId)
      : await dashboardService.summaryForEmployee(req.tenantId, req.user.sub);
  res.json(data);
});

module.exports = { summary };
