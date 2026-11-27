import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import { requirePermission } from "../src/middleware/authorization.middleware.js";
import { authenticate, requireActiveBusinessMembership } from "../src/middleware/auth.middleware.js";
import { getFinancialDashboardController } from "../src/modules/dashboard/dashboard.controller.js";
import { getFinancialDashboard } from "../src/modules/dashboard/financial-dashboard.service.js";
import { getOperationalPeriodBounds } from "../src/modules/dashboard/dashboard.service.js";
import dashboardRoutes from "../src/modules/dashboard/dashboard.routes.js";

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

function request(query: Request["query"] = {}, role = "OWNER", authenticated = true): Request {
  return {
    query,
    ...(authenticated ? {
      authPrincipal: { userId: "user-a", membershipId: "membership-a", businessId: "business-a" },
      businessPrincipal: {
        userId: "user-a", membershipId: "membership-a", businessId: "business-a", role, businessName: "Business A",
      },
    } : {}),
  } as unknown as Request;
}

function setupFinancialPrisma(
  t: Parameters<typeof test>[1] extends (context: infer T, ...args: never[]) => unknown ? T : never,
  fixture: { empty?: boolean; captures?: Array<{ model: string; args: unknown }> } = {},
) {
  const restore: Array<() => void> = [];
  const capture = fixture.captures ?? [];
  const set = (model: object, modelName: string, method: string, value: unknown | ((args: unknown) => unknown)) => {
    restore.push(stubMethod(model, method, (async (args?: unknown) => {
      capture.push({ model: modelName, args });
      return typeof value === "function" ? value(args) : value;
    }) as never));
  };

  set(prisma.invoice, "invoice", "aggregate", (args: unknown) => {
    const where = (args as { where: { issueDate?: unknown } }).where;
    assert.ok(where.issueDate);
    return fixture.empty
      ? { _sum: { totalAmount: null }, _count: { _all: 0 } }
      : { _sum: { totalAmount: new D("1000.00") }, _count: { _all: 3 } };
  });
  set(prisma.payment, "payment", "aggregate", (args: unknown) => {
    const where = (args as { where: { invoice?: { is?: { status?: string } } } }).where;
    if (where.invoice?.is?.status === "VOID") {
      return fixture.empty
        ? { _sum: { amount: null }, _count: { _all: 0 } }
        : { _sum: { amount: new D("50.00") }, _count: { _all: 1 } };
    }
    return fixture.empty
      ? { _sum: { amount: null }, _count: { _all: 0 } }
      : { _sum: { amount: new D("500.00") }, _count: { _all: 4 } };
  });
  set(prisma.purchaseItem, "purchaseItem", "aggregate", fixture.empty
    ? { _sum: { totalCost: null } }
    : (args: unknown) => {
      const where = (args as { where: { purchase: { is: { businessId: string; status: string; OR: Array<Record<string, unknown>> } } } }).where;
      assert.equal(where.purchase.is.businessId, "business-a");
      assert.equal(where.purchase.is.status, "RECEIVED");
      const range = { gte: new Date("2026-10-31T21:00:00.000Z"), lt: new Date("2026-11-30T21:00:00.000Z") };
      assert.deepEqual(where.purchase.is.OR, [
        { receivedAt: range },
        { receivedAt: null, purchaseDate: range },
      ]);
      return { _sum: { totalCost: new D("400.00") } };
    });
  set(prisma.expense, "expense", "groupBy", fixture.empty
    ? []
    : (args: unknown) => {
      const where = (args as { where: { voidedAt: null; expenseDate: unknown } }).where;
      assert.equal(where.voidedAt, null);
      return [
        { category: "RENT", _sum: { amount: new D("300.00") } },
        { category: "SALARY", _sum: { amount: new D("500.00") } },
      ];
    });
  set(prisma.invoice, "invoice", "findMany", fixture.empty ? [] : [
    { id: "issued", invoiceNo: "INV-1", status: "ISSUED", totalAmount: new D("100.00") },
    { id: "partial", invoiceNo: "INV-2", status: "PARTIALLY_PAID", totalAmount: new D("200.00") },
    { id: "paid", invoiceNo: "INV-3", status: "PAID", totalAmount: new D("50.00") },
    { id: "overpaid", invoiceNo: "INV-4", status: "ISSUED", totalAmount: new D("10.00") },
    { id: "status-mismatch", invoiceNo: "INV-5", status: "ISSUED", totalAmount: new D("100.00") },
  ]);
  set(prisma.payment, "payment", "groupBy", fixture.empty ? [] : [
    { invoiceId: "partial", _sum: { amount: new D("50.00") } },
    { invoiceId: "paid", _sum: { amount: new D("50.00") } },
    { invoiceId: "overpaid", _sum: { amount: new D("11.00") } },
    { invoiceId: "status-mismatch", _sum: { amount: new D("1.00") } },
  ]);
  set(prisma.productionMaterialUsage, "productionMaterialUsage", "findMany", fixture.empty ? [] : [
    {
      issuedQuantity: new D("10"), consumedQuantity: new D("5"), returnedQuantity: new D("3"),
      wastedQuantity: new D("2"), totalCost: new D("60.25"),
      productionBatch: { id: "active-batch", status: "IN_PROGRESS" },
    },
    {
      issuedQuantity: new D("5"), consumedQuantity: new D("2"), returnedQuantity: new D("0"),
      wastedQuantity: new D("0"), totalCost: new D("0.00"),
      productionBatch: { id: "planned-batch", status: "PLANNED" },
    },
  ]);
  t.after(() => restore.reverse().forEach((undo) => undo()));
  return capture;
}

test("financial dashboard period boundaries use Addis Ababa and Monday week start", () => {
  const now = new Date("2026-11-27T12:30:00.000Z");
  assert.deepEqual(
    Object.fromEntries(["today", "week", "month", "year"].map((period) => {
      const result = getOperationalPeriodBounds(period as "today" | "week" | "month" | "year", now);
      return [period, [result.start.toISOString(), result.endExclusive.toISOString()]];
    })),
    {
      today: ["2026-11-26T21:00:00.000Z", "2026-11-27T21:00:00.000Z"],
      week: ["2026-11-22T21:00:00.000Z", "2026-11-29T21:00:00.000Z"],
      month: ["2026-10-31T21:00:00.000Z", "2026-11-30T21:00:00.000Z"],
      year: ["2025-12-31T21:00:00.000Z", "2026-12-31T21:00:00.000Z"],
    },
  );
});

test("financial aggregates are separate, Decimal-safe, and return integrity warnings", async (t) => {
  const queries: Array<{ model: string; args: unknown }> = [];
  setupFinancialPrisma(t, { captures: queries });
  const data = await getFinancialDashboard("business-a", "month", new Date("2026-11-27T12:30:00Z"));

  assert.deepEqual(data.period, {
    key: "month", timeZone: "Africa/Addis_Ababa",
    start: "2026-10-31T21:00:00.000Z", endExclusive: "2026-11-30T21:00:00.000Z",
  });
  assert.deepEqual(data.invoicedSales, { totalETB: "1000.00", invoiceCount: 3 });
  assert.deepEqual(data.paymentsReceived, {
    totalETB: "500.00", paymentCount: 4,
    paymentsLinkedToVoidInvoices: { count: 1, amountETB: "50.00" },
  });
  assert.deepEqual(data.currentOutstandingBalances, {
    totalETB: null, isComplete: false, eligibleInvoiceCount: 5,
    overpaidInvoiceCount: 1, statusMismatchInvoiceCount: 1, invalidInvoiceAmountCount: 0,
    issues: [
      { invoiceNumber: "INV-4", code: "OVERPAID_INVOICE" },
      { invoiceNumber: "INV-5", code: "INVOICE_STATUS_BALANCE_MISMATCH" },
    ],
  });
  assert.deepEqual(data.receivedMaterialPurchases, { totalETB: "400.00" });
  assert.deepEqual(data.operatingExpenses, {
    totalETB: "800.00",
    byCategoryETB: {
      SALARY: "500.00", RENT: "300.00", UTILITIES: "0.00", TRANSPORT: "0.00",
      MAINTENANCE: "0.00", SUPPLIES: "0.00", OTHER: "0.00",
    },
  });
  assert.deepEqual(data.productionMaterialCost, {
    reconciledActualETB: "60.25", reconciledUsageCount: 1, unreconciledUsageCount: 1,
    activeBatchCountWithUsage: 2, isProvisional: true,
  });
  assert.equal(data.currency, "ETB");
  assert.ok(data.warnings.some((warning) => warning.code === "OVERPAID_INVOICES"));
  assert.ok(data.warnings.some((warning) => warning.code === "INVOICE_STATUS_BALANCE_MISMATCH"));
  assert.ok(data.warnings.some((warning) => warning.code === "PAYMENTS_LINKED_TO_VOID_INVOICES"));
  assert.ok(data.warnings.some((warning) => warning.code === "UNRECONCILED_PRODUCTION_USAGE"));

  const query = (model: string, methodIndex: number) => queries.filter(({ model: name }) => name === model)[methodIndex]?.args as { where: Record<string, unknown> };
  const invoiceAgg = query("invoice", 0).where;
  assert.equal(invoiceAgg.businessId, "business-a");
  assert.deepEqual(invoiceAgg.status, { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] });
  assert.deepEqual(query("invoice", 1).where.status, { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] });
  const paymentAgg = query("payment", 0).where;
  assert.equal(paymentAgg.businessId, "business-a");
  assert.ok("paymentDate" in paymentAgg);
  assert.equal("payments" in paymentAgg, false);
  const purchase = query("purchaseItem", 0).where.purchase as { is: { OR: unknown[] } };
  assert.equal(purchase.is.OR.length, 2);
  assert.deepEqual(query("expense", 0).where, {
    businessId: "business-a", voidedAt: null,
    expenseDate: { gte: new Date("2026-10-31T21:00:00.000Z"), lt: new Date("2026-11-30T21:00:00.000Z") },
  });
  const production = query("productionMaterialUsage", 0).where;
  assert.equal(production.businessId, "business-a");
  assert.deepEqual(production.productionBatch, { is: { businessId: "business-a", status: { not: "CANCELLED" } } });
  assert.equal(queries.some(({ model }) => model === "productionCostSheet"), false);
  for (const { model, args } of queries) {
    const where = (args as { where?: { businessId?: string } }).where;
    if (model !== "purchaseItem") assert.equal(where?.businessId, "business-a", `${model} must be business-scoped`);
  }
});

test("empty financial datasets return zero-valued amounts and complete empty receivables", async (t) => {
  setupFinancialPrisma(t, { empty: true });
  const data = await getFinancialDashboard("business-empty", "today", new Date("2026-11-27T12:30:00Z"));
  assert.deepEqual(data.invoicedSales, { totalETB: "0.00", invoiceCount: 0 });
  assert.deepEqual(data.paymentsReceived.paymentsLinkedToVoidInvoices, { count: 0, amountETB: "0.00" });
  assert.deepEqual(data.currentOutstandingBalances, {
    totalETB: "0.00", isComplete: true, eligibleInvoiceCount: 0,
    overpaidInvoiceCount: 0, statusMismatchInvoiceCount: 0, invalidInvoiceAmountCount: 0,
    issues: [],
  });
  assert.deepEqual(data.receivedMaterialPurchases, { totalETB: "0.00" });
  assert.equal(data.operatingExpenses.totalETB, "0.00");
  assert.equal(data.productionMaterialCost.reconciledActualETB, "0.00");
  assert.equal(data.productionMaterialCost.isProvisional, false);
});

test("financial endpoint rejects invalid periods and unauthenticated requests", async () => {
  const invalid = response();
  await getFinancialDashboardController(request({ period: "quarter" }), invalid.response);
  assert.equal(invalid.state.statusCode, 400);

  const unauthenticated = response();
  await getFinancialDashboardController(request({}, "OWNER", false), unauthenticated.response);
  assert.equal(unauthenticated.state.statusCode, 401);
});

test("financial route enforces active authenticated context and dashboard.financial.read", async () => {
  const stack = (dashboardRoutes as unknown as {
    stack: Array<{ name?: string; route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>;
  }).stack;
  const route = stack.find((layer) => layer.route?.path === "/financial")?.route;
  assert.ok(route?.methods.get);
  assert.ok(stack.some((layer) => layer.name === "authenticate"));
  assert.ok(stack.some((layer) => layer.name === "requireActiveBusinessMembership"));
  assert.equal(route.stack.length, 2);
  const permission = route.stack[0]?.handle as (req: Request, res: Response, next: (error?: unknown) => void) => Promise<void>;

  const denied = response();
  let managerNext = false;
  await permission(request({}, "MANAGER"), denied.response, () => { managerNext = true; });
  assert.equal(denied.state.statusCode, 403);
  assert.equal(managerNext, false);

  let accountantNext = false;
  await permission(request({}, "ACCOUNTANT"), response().response, () => { accountantNext = true; });
  assert.equal(accountantNext, true);
});

test("active-membership middleware rejects a missing or deactivated business membership", async (t) => {
  const restore = stubMethod(prisma.membership, "findFirst", (async () => null) as never);
  t.after(restore);
  const req = request() as Request;
  const { response: res, state } = response();
  let nextCalled = false;
  await requireActiveBusinessMembership(req, res, () => { nextCalled = true; });
  assert.equal(state.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("financial controller ignores client business IDs and scopes work to authenticated business", async (t) => {
  const queries: Array<{ model: string; args: unknown }> = [];
  setupFinancialPrisma(t, { empty: true, captures: queries });
  const { response: res, state } = response();
  await getFinancialDashboardController(request({ period: "month", businessId: "other-business" }), res);
  assert.equal(state.statusCode, 200);
  for (const { model, args } of queries) {
    const where = (args as { where?: { businessId?: string } }).where;
    if (model !== "purchaseItem") assert.equal(where?.businessId, "business-a", `${model} must be business-scoped`);
  }
});
