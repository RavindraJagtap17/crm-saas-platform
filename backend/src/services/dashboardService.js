const leadModel = require("../models/leadModel");
const leadFollowUpModel = require("../models/leadFollowUpModel");

/**
 * §E of the Final Specification. Client Admin gets client-wide numbers.
 * Client Employee's own dashboard summary is personal throughout — the
 * broader "employee can see every client lead" visibility rule
 * (leadService.scopeFor) is untouched and still governs GET /api/leads
 * itself; this only shapes what THIS aggregate reports, so an employee's
 * dashboard shows their own work, not client-wide analytics.
 *
 * followUps below reads real lead_follow_ups data (leadFollowUpModel),
 * bypassing leadFollowUpService the same way this whole file already
 * bypasses leadService for every other aggregate — dashboardService talks
 * to models directly for read-only reporting. Client Admin gets client-
 * wide counts (Agency Admin-style "all of it"); Client Employee's counts
 * are scoped to their own assigned follow-ups only (restrictToUserId),
 * never client-wide — matches leadFollowUpService.scopeFor's identical
 * rule for the follow-up API itself.
 */
async function summaryForAdmin(clientId) {
  const [totals, sourceBreakdown, monthlyVolume, statusBreakdown, followUps, todayFollowUps] = await Promise.all([
    leadModel.clientTotals(clientId),
    leadModel.sourceBreakdown(clientId),
    leadModel.monthlyVolume(clientId, 6),
    leadModel.statusBreakdown(clientId),
    leadFollowUpModel.dashboardCounts(clientId),
    leadFollowUpModel.todayList(clientId),
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
    followUps,
    todayFollowUps: todayFollowUps.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      leadName: r.lead_name,
      leadPhone: r.lead_phone,
      assignedToName: r.assigned_to_name,
      scheduledAt: r.scheduled_at,
      status: r.status,
    })),
  };
}

async function summaryForEmployee(clientId, userId) {
  const [totals, statusBreakdown, followUps] = await Promise.all([
    leadModel.employeeTotals(clientId, userId),
    leadModel.statusBreakdown(clientId, { restrictToUserId: userId }),
    leadFollowUpModel.dashboardCounts(clientId, { restrictToUserId: userId }),
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
    followUps,
  };
}

// Follow-up topbar indicator — the same leadFollowUpModel.dashboardCounts
// call summaryForAdmin/summaryForEmployee above already make, exposed on
// its own lightweight endpoint so the shell (mounted on EVERY page, not
// just the dashboard) doesn't have to pull the whole dashboard summary
// (lead totals, source breakdown, 6 months of volume, status breakdown,
// today's follow-up list) just to show two numbers. No new query logic —
// same scoping rule as summaryForEmployee: client_employee is restricted
// to their own assigned follow-ups, client_admin gets the client-wide count.
async function followUpCounts(clientId, role, userId) {
  const scope = role === "client_employee" ? { restrictToUserId: userId } : {};
  const { overdueCount, todayCount } = await leadFollowUpModel.dashboardCounts(clientId, scope);
  return { overdue: overdueCount, dueToday: todayCount };
}

module.exports = { summaryForAdmin, summaryForEmployee, followUpCounts };
