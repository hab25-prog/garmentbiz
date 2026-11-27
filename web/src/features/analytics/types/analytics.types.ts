export type DashboardPeriod = "today" | "week" | "month" | "year";

export interface OperationalDashboard {
  period: { key: DashboardPeriod; timeZone: string; start: string; endExclusive: string };
  orders: { active: number; dueToday: number; overdue: number; createdDuringPeriod: number; byStatus: Record<string, number> };
  production: { activeBatches: number; plannedQuantity: number; completedQuantity: number; batchesByStatus: Record<string, number> };
  inventory: { materialsWithLowStock: number; materialsWithZeroStock: number; materialsAvailable: number; materialsWithNegativeStock: number };
  customers: { active: number; createdDuringPeriod: number };
}

export interface FinancialDashboard {
  period: { key: DashboardPeriod; timeZone: string; start: string; endExclusive: string };
  currency: "ETB";
  invoicedSales: { totalETB: string; invoiceCount: number };
  paymentsReceived: { totalETB: string; paymentCount: number; paymentsLinkedToVoidInvoices: { count: number; amountETB: string } };
  currentOutstandingBalances: {
    totalETB: string | null; isComplete: boolean; eligibleInvoiceCount: number;
    overpaidInvoiceCount: number; statusMismatchInvoiceCount: number; invalidInvoiceAmountCount: number;
    issues: Array<{ invoiceNumber: string; code: string }>;
  };
  receivedMaterialPurchases: { totalETB: string };
  operatingExpenses: { totalETB: string; byCategoryETB: Record<string, string> };
  productionMaterialCost: {
    reconciledActualETB: string; reconciledUsageCount: number; unreconciledUsageCount: number;
    activeBatchCountWithUsage: number; isProvisional: boolean;
  };
  warnings: Array<{ code: string; count: number; amountETB?: string }>;
  limitations: string[];
}

export interface ReportPeriod {
  from: string; to: string; timeZone: string; start: string; endExclusive: string;
}
export interface FinancialSummaryReport {
  period: ReportPeriod;
  currency: "ETB";
  periodTotals: Omit<FinancialDashboard, "period" | "currency" | "currentOutstandingBalances" | "warnings" | "limitations">;
  currentSnapshots: { outstandingCustomerBalances: FinancialDashboard["currentOutstandingBalances"] };
  warnings: FinancialDashboard["warnings"];
  limitations: string[];
}
export interface ExpenseCategoryReport {
  period: ReportPeriod; groupBy: "category"; currency: "ETB"; totalETB: string;
  categoryTotalsETB: Record<string, string>;
  groups: Array<{ category: string; amountETB: string; expenseCount: number }>;
  source: string;
}
export interface ExpenseMonthReport {
  period: ReportPeriod; groupBy: "month"; currency: "ETB"; totalETB: string;
  categoryTotalsETB: Record<string, string>;
  groups: Array<{ month: string; totalETB: string; expenseCount: number; byCategoryETB: Record<string, string> }>;
  source: string;
}
export type ExpenseReport = ExpenseCategoryReport | ExpenseMonthReport;
export interface MaterialPurchasesReport {
  period: ReportPeriod; currency: "ETB"; receivedMaterialPurchasesETB: string;
  months: Array<{ month: string; amountETB: string; receivedPurchaseCount: number }>; source: string;
}
export interface ProductionMaterialCostsReport {
  period: ReportPeriod; currency: "ETB"; reconciledActualETB: string; unreconciledUsageCostETB: string;
  reconciledUsageCount: number; unreconciledUsageCount: number; activeBatchCountWithUsage: number; isProvisional: boolean;
  months: Array<{ month: string; reconciledActualETB: string; unreconciledUsageCostETB: string; reconciledUsageCount: number; unreconciledUsageCount: number; activeBatchCountWithUsage: number }>;
  byOrder: Array<{ orderId: string; orderNumber: string; reconciledActualETB: string; unreconciledUsageCostETB: string; reconciledUsageCount: number; unreconciledUsageCount: number; activeBatchCountWithUsage: number }>;
  source: string;
}
export interface InventoryValuationReport {
  snapshot: "current"; currency: "ETB"; materialCount: number; totalMovementBalance: string;
  totalFifoLayerQuantity: string; totalInventoryValueETB: string; discrepancyCount: number; note: string;
  byMaterial: Array<{
    materialId: string; materialName: string; sku: string | null; unit: { name: string; code: string };
    isActive: boolean; reorderLevel: string; movementBalance: string; fifoLayerQuantity: string;
    discrepancyQuantity: string; inventoryValueETB: string; isConsistent: boolean;
  }>;
}
