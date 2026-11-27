import { Prisma } from "../../../generated/prisma/client.js";
import type { ExpenseCategory } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";
import { getFinancialSummaryForRange } from "../dashboard/financial-dashboard.service.js";
import { parseReportDateRange } from "./reports.date-range.js";

const D = Prisma.Decimal;
const categories: readonly ExpenseCategory[] = ["SALARY", "RENT", "UTILITIES", "TRANSPORT", "MAINTENANCE", "SUPPLIES", "OTHER"];
type Range = ReturnType<typeof parseReportDateRange>;
type MonthRow = { month: string; amount: Prisma.Decimal | string | null; count: bigint | number };
type ExpenseMonthRow = MonthRow & { category: string };
type ProductionRow = {
  month?: string; orderId?: string; orderNo?: string;
  actualCost: Prisma.Decimal | string | null;
  unreconciledCost: Prisma.Decimal | string | null;
  reconciledCount: bigint | number; unreconciledCount: bigint | number; activeBatchCount: bigint | number;
};
type ProductionBatchCountRow = { activeBatchCount: bigint | number };

function dec(value: Prisma.Decimal | string | null | undefined) { return value == null ? new D(0) : new D(value); }
function money(value: Prisma.Decimal) { return value.toFixed(2); }
function integer(value: bigint | number | null | undefined) { return typeof value === "bigint" ? Number(value) : value ?? 0; }
function reportPeriod(range: Range) {
  return { from: range.from, to: range.to, timeZone: range.timeZone, start: range.start.toISOString(), endExclusive: range.endExclusive.toISOString() };
}
function monthsInRange(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number), [ty, tm] = to.split("-").map(Number);
  const result: string[] = [];
  let year = fy!;
  while (year <= ty!) {
    for (let month = year === fy ? fm! : 1; month <= (year === ty ? tm! : 12); month++) {
      result.push(String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0"));
    }
    year++;
  }
  return result;
}
function emptyCategories() {
  return Object.fromEntries(categories.map((category) => [category, new D(0)])) as Record<ExpenseCategory, Prisma.Decimal>;
}
function periodPredicate(column: Prisma.Sql, range: Range) {
  return Prisma.sql`(${column} AT TIME ZONE 'UTC') >= ${range.start} AND (${column} AT TIME ZONE 'UTC') < ${range.endExclusive}`;
}

export async function getFinancialReportSummary(businessId: string, range: Range) {
  const result = await getFinancialSummaryForRange(businessId, range.start, range.endExclusive);
  return {
    period: reportPeriod(range),
    currency: "ETB" as const,
    periodTotals: {
      invoicedSales: result.invoicedSales,
      paymentsReceived: result.paymentsReceived,
      receivedMaterialPurchases: result.receivedMaterialPurchases,
      operatingExpenses: result.operatingExpenses,
      productionMaterialCost: result.productionMaterialCost,
    },
    currentSnapshots: { outstandingCustomerBalances: result.currentOutstandingBalances },
    warnings: result.warnings,
    limitations: result.limitations,
  };
}

export async function getExpenseReport(businessId: string, range: Range, groupBy: "month" | "category") {
  const totals = emptyCategories();
  let total = new D(0);
  if (groupBy === "category") {
    const groups = await prisma.expense.groupBy({
      by: ["category"],
      where: { businessId, voidedAt: null, expenseDate: { gte: range.start, lt: range.endExclusive } },
      _sum: { amount: true }, _count: { _all: true },
    });
    const data = categories.map((category) => {
      const row = groups.find((item) => item.category === category);
      const amount = row?._sum.amount ?? new D(0);
      totals[category] = amount;
      total = total.add(amount);
      return { category, amountETB: money(amount), expenseCount: row?._count._all ?? 0 };
    });
    return {
      period: reportPeriod(range), groupBy, currency: "ETB" as const, totalETB: money(total),
      categoryTotalsETB: Object.fromEntries(categories.map((key) => [key, money(totals[key])])),
      groups: data, source: "Non-voided expenses by expenseDate; material purchases excluded.",
    };
  }
  const rows = await prisma.$queryRaw<ExpenseMonthRow[]>`
    SELECT to_char(date_trunc('month', "expenseDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa'), 'YYYY-MM') AS "month",
           "category"::text AS "category", SUM("amount") AS "amount", COUNT(*) AS "count"
    FROM "Expense"
    WHERE "businessId" = ${businessId} AND "voidedAt" IS NULL
      AND ${periodPredicate(Prisma.sql`"expenseDate"`, range)}
    GROUP BY 1, 2 ORDER BY 1, 2
  `;
  const byMonth = new Map<string, { sum: Prisma.Decimal; count: number; categories: Record<ExpenseCategory, Prisma.Decimal> }>();
  for (const month of monthsInRange(range.from, range.to)) byMonth.set(month, { sum: new D(0), count: 0, categories: emptyCategories() });
  for (const row of rows) {
    if (!categories.includes(row.category as ExpenseCategory)) continue;
    const month = byMonth.get(row.month);
    if (!month) continue;
    const amount = dec(row.amount), category = row.category as ExpenseCategory;
    month.sum = month.sum.add(amount);
    month.count += integer(row.count);
    month.categories[category] = amount;
    totals[category] = totals[category].add(amount);
    total = total.add(amount);
  }
  return {
    period: reportPeriod(range), groupBy, currency: "ETB" as const, totalETB: money(total),
    categoryTotalsETB: Object.fromEntries(categories.map((key) => [key, money(totals[key])])),
    groups: [...byMonth].map(([month, value]) => ({
      month, totalETB: money(value.sum), expenseCount: value.count,
      byCategoryETB: Object.fromEntries(categories.map((key) => [key, money(value.categories[key])])),
    })),
    source: "Non-voided expenses by expenseDate; material purchases excluded.",
  };
}

export async function getMaterialPurchasesReport(businessId: string, range: Range) {
  const rows = await prisma.$queryRaw<MonthRow[]>`
    SELECT to_char(date_trunc('month', COALESCE(p."receivedAt", p."purchaseDate") AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa'), 'YYYY-MM') AS "month",
           SUM(i."totalCost") AS "amount", COUNT(DISTINCT p."id") AS "count"
    FROM "Purchase" p JOIN "PurchaseItem" i ON i."purchaseId" = p."id"
    WHERE p."businessId" = ${businessId} AND p."status" = 'RECEIVED'::"PurchaseStatus"
      AND ${periodPredicate(Prisma.sql`COALESCE(p."receivedAt", p."purchaseDate")`, range)}
    GROUP BY 1 ORDER BY 1
  `;
  const byMonth = new Map(rows.map((row) => [row.month, { amount: dec(row.amount), count: integer(row.count) }]));
  const months = monthsInRange(range.from, range.to).map((month) => ({
    month, amountETB: money(byMonth.get(month)?.amount ?? new D(0)), receivedPurchaseCount: byMonth.get(month)?.count ?? 0,
  }));
  const total = months.reduce((sum, row) => sum.add(row.amountETB), new D(0));
  return {
    period: reportPeriod(range), currency: "ETB" as const, receivedMaterialPurchasesETB: money(total), months,
    source: "PurchaseItem.totalCost for RECEIVED purchases; receivedAt with purchaseDate fallback. Not supplier payments or operating expenses.",
  };
}

export async function getProductionMaterialCostsReport(businessId: string, range: Range) {
  const monthly = await prisma.$queryRaw<ProductionRow[]>`
    SELECT to_char(date_trunc('month', u."recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa'), 'YYYY-MM') AS "month",
      COALESCE(SUM(u."totalCost") FILTER (WHERE u."issuedQuantity" = u."consumedQuantity" + u."returnedQuantity" + u."wastedQuantity"), 0) AS "actualCost",
      COALESCE(SUM(u."totalCost") FILTER (WHERE u."issuedQuantity" <> u."consumedQuantity" + u."returnedQuantity" + u."wastedQuantity"), 0) AS "unreconciledCost",
      COUNT(*) FILTER (WHERE u."issuedQuantity" <> u."consumedQuantity" + u."returnedQuantity" + u."wastedQuantity") AS "unreconciledCount",
      COUNT(DISTINCT b."id") FILTER (WHERE b."status" IN ('PLANNED'::"ProductionStatus", 'IN_PROGRESS'::"ProductionStatus")) AS "activeBatchCount",
      COUNT(*) FILTER (WHERE u."issuedQuantity" = u."consumedQuantity" + u."returnedQuantity" + u."wastedQuantity") AS "reconciledCount"
    FROM "ProductionMaterialUsage" u
    JOIN "ProductionBatch" b ON b."id" = u."productionBatchId" AND b."businessId" = u."businessId"
    WHERE u."businessId" = ${businessId} AND b."status" <> 'CANCELLED'::"ProductionStatus"
      AND ${periodPredicate(Prisma.sql`u."recordedAt"`, range)}
    GROUP BY 1 ORDER BY 1
  `;
  const orders = await prisma.$queryRaw<ProductionRow[]>`
    SELECT o."id" AS "orderId", o."orderNo" AS "orderNo",
      COALESCE(SUM(u."totalCost") FILTER (WHERE u."issuedQuantity" = u."consumedQuantity" + u."returnedQuantity" + u."wastedQuantity"), 0) AS "actualCost",
      COALESCE(SUM(u."totalCost") FILTER (WHERE u."issuedQuantity" <> u."consumedQuantity" + u."returnedQuantity" + u."wastedQuantity"), 0) AS "unreconciledCost",
      COUNT(*) FILTER (WHERE u."issuedQuantity" <> u."consumedQuantity" + u."returnedQuantity" + u."wastedQuantity") AS "unreconciledCount",
      COUNT(DISTINCT b."id") FILTER (WHERE b."status" IN ('PLANNED'::"ProductionStatus", 'IN_PROGRESS'::"ProductionStatus")) AS "activeBatchCount",
      COUNT(*) FILTER (WHERE u."issuedQuantity" = u."consumedQuantity" + u."returnedQuantity" + u."wastedQuantity") AS "reconciledCount"
    FROM "ProductionMaterialUsage" u
    JOIN "ProductionBatch" b ON b."id" = u."productionBatchId" AND b."businessId" = u."businessId"
    JOIN "CustomerOrder" o ON o."id" = b."orderId" AND o."businessId" = b."businessId"
    WHERE u."businessId" = ${businessId} AND b."status" <> 'CANCELLED'::"ProductionStatus"
      AND ${periodPredicate(Prisma.sql`u."recordedAt"`, range)}
    GROUP BY o."id", o."orderNo" ORDER BY o."orderNo"
  `;
  const [batchCount] = await prisma.$queryRaw<ProductionBatchCountRow[]>`
    SELECT COUNT(DISTINCT b."id") FILTER (WHERE b."status" IN ('PLANNED'::"ProductionStatus", 'IN_PROGRESS'::"ProductionStatus")) AS "activeBatchCount"
    FROM "ProductionMaterialUsage" u
    JOIN "ProductionBatch" b ON b."id" = u."productionBatchId" AND b."businessId" = u."businessId"
    WHERE u."businessId" = ${businessId} AND b."status" <> 'CANCELLED'::"ProductionStatus"
      AND ${periodPredicate(Prisma.sql`u."recordedAt"`, range)}
  `;
  const months = monthsInRange(range.from, range.to).map((month) => {
    const row = monthly.find((candidate) => candidate.month === month);
    return {
      month, reconciledActualETB: money(dec(row?.actualCost)),
      unreconciledUsageCostETB: money(dec(row?.unreconciledCost)),
      reconciledUsageCount: integer(row?.reconciledCount), unreconciledUsageCount: integer(row?.unreconciledCount),
      activeBatchCountWithUsage: integer(row?.activeBatchCount),
    };
  });
  const total = months.reduce((sum, row) => sum.add(row.reconciledActualETB), new D(0));
  const unreconciledCost = months.reduce((sum, row) => sum.add(row.unreconciledUsageCostETB), new D(0));
  const unreconciled = months.reduce((sum, row) => sum + row.unreconciledUsageCount, 0);
  const active = integer(batchCount?.activeBatchCount);
  return {
    period: reportPeriod(range), currency: "ETB" as const, reconciledActualETB: money(total),
    unreconciledUsageCostETB: money(unreconciledCost),
    reconciledUsageCount: months.reduce((sum, row) => sum + row.reconciledUsageCount, 0),
    unreconciledUsageCount: unreconciled, activeBatchCountWithUsage: active,
    isProvisional: unreconciled > 0 || active > 0, months,
    byOrder: orders.map((row) => ({
      orderId: row.orderId, orderNumber: row.orderNo, reconciledActualETB: money(dec(row.actualCost)),
      unreconciledUsageCostETB: money(dec(row.unreconciledCost)),
      reconciledUsageCount: integer(row.reconciledCount), unreconciledUsageCount: integer(row.unreconciledCount),
      activeBatchCountWithUsage: integer(row.activeBatchCount),
    })),
    source: "Reconciled ProductionMaterialUsage.totalCost; cancelled batches excluded; ProductionCostSheet.materialCost not added.",
  };
}

export async function getInventoryValuation(businessId: string) {
  const [materials, movements, layerRows] = await Promise.all([
    prisma.material.findMany({
      where: { businessId },
      select: { id: true, name: true, sku: true, isActive: true, reorderLevel: true, unit: { select: { name: true, code: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.stockMovement.groupBy({ by: ["materialId"], where: { businessId }, _sum: { quantity: true } }),
    prisma.$queryRaw<Array<{ materialId: string; quantity: Prisma.Decimal | string | null; value: Prisma.Decimal | string | null }>>`
      SELECT "materialId", COALESCE(SUM("remainingQty"), 0) AS "quantity",
        COALESCE(SUM("remainingQty" * "unitCost"), 0) AS "value"
      FROM "MaterialCostLayer" WHERE "businessId" = ${businessId}
        AND "status" = 'OPEN'::"CostLayerStatus"
      GROUP BY "materialId"
    `,
  ]);
  const movementByMaterial = new Map(movements.map((row) => [row.materialId, row._sum.quantity ?? new D(0)]));
  const fifoByMaterial = new Map(layerRows.map((row) => [row.materialId, { quantity: dec(row.quantity), value: dec(row.value) }]));
  let movementTotal = new D(0), fifoTotal = new D(0), valueTotal = new D(0), discrepancyCount = 0;
  const byMaterial = materials.map((material) => {
    const movement = movementByMaterial.get(material.id) ?? new D(0);
    const layer = fifoByMaterial.get(material.id) ?? { quantity: new D(0), value: new D(0) };
    const consistent = movement.equals(layer.quantity);
    if (!consistent) discrepancyCount++;
    movementTotal = movementTotal.add(movement);
    fifoTotal = fifoTotal.add(layer.quantity);
    valueTotal = valueTotal.add(layer.value);
    return {
      materialId: material.id, materialName: material.name, sku: material.sku, unit: material.unit,
      isActive: material.isActive,
      reorderLevel: material.reorderLevel.toFixed(3), movementBalance: movement.toFixed(3),
      fifoLayerQuantity: layer.quantity.toFixed(3), discrepancyQuantity: movement.sub(layer.quantity).toFixed(3),
      inventoryValueETB: money(layer.value), isConsistent: consistent,
    };
  });
  return {
    snapshot: "current" as const, currency: "ETB" as const, materialCount: materials.length,
    totalMovementBalance: movementTotal.toFixed(3), totalFifoLayerQuantity: fifoTotal.toFixed(3),
    totalInventoryValueETB: money(valueTotal), discrepancyCount, byMaterial,
    note: "Current FIFO-layer valuation, not cash and not a historical valuation.",
  };
}
