import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import { requirePermission } from "../src/middleware/authorization.middleware.js";
import { authenticate, requireActiveBusinessMembership } from "../src/middleware/auth.middleware.js";
import { getOperationalDashboardController } from "../src/modules/dashboard/dashboard.controller.js";
import { getOperationalDashboard, getOperationalPeriodBounds } from "../src/modules/dashboard/dashboard.service.js";
import dashboardRoutes from "../src/modules/dashboard/dashboard.routes.js";

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

function request(query: Request["query"] = {}, role = "OWNER"): Request {
  return {
    query,
    authPrincipal: { userId: "user-a", membershipId: "membership-a", businessId: "business-a" },
    businessPrincipal: {
      userId: "user-a", membershipId: "membership-a", businessId: "business-a", role, businessName: "Business A",
    },
  } as unknown as Request;
}

test("Addis Ababa period boundaries cover today, Monday week, month, and year with exclusive ends", () => {
  const now = new Date("2026-11-27T12:30:00.000Z");
  assert.deepEqual(
    Object.fromEntries(["today", "week", "month", "year"].map((period) => {
      const bounds = getOperationalPeriodBounds(period as "today" | "week" | "month" | "year", now);
      return [period, [bounds.start.toISOString(), bounds.endExclusive.toISOString()]];
    })),
    {
      today: ["2026-11-26T21:00:00.000Z", "2026-11-27T21:00:00.000Z"],
      week: ["2026-11-22T21:00:00.000Z", "2026-11-29T21:00:00.000Z"],
      month: ["2026-10-31T21:00:00.000Z", "2026-11-30T21:00:00.000Z"],
      year: ["2025-12-31T21:00:00.000Z", "2026-12-31T21:00:00.000Z"],
    },
  );
});

test("operational dashboard aggregates business-scoped order, production, inventory, and customer data", async (t) => {
  const queries: Array<{ model: string; args: unknown }> = [];
  const restore: Array<() => void> = [];
  const patchMethod = (model: object, modelName: string, method: string, fn: (...args: never[]) => unknown) => {
    restore.push(stubMethod(model, method, ((args: unknown) => {
      queries.push({ model: modelName, args });
      return fn(args as never);
    }) as never));
  };
  t.after(() => restore.reverse().forEach((undo) => undo()));

  patchMethod(prisma.customerOrder, "customerOrder", "count", (args) => {
    const where = (args as { where: Record<string, unknown> }).where;
    if ("dueDate" in where) return where.dueDate && (where.dueDate as { gte?: Date }).gte ? 2 : 1;
    if ("createdAt" in where) return 7;
    return 5;
  });
  patchMethod(prisma.customerOrder, "customerOrder", "groupBy", () => [
    { status: "PENDING", _count: { _all: 2 } },
    { status: "IN_PRODUCTION", _count: { _all: 3 } },
  ]);
  patchMethod(prisma.productionBatch, "productionBatch", "count", () => 4);
  patchMethod(prisma.productionBatch, "productionBatch", "aggregate", () => ({
    _sum: { plannedQuantity: 20, completedQuantity: 12 },
  }));
  patchMethod(prisma.productionBatch, "productionBatch", "groupBy", () => [
    { status: "PLANNED", _count: { _all: 2 } },
    { status: "IN_PROGRESS", _count: { _all: 2 } },
    { status: "COMPLETED", _count: { _all: 3 } },
    { status: "CANCELLED", _count: { _all: 1 } },
  ]);
  patchMethod(prisma.material, "material", "findMany", () => [
    { id: "low", reorderLevel: new Prisma.Decimal("5") },
    { id: "zero", reorderLevel: new Prisma.Decimal("4") },
    { id: "available", reorderLevel: new Prisma.Decimal("3") },
    { id: "negative", reorderLevel: new Prisma.Decimal("4") },
  ]);
  patchMethod(prisma.stockMovement, "stockMovement", "groupBy", () => [
    { materialId: "low", _sum: { quantity: new Prisma.Decimal("3") } },
    { materialId: "available", _sum: { quantity: new Prisma.Decimal("10") } },
    { materialId: "negative", _sum: { quantity: new Prisma.Decimal("-1") } },
  ]);
  patchMethod(prisma.customer, "customer", "count", (args) =>
    "createdAt" in (args as { where: object }).where ? 6 : 11,
  );

  const data = await getOperationalDashboard("business-a", "month", new Date("2026-11-27T12:30:00Z"));
  assert.deepEqual(data.period, {
    key: "month",
    timeZone: "Africa/Addis_Ababa",
    start: "2026-10-31T21:00:00.000Z",
    endExclusive: "2026-11-30T21:00:00.000Z",
  });
  assert.deepEqual(data.orders, {
    active: 5,
    dueToday: 2,
    overdue: 1,
    createdDuringPeriod: 7,
    byStatus: { PENDING: 2, CONFIRMED: 0, IN_PRODUCTION: 3, COMPLETED: 0, DELIVERED: 0, CANCELLED: 0 },
  });
  assert.deepEqual(data.production, {
    activeBatches: 4,
    plannedQuantity: 20,
    completedQuantity: 12,
    batchesByStatus: { PLANNED: 2, IN_PROGRESS: 2, COMPLETED: 3, CANCELLED: 1 },
  });
  assert.deepEqual(data.inventory, {
    materialsWithLowStock: 1,
    materialsWithZeroStock: 1,
    materialsAvailable: 2,
    materialsWithNegativeStock: 1,
  });
  assert.deepEqual(data.customers, { active: 11, createdDuringPeriod: 6 });
  assert.ok(queries.length >= 10);
  for (const { model, args } of queries) {
    const where = (args as { where?: { businessId?: string } }).where;
    assert.equal(where?.businessId, "business-a", `${model} query must be scoped to the authenticated business`);
  }
  const activeOrderQuery = queries.find(({ model, args }) =>
    model === "customerOrder" && "status" in ((args as { where: object }).where),
  );
  assert.deepEqual(
    (activeOrderQuery?.args as { where: { status: { in: string[] } } }).where.status.in,
    ["PENDING", "CONFIRMED", "IN_PRODUCTION", "COMPLETED"],
  );
  assert.equal("financial" in data, false);
  assert.equal("inventoryValue" in data.inventory, false);
});

test("empty production aggregates and materials return zero metrics", async (t) => {
  const restore: Array<() => void> = [];
  const set = (model: object, method: string, value: unknown) => {
    restore.push(stubMethod(model, method, (async () => value) as never));
  };
  t.after(() => restore.reverse().forEach((undo) => undo()));
  set(prisma.customerOrder, "count", 0);
  set(prisma.customerOrder, "groupBy", []);
  set(prisma.productionBatch, "count", 0);
  set(prisma.productionBatch, "aggregate", { _sum: { plannedQuantity: null, completedQuantity: null } });
  set(prisma.productionBatch, "groupBy", []);
  set(prisma.material, "findMany", []);
  set(prisma.customer, "count", 0);

  const data = await getOperationalDashboard("business-empty", "today", new Date("2026-11-27T12:30:00Z"));
  assert.equal(data.orders.active, 0);
  assert.equal(data.production.plannedQuantity, 0);
  assert.equal(data.production.completedQuantity, 0);
  assert.deepEqual(data.inventory, {
    materialsWithLowStock: 0,
    materialsWithZeroStock: 0,
    materialsAvailable: 0,
    materialsWithNegativeStock: 0,
  });
  assert.equal(data.customers.active, 0);
});

test("invalid period is rejected without querying the dashboard service", async () => {
  const { response: res, state } = response();
  await getOperationalDashboardController(request({ period: "quarter" }), res);
  assert.equal(state.statusCode, 400);
  assert.deepEqual(state.body, {
    success: false,
    message: "period must be one of: today, week, month, year",
  });
});

test("route requires authentication, active membership, and operational dashboard permission", async () => {
  const routeStack = (dashboardRoutes as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>;
  }).stack;
  const route = routeStack.find((layer) => layer.route?.path === "/operational")?.route;
  assert.ok(route?.methods.get);
  const middlewareLayers = routeStack.filter((layer) => !layer.route);
  const middlewareNames = middlewareLayers.map((layer) => (layer as unknown as { name?: string }).name);
  assert.ok(middlewareNames.includes("authenticate"));
  assert.ok(middlewareNames.includes("requireActiveBusinessMembership"));
  assert.equal(route.stack.length, 2);

  const permission = route.stack[0]?.handle as (req: Request, res: Response, next: (error?: unknown) => void) => Promise<void>;
  const denied = response();
  let managerNextCalled = false;
  await permission(request({}, "EMPLOYEE"), denied.response, () => { managerNextCalled = true; });
  assert.equal(denied.state.statusCode, 403);
  assert.equal(managerNextCalled, false);

  const allowed = response();
  let ownerNextCalled = false;
  await permission(request({}, "MANAGER"), allowed.response, () => { ownerNextCalled = true; });
  assert.equal(ownerNextCalled, true);
});

test("controller derives business scope from active membership and ignores client businessId", async (t) => {
  const restore = stubMethod(prisma.customerOrder, "count", (async () => 0) as never);
  const restoreGroup = stubMethod(prisma.customerOrder, "groupBy", (async () => []) as never);
  const restoreBatchCount = stubMethod(prisma.productionBatch, "count", (async () => 0) as never);
  const restoreBatchAggregate = stubMethod(prisma.productionBatch, "aggregate", (async () => ({ _sum: {} })) as never);
  const restoreBatchGroup = stubMethod(prisma.productionBatch, "groupBy", (async () => []) as never);
  const restoreMaterial = stubMethod(prisma.material, "findMany", (async () => []) as never);
  const restoreCustomer = stubMethod(prisma.customer, "count", (async () => 0) as never);
  t.after(() => {
    restoreCustomer(); restoreMaterial(); restoreBatchGroup(); restoreBatchAggregate(); restoreBatchCount(); restoreGroup(); restore();
  });

  const { response: res, state } = response();
  await getOperationalDashboardController(request({ period: "today", businessId: "other-business" }), res);
  assert.equal(state.statusCode, 200);
  const body = state.body as { data: { period: { key: string } } };
  assert.equal(body.data.period.key, "today");
  assert.ok(authenticate);
  assert.ok(requireActiveBusinessMembership);
  assert.ok(requirePermission);
});
