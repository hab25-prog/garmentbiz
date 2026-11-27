import { apiClient } from "../../../lib/api-client";
import type {
  DashboardPeriod, ExpenseReport, FinancialDashboard, FinancialSummaryReport,
  InventoryValuationReport, MaterialPurchasesReport, OperationalDashboard,
  ProductionMaterialCostsReport,
} from "../types/analytics.types";

function dateQuery(from: string, to: string) {
  const query = new URLSearchParams({ from, to });
  return query.toString();
}

export const analyticsApi = {
  operational(period: DashboardPeriod) {
    return apiClient.get<OperationalDashboard>(`/api/dashboard/operational?period=${period}`);
  },
  financial(period: DashboardPeriod) {
    return apiClient.get<FinancialDashboard>(`/api/dashboard/financial?period=${period}`);
  },
  financialSummary(from: string, to: string) {
    return apiClient.get<FinancialSummaryReport>(`/api/reports/financial/summary?${dateQuery(from, to)}`);
  },
  expenses(from: string, to: string, groupBy: "month" | "category") {
    return apiClient.get<ExpenseReport>(`/api/reports/financial/expenses?${dateQuery(from, to)}&groupBy=${groupBy}`);
  },
  materialPurchases(from: string, to: string) {
    return apiClient.get<MaterialPurchasesReport>(`/api/reports/financial/material-purchases?${dateQuery(from, to)}`);
  },
  productionMaterialCosts(from: string, to: string) {
    return apiClient.get<ProductionMaterialCostsReport>(`/api/reports/financial/production-material-costs?${dateQuery(from, to)}`);
  },
  inventoryValuation() {
    return apiClient.get<InventoryValuationReport>("/api/reports/financial/inventory-valuation");
  },
};
