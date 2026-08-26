const leadModel = require("../models/leadModel");

/**
 * §E of the Final Specification. Tenant Admin gets tenant-wide numbers;
 * Tenant Employee gets only their own — the same scoping principle as
 * everywhere else in the lead engine, just aggregated instead of listed.
 */
async function summaryForAdmin(tenantId) {
  const [totals, sourceBreakdown, monthlyVolume, statusBreakdown] = await Promise.all([
    leadModel.tenantTotals(tenantId),
    leadModel.sourceBreakdown(tenantId),
    leadModel.monthlyVolume(tenantId, 6),
    leadModel.statusBreakdown(tenantId),
  ]);

  return {
    scope: "tenant",
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

async function summaryForEmployee(tenantId, userId) {
  const [totals, statusBreakdown] = await Promise.all([
    leadModel.employeeTotals(tenantId, userId),
    leadModel.statusBreakdown(tenantId, { restrictToUserId: userId }),
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
