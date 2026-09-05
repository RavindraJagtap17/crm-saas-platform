const dashboardService = require("../services/dashboardService");
const asyncHandler = require("../utils/asyncHandler");

const summary = asyncHandler(async (req, res) => {
  const data =
    req.user.role === "client_admin"
      ? await dashboardService.summaryForAdmin(req.clientId)
      : await dashboardService.summaryForEmployee(req.clientId, req.user.sub);
  res.json(data);
});

module.exports = { summary };
