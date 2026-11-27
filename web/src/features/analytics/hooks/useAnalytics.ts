import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "../api/analytics.api";
import type { DashboardPeriod } from "../types/analytics.types";

export const analyticsKeys = {
  all: ["analytics"] as const,
  operational: (period: DashboardPeriod) => ["analytics", "operational", period] as const,
  financial: (period: DashboardPeriod) => ["analytics", "financial", period] as const,
  summary: (from: string, to: string) => ["analytics", "reports", "summary", from, to] as const,
  expenses: (from: string, to: string, groupBy: "month" | "category") => ["analytics", "reports", "expenses", from, to, groupBy] as const,
  purchases: (from: string, to: string) => ["analytics", "reports", "material-purchases", from, to] as const,
  production: (from: string, to: string) => ["analytics", "reports", "production-costs", from, to] as const,
  inventoryValuation: ["analytics", "reports", "inventory-valuation"] as const,
};

export function useOperationalDashboard(period: DashboardPeriod, enabled = true) {
  return useQuery({ queryKey: analyticsKeys.operational(period), queryFn: () => analyticsApi.operational(period), enabled });
}
export function useFinancialDashboard(period: DashboardPeriod, enabled = true) {
  return useQuery({ queryKey: analyticsKeys.financial(period), queryFn: () => analyticsApi.financial(period), enabled });
}
export function useFinancialSummary(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: analyticsKeys.summary(from, to), queryFn: () => analyticsApi.financialSummary(from, to), enabled });
}
export function useExpenseReport(from: string, to: string, groupBy: "month" | "category", enabled = true) {
  return useQuery({ queryKey: analyticsKeys.expenses(from, to, groupBy), queryFn: () => analyticsApi.expenses(from, to, groupBy), enabled });
}
export function useMaterialPurchasesReport(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: analyticsKeys.purchases(from, to), queryFn: () => analyticsApi.materialPurchases(from, to), enabled });
}
export function useProductionMaterialCostsReport(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: analyticsKeys.production(from, to), queryFn: () => analyticsApi.productionMaterialCosts(from, to), enabled });
}
export function useInventoryValuation(enabled = true) {
  return useQuery({ queryKey: analyticsKeys.inventoryValuation, queryFn: () => analyticsApi.inventoryValuation(), enabled });
}
