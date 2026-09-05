const leadModel = require("../models/leadModel");

/**
 * §E of the Final Specification. Client Admin gets client-wide numbers;
 * Client Employee also gets client-wide totals/breakdowns now (visibility
 * is no longer restricted — see leadService.scopeFor) but keeps a
 * personal "my assigned / my calls this month" summary as its own,
 * separate concern (employeeTotals), not a substitute for the shared view.
 */
async function summaryForAdmin(clientId) {
  const [totals, sourceBreakdown, monthlyVolume, statusBreakdown] = await Promise.all([
    leadModel.clientTotals(clientId),
    leadModel.sourceBreakdown(clientId),
    leadModel.monthlyVolume(clientId, 6),
    leadModel.statusBreakdown(clientId),
  ]);

  return {
    scope: "client",
    totals,
    sourceBreakdown: sourceBreakdown.map((r) => ({ sourceId: r.source_id, name: r.name, count: r.count })),
    monthlyVolume: monthlyVolume.map((r) => ({ month: r.month, count: r.count })),
    statusBreakdown: statusBreakdown.map((r) => ({
      statusId: r.status_id,
      name: r.name,
      isFinal: !!r.is_final,
      count: r.count,
    })),
  };
}

async function summaryForEmployee(clientId, userId) {
  const [totals, statusBreakdown] = await Promise.all([
    leadModel.employeeTotals(clientId, userId),
    leadModel.statusBreakdown(clientId),
  ]);

  return {
    scope: "employee",
    totals,
    statusBreakdown: statusBreakdown.map((r) => ({
      statusId: r.status_id,
      name: r.name,
      isFinal: !!r.is_final,
      count: r.count,
    })),
  };
}

module.exports = { summaryForAdmin, summaryForEmployee };
