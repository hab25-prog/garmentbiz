import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import { createOrderPricingCalculation, getOrderPricing } from "../src/modules/orders/order-pricing.service.js";
import { createOrderPricingController } from "../src/modules/orders/orders.controller.js";
import ordersRoutes from "../src/modules/orders/orders.routes.js";
import { requireCsrf } from "../src/middleware/auth.middleware.js";

const D = Prisma.Decimal;
function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function pricingDb(options: { estimate?: { id: string; status: string; totalMaterialCost: Prisma.Decimal | null } | null; quantities?: number[] | null } = {}) {
  const saved: Array<Record<string, unknown>> = [];
  let serial = 0;
  const latestEstimate = options.estimate === undefined
    ? { id: "estimate-a", status: "COMPLETE", totalMaterialCost: new D("30000") }
    : options.estimate;
  const tx = {
    $queryRaw: async () => [],
    customerOrder: { findFirst: async (args: { where: unknown }) => args.where && options.quantities !== null
      ? { id: "order-a", items: (options.quantities ?? [3]).map((quantity) => ({ quantity })) }
      : null },
    orderMaterialEstimate: { findFirst: async () => latestEstimate },
    orderPricingCalculation: { create: async (args: { data: Record<string, unknown> }) => {
      const row = { id: `pricing-${++serial}`, ...args.data, calculatedAt: new Date("2026-11-24T12:00:00Z"), materialEstimate: latestEstimate };
      saved.push(row);
      return row;
    } },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (transaction: typeof tx) => Promise<unknown>, txOptions?: unknown) => {
    assert.equal((txOptions as { isolationLevel?: string } | undefined)?.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
    return callback(tx);
  }) as never);
  return { saved, restore };
}

test("uses the 5% default and calculates the approved 30,000 ETB example", async (t) => {
  const db = pricingDb(); t.after(db.restore);
  const result = await createOrderPricingCalculation("business-a", "order-a");
  assert.equal(String(result?.markupPercent), "5");
  assert.equal(String(result?.materialCost), "30000");
  assert.equal(String(result?.markupAmount), "1500");
  assert.equal(String(result?.minimumOrderPrice), "31500");
  assert.equal(String(result?.averageUnitPrice), "10500");
  assert.equal(String(result?.totalOrderedQuantity), "3");
});

test("supports zero markup", async (t) => {
  const db = pricingDb(); t.after(db.restore);
  const result = await createOrderPricingCalculation("business-a", "order-a", "0");
  assert.equal(String(result?.markupAmount), "0");
  assert.equal(String(result?.minimumOrderPrice), "30000");
});

test("supports decimal markup without binary floating point", async (t) => {
  const db = pricingDb({ estimate: { id: "estimate-a", status: "COMPLETE", totalMaterialCost: new D("100") }, quantities: [3] }); t.after(db.restore);
  const result = await createOrderPricingCalculation("business-a", "order-a", "5.25");
  assert.equal(String(result?.markupAmount), "5.25");
  assert.equal(String(result?.minimumOrderPrice), "105.25");
  assert.equal(String(result?.averageUnitPrice), "35.08");
});

test("rounds markup amount and average unit price to two decimal places", async (t) => {
  const db = pricingDb({ estimate: { id: "estimate-a", status: "COMPLETE", totalMaterialCost: new D("0.05") }, quantities: [3] }); t.after(db.restore);
  const result = await createOrderPricingCalculation("business-a", "order-a", "5");
  assert.equal(String(result?.markupAmount), "0");
  assert.equal(String(result?.minimumOrderPrice), "0.05");
  assert.equal(String(result?.averageUnitPrice), "0.02");
});

test("rejects invalid, negative, excessive, and over-precision markup", async () => {
  for (const value of ["-1", "1000.01", "1.001", "abc", "1e2", 5]) {
    await assert.rejects(createOrderPricingCalculation("business-a", "order-a", value), /Markup must/);
  }
  assert.equal(new D("1000.00").toFixed(2), "1000.00");
});

test("rejects pricing when no estimate exists", async (t) => {
  const db = pricingDb({ estimate: null }); t.after(db.restore);
  await assert.rejects(createOrderPricingCalculation("business-a", "order-a"), /material estimate is required/);
  assert.equal(db.saved.length, 0);
});

test("rejects pricing when the latest estimate is incomplete", async (t) => {
  const db = pricingDb({ estimate: { id: "estimate-new", status: "INCOMPLETE", totalMaterialCost: null } }); t.after(db.restore);
  await assert.rejects(createOrderPricingCalculation("business-a", "order-a"), /latest material estimate is incomplete/);
  assert.equal(db.saved.length, 0);
});

test("rejects zero total order quantity", async (t) => {
  const db = pricingDb({ quantities: [0] }); t.after(db.restore);
  await assert.rejects(createOrderPricingCalculation("business-a", "order-a"), /Order quantity must be greater than zero/);
  assert.equal(db.saved.length, 0);
});

test("pricing creation is business scoped and returns not found for a foreign order", async (t) => {
  const db = pricingDb({ quantities: null }); t.after(db.restore);
  assert.equal(await createOrderPricingCalculation("business-a", "order-from-b"), null);
  assert.equal(db.saved.length, 0);
});

test("every recalculation creates a new immutable history row", async (t) => {
  const db = pricingDb(); t.after(db.restore);
  const first = await createOrderPricingCalculation("business-a", "order-a", "5");
  const second = await createOrderPricingCalculation("business-a", "order-a", "10");
  assert.notEqual(first?.id, second?.id);
  assert.equal(db.saved.length, 2);
  assert.equal(String(db.saved[0]?.markupPercent), "5");
  assert.equal(String(db.saved[1]?.markupPercent), "10");
});

test("pricing from an older estimate is not current when the latest estimate changes", async (t) => {
  const tx = {
    customerOrder: { findFirst: async () => ({ id: "order-a" }) },
    orderMaterialEstimate: { findFirst: async () => ({ id: "estimate-new", status: "COMPLETE", totalMaterialCost: new D("500"), estimatedAt: new Date() }) },
    orderPricingCalculation: { findMany: async () => [{ id: "pricing-old", materialEstimateId: "estimate-old", calculatedAt: new Date(), materialEstimate: { id: "estimate-old", status: "COMPLETE" } }] },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (transaction: typeof tx) => Promise<unknown>, txOptions?: unknown) => {
    assert.equal((txOptions as { isolationLevel?: string } | undefined)?.isolationLevel, Prisma.TransactionIsolationLevel.RepeatableRead);
    return callback(tx);
  }) as never);
  t.after(restore);
  const result = await getOrderPricing("business-a", "order-a");
  assert.equal(result?.currentPricing, null);
  assert.equal(result?.history.length, 1);
});

test("owner authorization rejects non-owner before running the pricing service", async () => {
  let transactionStarted = false;
  const restore = stubMethod(prisma, "$transaction", (async () => { transactionStarted = true; return null; }) as never);
  const state: { status?: number; body?: unknown } = {};
  const res = { status(code: number) { state.status = code; return this; }, json(body: unknown) { state.body = body; return this; } } as unknown as Response;
  const req = { params: { id: "order-a" }, body: { markupPercent: "5" }, query: {}, businessPrincipal: { businessId: "business-a", role: "MANAGER" } } as unknown as Request;
  try { await createOrderPricingController(req, res); } finally { restore(); }
  assert.equal(state.status, 403);
  assert.equal(transactionStarted, false);
});

test("OWNER can create pricing and the authenticated business overrides client businessId", async (t) => {
  let queriedBusinessId: unknown;
  const tx = {
    $queryRaw: async () => [],
    customerOrder: { findFirst: async () => ({ id: "order-a", items: [{ quantity: 3 }] }) },
    orderMaterialEstimate: { findFirst: async (args: { where: { businessId: string } }) => {
      queriedBusinessId = args.where.businessId;
      return { id: "estimate-a", status: "COMPLETE", totalMaterialCost: new D("30000") };
    } },
    orderPricingCalculation: { create: async (args: { data: Record<string, unknown> }) => ({ id: "pricing-owner", ...args.data }) },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)) as never);
  t.after(restore);
  const state: { status?: number; body?: unknown } = {};
  const res = { status(code: number) { state.status = code; return this; }, json(body: unknown) { state.body = body; return this; } } as unknown as Response;
  const req = {
    params: { id: "order-a" },
    body: { businessId: "business-b" },
    query: {},
    businessPrincipal: { businessId: "business-a", role: "OWNER" },
  } as unknown as Request;
  await createOrderPricingController(req, res);
  assert.equal(state.status, 201);
  assert.equal(queriedBusinessId, "business-a");
});

test("pricing mutation route has CSRF middleware", () => {
  const stack = (ordersRoutes as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: unknown }>;
      };
    }>;
  }).stack;
  const route = stack.map((layer) => layer.route).find((item) => item?.path === "/:id/pricing" && item.methods.post);
  assert.ok(route);
  assert.ok(route.stack.some((layer) => layer.handle === requireCsrf));
});

test("pricing transaction only has order, estimate, and pricing delegates", async (t) => {
  const db = pricingDb(); t.after(db.restore);
  await createOrderPricingCalculation("business-a", "order-a");
  // The transaction mock intentionally exposes no inventory, FIFO, allocation, or production delegates.
  assert.equal(db.saved.length, 1);
});
