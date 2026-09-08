const dashboardService = require("../services/dashboardService");
const asyncHandler = require("../utils/asyncHandler");

const summary = asyncHandler(async (req, res) => {
  const data =
    req.user.role === "client_admin"
      ? await dashboardService.summaryForAdmin(req.clientId)
      : await dashboardService.summaryForEmployee(req.clientId, req.user.sub);
  res.json(data);
});

// Topbar follow-up indicator — req.clientId comes from tenantScope (JWT-
// derived), req.user.role/sub from the verified token; nothing here is
// ever taken from the browser beyond the already-authenticated request.
const followUpCounts = asyncHandler(async (req, res) => {
  res.json(await dashboardService.followUpCounts(req.clientId, req.user.role, req.user.sub));
});

module.exports = { summary, followUpCounts };
