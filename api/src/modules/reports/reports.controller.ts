import type { Request, Response } from "express";
import { getAuthenticatedBusinessId } from "../../middleware/auth.middleware.js";
import {
  getExpenseReport,
  getFinancialReportSummary,
  getInventoryValuation,
  getMaterialPurchasesReport,
  getProductionMaterialCostsReport,
} from "./reports.service.js";
import { parseReportDateRange, ReportRequestError } from "./reports.date-range.js";

type ReportHandler = (businessId: string, request: Request) => Promise<unknown>;

function createReportController(action: string, handler: ReportHandler) {
  return async (request: Request, response: Response) => {
    const businessId = getAuthenticatedBusinessId(request);
    if (!businessId) return response.status(401).json({ success: false, message: "Authentication required" });
    try {
      const data = await handler(businessId, request);
      return response.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ReportRequestError) {
        return response.status(400).json({ success: false, message: error.message });
      }
      console.error(`Financial report failed: ${action}`);
      return response.status(500).json({ success: false, message: `Unable to load ${action} report` });
    }
  };
}

function reportRange(request: Request) {
  return parseReportDateRange(request.query.from, request.query.to);
}

export const financialSummaryController = createReportController(
  "financial summary",
  (businessId, request) => getFinancialReportSummary(businessId, reportRange(request)),
);

export const expenseReportController = createReportController(
  "expense",
  (businessId, request) => {
    const groupBy = request.query.groupBy ?? "month";
    if (typeof groupBy !== "string" || (groupBy !== "month" && groupBy !== "category")) {
      throw new ReportRequestError("groupBy must be month or category");
    }
    return getExpenseReport(businessId, reportRange(request), groupBy);
  },
);

export const materialPurchasesReportController = createReportController(
  "material purchases",
  (businessId, request) => getMaterialPurchasesReport(businessId, reportRange(request)),
);

export const productionMaterialCostsReportController = createReportController(
  "production material cost",
  (businessId, request) => getProductionMaterialCostsReport(businessId, reportRange(request)),
);

export const inventoryValuationController = createReportController(
  "inventory valuation",
  (businessId) => getInventoryValuation(businessId),
);
