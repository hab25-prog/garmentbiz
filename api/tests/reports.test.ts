import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import { requirePermission } from "../src/middleware/authorization.middleware.js";
import { parseReportDateRange, ReportRequestError } from "../src/modules/reports/reports.date-range.js";
import reportsRoutes from "../src/modules/reports/reports.routes.js";
import { financialSummaryController } from "../src/modules/reports/reports.controller.js";
import {
  getExpenseReport,
  getFinancialReportSummary,
  getInventoryValuation,
  getMaterialPurchasesReport,
  getProductionMaterialCostsReport,
} from "../src/modules/reports/reports.service.js";

const D = Prisma.Decimal;

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function response() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const result = {
    status(code: number) { state.statusCode = code; return result; },
    json(body: unknown) { state.body = body; return result; },
  } as unknown as Response;
  return { response: result, state };
}

function request(role: string, query: Request["query"] = {}) {
  return {
    query,
    authPrincipal: { userId: "user-a", membershipId: "membership-a", businessId: "business-a" },
    businessPrincipal: {
      userId: "user-a", membershipId: "membership-a", businessId: "business-a", role,
      businessName: "Business A",
    },
  } as unknown as Request;
}

function range() { return parseReportDateRange("2026-11-01", "2026-11-30"); }

test("financial summary separates period totals from current balance snapshots and ignores requested business IDs", async (t) => {
  const businessId = "business-a";
  const checked = (args: unknown) => {
    const where = (args as { where: { businessId?: string } }).where;
    assert.equal(where.businessId, businessId);
  };
  const restore = [
    stubMethod(prisma.invoice, "aggregate", (async (args: unknown) => {
      checked(args);
      return { _sum: { totalAmount: new D("900.00") }, _count: { _all: 2 } };
    }) as never),
    stubMethod(prisma.payment, "aggregate", (async (args: unknown) => {
      checked(args);
      return { _sum: { amount: new D("300.00") }, _count: { _all: 1 } };
    }) as never),
    stubMethod(prisma.purchaseItem, "aggregate", (async (args: unknown) => {
      const where = (args as { where: { purchase: { is: { businessId: string } } } }).where;
      assert.equal(where.purchase.is.businessId, businessId);
      return { _sum: { totalCost: new D("200.00") } };
    }) as never),
    stubMethod(prisma.expense, "groupBy", (async (args: unknown) => {
      checked(args);
      return [{ category: "SUPPLIES", _sum: { amount: new D("20.00") } }];
    }) as never),
    stubMethod(prisma.invoice, "findMany", (async (args: unknown) => {
      checked(args);
      return [{ id: "invoice-1", invoiceNo: "INV-1", status: "PARTIALLY_PAID", totalAmount: new D("900.00") }];
    }) as never),
    stubMethod(prisma.payment, "groupBy", (async (args: unknown) => {
      checked(args);
      return [{ invoiceId: "invoice-1", _sum: { amount: new D("100.00") } }];
    }) as never),
    stubMethod(prisma.productionMaterialUsage, "findMany", (async (args: unknown) => {
      checked(args);
      return [{
        issuedQuantity: new D("5"), consumedQuantity: new D("3"), returnedQuantity: new D("1"),
        wastedQuantity: new D("1"), totalCost: new D("50.10"),
        productionBatch: { id: "batch-1", status: "IN_PROGRESS" },
      }];
    }) as never),
  ];
  t.after(() => restore.reverse().forEach((undo) => undo()));

  const report = await getFinancialReportSummary(businessId, range());
  assert.equal(report.periodTotals.invoicedSales.totalETB, "900.00");
  assert.equal(report.periodTotals.paymentsReceived.totalETB, "300.00");
  assert.equal(report.currentSnapshots.outstandingCustomerBalances.totalETB, "800.00");
  assert.equal(report.periodTotals.receivedMaterialPurchases.totalETB, "200.00");
  assert.equal(report.periodTotals.operatingExpenses.totalETB, "20.00");
  assert.equal(report.periodTotals.productionMaterialCost.reconciledActualETB, "50.10");

  // The controller takes scope from authenticated context; a query businessId has no effect.
  const { response: res, state } = response();
  await financialSummaryController(request("OWNER", {
    from: "2026-11-01", to: "2026-11-30", businessId: "business-attacker",
  }), res);
  assert.equal(state.statusCode, 200);
  assert.equal((state.body as { data: { periodTotals: unknown } }).data.periodTotals !== undefined, true);
});

test("summary controller rejects invalid report ranges before querying data", async () => {
  const { response: res, state } = response();
  await financialSummaryController(request("OWNER", { from: "2026-02-30", to: "2026-03-01" }), res);
  assert.equal(state.statusCode, 400);
});

test("report date ranges validate calendar dates, ordering, range cap and Addis boundaries", () => {
  const leap = parseReportDateRange("2024-02-29", "2024-02-29");
  assert.equal(leap.start.toISOString(), "2024-02-28T21:00:00.000Z");
  assert.equal(leap.endExclusive.toISOString(), "2024-02-29T21:00:00.000Z");
  assert.throws(() => parseReportDateRange("2025-02-29", "2025-03-01"), ReportRequestError);
  assert.throws(() => parseReportDateRange("2026-11-31", "2026-12-01"), ReportRequestError);
  assert.throws(() => parseReportDateRange("2026-12-01", "2026-11-30"), /on or before/);
  assert.throws(() => parseReportDateRange("2024-01-01", "2026-01-01"), /cannot exceed 24 months/);
  assert.equal(range().start.toISOString(), "2026-10-31T21:00:00.000Z");
  assert.equal(range().endExclusive.toISOString(), "2026-11-30T21:00:00.000Z");
});

test("expense reports group by category or Addis month, exclude voided records and preserve decimal totals", async (t) => {
  const restoreGroup = stubMethod(prisma.expense, "groupBy", (async (args: unknown) => {
    const query = args as { where: { businessId: string; voidedAt: null; expenseDate: { gte: Date; lt: Date } } };
    assert.equal(query.where.businessId, "business-a");
    assert.equal(query.where.voidedAt, null);
    assert.equal(query.where.expenseDate.gte.toISOString(), range().start.toISOString());
    assert.equal(query.where.expenseDate.lt.toISOString(), range().endExclusive.toISOString());
    return [{ category: "RENT", _sum: { amount: new D("12.35") }, _count: { _all: 2 } }];
  }) as never);
  t.after(restoreGroup);

  const category = await getExpenseReport("business-a", range(), "category");
  assert.equal(category.totalETB, "12.35");
  assert.equal(category.groups.length, 7);
  assert.equal(category.groups.find((row) => row.category === "RENT")?.amountETB, "12.35");
  assert.equal(category.groups.find((row) => row.category === "SALARY")?.amountETB, "0.00");

  const restoreRaw = stubMethod(prisma, "$queryRaw", (async (...args: unknown[]) => {
    const sql = (args[0] as TemplateStringsArray).join(" ");
    assert.equal(args[1], "business-a");
    assert.match(sql, /"voidedAt" IS NULL/);
    assert.match(sql, /'Africa\/Addis_Ababa'/);
    assert.match(sql, /"expenseDate"/);
    return [{ month: "2026-11", category: "RENT", amount: new D("12.35"), count: 2n }];
  }) as never);
  t.after(restoreRaw);
  const monthly = await getExpenseReport("business-a", range(), "month");
  assert.equal(monthly.totalETB, "12.35");
  assert.equal(monthly.groups.length, 1);
  assert.equal(monthly.groups[0]?.byCategoryETB.RENT, "12.35");
  assert.equal(monthly.groups[0]?.byCategoryETB.SALARY, "0.00");
});

test("received material purchase report uses receivedAt fallback and does not label purchases as payments", async (t) => {
  const restore = stubMethod(prisma, "$queryRaw", (async (...args: unknown[]) => {
    const sql = (args[0] as TemplateStringsArray).join(" ");
    assert.equal(args[1], "business-a");
    assert.match(sql, /'RECEIVED'::"PurchaseStatus"/);
    assert.match(sql, /COALESCE\(p\."receivedAt", p\."purchaseDate"\)/);
    assert.match(sql, /"businessId"/);
    return [{ month: "2026-11", amount: new D("123.45"), count: 1n }];
  }) as never);
  t.after(restore);
  const report = await getMaterialPurchasesReport("business-a", range());
  assert.equal(report.receivedMaterialPurchasesETB, "123.45");
  assert.equal(report.months[0]?.receivedPurchaseCount, 1);
  assert.match(report.source, /Not supplier payments or operating expenses/);
});

test("production costs use reconciled usage totals only and count distinct active batches", async (t) => {
  let call = 0;
  const restore = stubMethod(prisma, "$queryRaw", (async (...args: unknown[]) => {
    const sql = (args[0] as TemplateStringsArray).join(" ");
    assert.equal(args[1], "business-a");
    assert.match(sql, /"ProductionMaterialUsage"/);
    assert.match(sql, /'CANCELLED'::"ProductionStatus"/);
    assert.match(sql, /"businessId"/);
    assert.doesNotMatch(sql, /ProductionCostSheet/);
    call++;
    if (call === 1) return [{ month: "2026-11", actualCost: new D("10.01"), unreconciledCost: new D("8.20"), reconciledCount: 1n, unreconciledCount: 1n, activeBatchCount: 1n }];
    if (call === 2) return [{ orderId: "order-1", orderNo: "ORD-1", actualCost: new D("10.01"), unreconciledCost: new D("8.20"), reconciledCount: 1n, unreconciledCount: 1n, activeBatchCount: 1n }];
    // The same batch appears in more than one monthly bucket. Overall distinct count
    // must come from the range-wide aggregate rather than adding monthly counts.
    return [{ activeBatchCount: 2n }];
  }) as never);
  t.after(restore);
  const report = await getProductionMaterialCostsReport("business-a", range());
  assert.equal(call, 3);
  assert.equal(report.reconciledActualETB, "10.01");
  assert.equal(report.unreconciledUsageCostETB, "8.20");
  assert.equal(report.reconciledUsageCount, 1);
  assert.equal(report.unreconciledUsageCount, 1);
  assert.equal(report.activeBatchCountWithUsage, 2);
  assert.equal(report.isProvisional, true);
  assert.equal(report.byOrder[0]?.orderNumber, "ORD-1");
});

test("inventory valuation calculates remaining FIFO value with Decimal and detects quantity discrepancies", async (t) => {
  const restorers = [
    stubMethod(prisma.material, "findMany", (async (args: unknown) => {
      const query = args as { where: { businessId: string } };
      assert.deepEqual(query.where, { businessId: "business-a" });
      return [
        { id: "m1", name: "Cotton", sku: "COT", isActive: true, reorderLevel: new D("2.000"), unit: { name: "Meter", code: "m" } },
        { id: "m2", name: "Thread", sku: "THR", isActive: false, reorderLevel: new D("1.000"), unit: { name: "Cone", code: "cone" } },
      ];
    }) as never),
    stubMethod(prisma.stockMovement, "groupBy", (async (args: unknown) => {
      assert.deepEqual((args as { where: unknown }).where, { businessId: "business-a" });
      return [{ materialId: "m1", _sum: { quantity: new D("5.000") } }];
    }) as never),
    stubMethod(prisma, "$queryRaw", (async (...args: unknown[]) => {
      const sql = (args[0] as TemplateStringsArray).join(" ");
      assert.equal(args[1], "business-a");
      assert.match(sql, /"remainingQty" \* "unitCost"/);
      assert.match(sql, /'OPEN'::"CostLayerStatus"/);
      return [{ materialId: "m1", quantity: new D("4.000"), value: new D("40.10") }];
    }) as never),
  ];
  t.after(() => restorers.reverse().forEach((restore) => restore()));
  const report = await getInventoryValuation("business-a");
  assert.equal(report.snapshot, "current");
  assert.equal(report.totalInventoryValueETB, "40.10");
  assert.equal(report.discrepancyCount, 1);
  assert.equal(report.byMaterial[0]?.discrepancyQuantity, "1.000");
  assert.equal(report.byMaterial[0]?.inventoryValueETB, "40.10");
  assert.equal(report.byMaterial[1]?.inventoryValueETB, "0.00");
});

test("empty expense, purchase and production datasets return zero report values", async (t) => {
  const restoreGroup = stubMethod(prisma.expense, "groupBy", (async () => []) as never);
  const restoreRaw = stubMethod(prisma, "$queryRaw", (async () => []) as never);
  t.after(() => { restoreRaw(); restoreGroup(); });

  const expenses = await getExpenseReport("business-empty", range(), "category");
  const purchases = await getMaterialPurchasesReport("business-empty", range());
  const production = await getProductionMaterialCostsReport("business-empty", range());
  assert.equal(expenses.totalETB, "0.00");
  assert.ok(expenses.groups.every((group) => group.amountETB === "0.00"));
  assert.equal(purchases.receivedMaterialPurchasesETB, "0.00");
  assert.equal(production.reconciledActualETB, "0.00");
  assert.equal(production.unreconciledUsageCount, 0);
  assert.equal(production.activeBatchCountWithUsage, 0);
  assert.equal(production.isProvisional, false);
});

test("report routes require active authenticated context and the correct role permissions", async () => {
  const layers = (reportsRoutes as unknown as { stack: Array<{ name?: string; route?: { path: string; stack: Array<{ handle: unknown }> } }> }).stack;
  assert.ok(layers.some((layer) => layer.name === "authenticate"));
  assert.ok(layers.some((layer) => layer.name === "requireActiveBusinessMembership"));
  const cases = [
    ["/financial/summary", "reports.financial.read", "MANAGER", false],
    ["/financial/summary", "reports.financial.read", "ACCOUNTANT", true],
    ["/financial/inventory-valuation", "inventory.costs.read", "MANAGER", false],
    ["/financial/inventory-valuation", "inventory.costs.read", "ACCOUNTANT", true],
  ] as const;
  for (const [path, _permission, role, allowed] of cases) {
    const route = layers.find((layer) => layer.route?.path === path)?.route;
    assert.ok(route);
    const permission = route.stack[0]?.handle as (req: Request, res: Response, next: (error?: unknown) => void) => Promise<void>;
    const { response: res, state } = response();
    let nextCalled = false;
    await permission(request(role), res, () => { nextCalled = true; });
    assert.equal(nextCalled, allowed, `${role} permission for ${path}`);
    if (!allowed) assert.equal(state.statusCode, 403);
  }
});
