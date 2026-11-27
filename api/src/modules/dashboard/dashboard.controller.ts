import type { Request, Response } from "express";
import { getAuthenticatedBusinessId } from "../../middleware/auth.middleware.js";
import { getOperationalDashboard, type OperationalPeriod } from "./dashboard.service.js";
import { getFinancialDashboard } from "./financial-dashboard.service.js";

const supportedPeriods = new Set<OperationalPeriod>(["today", "week", "month", "year"]);

export async function getOperationalDashboardController(request: Request, response: Response) {
  const businessId = getAuthenticatedBusinessId(request);
  if (!businessId) {
    return response.status(401).json({ success: false, message: "Authentication required" });
  }

  const requestedPeriod = request.query.period ?? "month";
  if (typeof requestedPeriod !== "string" || !supportedPeriods.has(requestedPeriod as OperationalPeriod)) {
    return response.status(400).json({
      success: false,
      message: "period must be one of: today, week, month, year",
    });
  }

  try {
    const data = await getOperationalDashboard(businessId, requestedPeriod as OperationalPeriod);
    return response.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Operational dashboard aggregation failed", error);
    return response.status(500).json({ success: false, message: "Unable to load operational dashboard" });
  }
}

export async function getFinancialDashboardController(request: Request, response: Response) {
  const businessId = getAuthenticatedBusinessId(request);
  if (!businessId) {
    return response.status(401).json({ success: false, message: "Authentication required" });
  }

  const requestedPeriod = request.query.period ?? "month";
  if (typeof requestedPeriod !== "string" || !supportedPeriods.has(requestedPeriod as OperationalPeriod)) {
    return response.status(400).json({
      success: false,
      message: "period must be one of: today, week, month, year",
    });
  }

  try {
    const data = await getFinancialDashboard(businessId, requestedPeriod as OperationalPeriod);
    return response.status(200).json({ success: true, data });
  } catch {
    // Avoid leaking database query details or financial records through logs.
    console.error("Financial dashboard aggregation failed");
    return response.status(500).json({ success: false, message: "Unable to load financial dashboard" });
  }
}
