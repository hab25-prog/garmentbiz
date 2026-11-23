import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import {
  createOrderMaterialEstimate,
  getOrderMaterialEstimate,
  getOrderMaterialEstimates,
} from "../src/modules/orders/order-material-estimates.service.js";
import { getOrderMaterialEstimatesController } from "../src/modules/orders/orders.controller.js";
import ordersRoutes from "../src/modules/orders/orders.routes.js";
import { requireCsrf } from "../src/middleware/auth.middleware.js";

const D = Prisma.Decimal;
type OrderItemInput = { id: string; productId: string; quantity: number; product: { id: string; businessId: string; name: string } };
type BomInput = { productId: string; materialId: string; quantityPerUnit: Prisma.Decimal };
type LayerInput = { id: string; remainingQty: Prisma.Decimal; unitCost: Prisma.Decimal; receivedAt: Date; createdAt: Date };

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function estimateDatabase(options: {
  items?: OrderItemInput[];
  bom?: BomInput[];
  stock?: Record<string, Prisma.Decimal>;
  layers?: Record<string, LayerInput[]>;
  orderBusinessId?: string;
} = {}) {
  const items = options.items ?? [{ id: "order-item-1", productId: "product-1", quantity: 2, product: { id: "product-1", businessId: "business-a", name: "Cotton shirt" } }];
  const bom = options.bom ?? [{ productId: "product-1", materialId: "fabric", quantityPerUnit: new D("1.5") }];
  const stock = options.stock ?? { fabric: new D("4") };
  const layers = options.layers ?? { fabric: [{ id: "layer-1", remainingQty: new D("4"), unitCost: new D("10"), receivedAt: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z") }] };
  const saved = { estimates: [] as Array<Record<string, unknown>>, items: [] as Array<Record<string, unknown>>, materials: [] as Array<Record<string, unknown>>, requirements: [] as Array<Record<string, unknown>>, fifoLayers: [] as Array<Record<string, unknown>>, scopes: [] as unknown[], inventoryWrites: 0, txOptions: [] as unknown[] };
  let estimateSequence = 0;
  const materialRows = [...new Set(bom.map((row) => row.materialId))].map((id) => ({
    id,
    businessId: "business-a",
    unitId: `unit-${id}`,
    name: id === "fabric" ? "Cotton fabric" : id,
    unit: { id: `unit-${id}`, businessId: "business-a", name: "Meter", code: "m" },
  }));
  const tx = {
    $queryRaw: async () => [],
    customerOrder: { findFirst: async (args: { where: Record<string, unknown> }) => {
      saved.scopes.push(args.where);
      if (options.orderBusinessId === "business-b" || args.where.businessId !== "business-a") return null;
      return { id: "order-a", businessId: "business-a", items };
    } },
    productMaterialRequirement: { findMany: async (args: { where: unknown }) => { saved.scopes.push(args.where); return bom; } },
    material: { findMany: async (args: { where: { id: { in: string[] } } }) => materialRows.filter((row) => args.where.id.in.includes(row.id)) },
    stockMovement: { aggregate: async (args: { where: { materialId: string } }) => ({ _sum: { quantity: stock[args.where.materialId] ?? new D(0) } }) },
    materialCostLayer: { findMany: async (args: { where: { materialId: string } }) => layers[args.where.materialId] ?? [] },
    orderMaterialEstimate: {
      create: async (args: { data: Record<string, unknown> }) => { const record = { id: `estimate-${++estimateSequence}`, ...args.data }; saved.estimates.push(record); return record; },
      findFirst: async (args: { where: { id: string } }) => saved.estimates.find((record) => record.id === args.where.id) ?? null,
    },
    orderMaterialEstimateItem: { create: async (args: { data: Record<string, unknown> }) => { const record = { id: `snapshot-${String(args.data.orderItemId)}`, ...args.data }; saved.items.push(record); return { id: record.id }; } },
    orderMaterialEstimateMaterial: { create: async (args: { data: Record<string, unknown> }) => { const record = { id: `line-${String(args.data.materialId)}`, ...args.data }; saved.materials.push(record); return { id: record.id }; } },
    orderMaterialEstimateRequirement: { createMany: async (args: { data: Array<Record<string, unknown>> }) => { saved.requirements.push(...args.data); return { count: args.data.length }; } },
    orderMaterialEstimateLayer: { createMany: async (args: { data: Array<Record<string, unknown>> }) => { saved.fifoLayers.push(...args.data); return { count: args.data.length }; } },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (transaction: typeof tx) => Promise<unknown>, transactionOptions?: unknown) => {
    saved.txOptions.push(transactionOptions);
    return callback(tx);
  }) as never);
  return { saved, restore };
}

function layer(id: string, quantity: string, cost: string, date: string): LayerInput {
  const receivedAt = new Date(date);
  return { id, remainingQty: new D(quantity), unitCost: new D(cost), receivedAt, createdAt: receivedAt };
}

test("estimates one product with one BOM material", async (t) => {
  const db = estimateDatabase(); t.after(db.restore);
  await createOrderMaterialEstimate("business-a", "order-a");
  assert.equal(db.saved.estimates[0]?.status, "COMPLETE");
  assert.equal(String(db.saved.estimates[0]?.totalMaterialCost), "30");
  assert.equal(String(db.saved.materials[0]?.requiredQuantity), "3");
  assert.equal(db.saved.items[0]?.hasBom, true);
});

test("estimates multiple BOM materials for a product", async (t) => {
  const db = estimateDatabase({
    bom: [
      { productId: "product-1", materialId: "fabric", quantityPerUnit: new D("1.25") },
      { productId: "product-1", materialId: "thread", quantityPerUnit: new D("0.1") },
    ],
    stock: { fabric: new D("3"), thread: new D("1") },
    layers: { fabric: [layer("f1", "3", "10", "2026-01-01")], thread: [layer("t1", "1", "2", "2026-01-02")] },
  }); t.after(db.restore);
  await createOrderMaterialEstimate("business-a", "order-a");
  assert.equal(db.saved.materials.length, 2);
  assert.equal(String(db.saved.estimates[0]?.totalMaterialCost), "25.4");
});

test("aggregates the same material across multiple order items", async (t) => {
  const db = estimateDatabase({
    items: [
      { id: "item-a", productId: "product-1", quantity: 2, product: { id: "product-1", businessId: "business-a", name: "Shirt" } },
      { id: "item-b", productId: "product-2", quantity: 3, product: { id: "product-2", businessId: "business-a", name: "Blouse" } },
    ],
    bom: [
      { productId: "product-1", materialId: "fabric", quantityPerUnit: new D("1.25") },
      { productId: "product-2", materialId: "fabric", quantityPerUnit: new D("0.5") },
    ],
    stock: { fabric: new D("10") }, layers: { fabric: [layer("f1", "10", "4", "2026-01-01")] },
  }); t.after(db.restore);
  await createOrderMaterialEstimate("business-a", "order-a");
  assert.equal(db.saved.materials.length, 1);
  assert.equal(String(db.saved.materials[0]?.requiredQuantity), "4");
  assert.equal(db.saved.requirements.length, 2);
});

test("simulates FIFO allocation over multiple cost layers without changing layers", async (t) => {
  const db = estimateDatabase({
    stock: { fabric: new D("4") },
    layers: { fabric: [layer("old", "2", "10", "2026-01-01"), layer("new", "2", "12", "2026-02-01")] },
  }); t.after(db.restore);
  await createOrderMaterialEstimate("business-a", "order-a");
  assert.equal(db.saved.fifoLayers.length, 2);
  assert.deepEqual(db.saved.fifoLayers.map((row) => String(row.allocatedQuantity)), ["2", "1"]);
  assert.deepEqual(db.saved.fifoLayers.map((row) => String(row.unitCostSnapshot)), ["10", "12"]);
  assert.equal(String(db.saved.materials[0]?.estimatedCost), "32");
  assert.equal(db.saved.inventoryWrites, 0);
});

test("marks insufficient inventory incomplete with an explicit shortage and no total cost", async (t) => {
  const db = estimateDatabase({ stock: { fabric: new D("2") }, layers: { fabric: [layer("f1", "2", "10", "2026-01-01")] } }); t.after(db.restore);
  await createOrderMaterialEstimate("business-a", "order-a");
  assert.equal(db.saved.estimates[0]?.status, "INCOMPLETE");
  assert.equal(db.saved.estimates[0]?.totalMaterialCost, null);
  assert.equal(db.saved.materials[0]?.status, "INSUFFICIENT_STOCK");
  assert.equal(String(db.saved.materials[0]?.shortageQuantity), "1");
  assert.equal(db.saved.materials[0]?.estimatedCost, null);
});

test("marks an order item with no BOM incomplete instead of treating material cost as zero", async (t) => {
  const db = estimateDatabase({ bom: [], stock: {}, layers: {} }); t.after(db.restore);
  await createOrderMaterialEstimate("business-a", "order-a");
  assert.equal(db.saved.items[0]?.hasBom, false);
  assert.equal(db.saved.estimates[0]?.status, "INCOMPLETE");
  assert.equal(db.saved.estimates[0]?.totalMaterialCost, null);
});

test("marks materials with no FIFO cost layers incomplete", async (t) => {
  const db = estimateDatabase({ stock: { fabric: new D("0") }, layers: { fabric: [] } }); t.after(db.restore);
  await createOrderMaterialEstimate("business-a", "order-a");
  assert.equal(db.saved.materials[0]?.status, "NO_COST_LAYERS");
  assert.equal(db.saved.materials[0]?.estimatedCost, null);
});

test("keeps decimal quantities and money in Decimal arithmetic", async (t) => {
  const db = estimateDatabase({
    items: [{ id: "item-a", productId: "product-1", quantity: 3, product: { id: "product-1", businessId: "business-a", name: "Shirt" } }],
    bom: [{ productId: "product-1", materialId: "fabric", quantityPerUnit: new D("0.125") }],
    stock: { fabric: new D("1") }, layers: { fabric: [layer("f1", "1", "0.10", "2026-01-01")] },
  }); t.after(db.restore);
  await createOrderMaterialEstimate("business-a", "order-a");
  assert.equal(String(db.saved.materials[0]?.requiredQuantity), "0.375");
  assert.equal(String(db.saved.materials[0]?.estimatedCost), "0.04");
});

test("rejects and does not expose an order belonging to another business", async (t) => {
  const db = estimateDatabase({ orderBusinessId: "business-b" }); t.after(db.restore);
  assert.equal(await createOrderMaterialEstimate("business-a", "order-a"), null);
  assert.equal(db.saved.estimates.length, 0);
});

test("estimate reads and details remain business and order scoped", async (t) => {
  let estimateWhere: unknown;
  const restoreOrder = stubMethod(prisma.customerOrder, "findFirst", (async () => ({ id: "order-a" })) as never);
  const restoreList = stubMethod(prisma.orderMaterialEstimate, "findMany", (async (args: { where: unknown }) => { estimateWhere = args.where; return []; }) as never);
  const restoreDetail = stubMethod(prisma.orderMaterialEstimate, "findFirst", (async (args: { where: unknown }) => { estimateWhere = args.where; return { id: "estimate-1" }; }) as never);
  t.after(restoreOrder); t.after(restoreList); t.after(restoreDetail);
  await getOrderMaterialEstimates("business-a", "order-a");
  assert.deepEqual(estimateWhere, { businessId: "business-a", orderId: "order-a" });
  await getOrderMaterialEstimate("business-a", "order-a", "estimate-1");
  assert.deepEqual(estimateWhere, { id: "estimate-1", businessId: "business-a", orderId: "order-a" });
});

test("a BOM/inventory change followed by re-estimation creates a new immutable snapshot", async (t) => {
  const source = { bom: [{ productId: "product-1", materialId: "fabric", quantityPerUnit: new D("1.5") }], stock: { fabric: new D("4") }, layers: { fabric: [layer("f1", "4", "10", "2026-01-01")] } };
  const db = estimateDatabase(source); t.after(db.restore);
  await createOrderMaterialEstimate("business-a", "order-a");
  source.bom[0]!.quantityPerUnit = new D("2");
  source.layers.fabric[0]!.unitCost = new D("15");
  await createOrderMaterialEstimate("business-a", "order-a");
  assert.equal(db.saved.estimates.length, 2);
  assert.equal(String(db.saved.estimates[0]?.totalMaterialCost), "30");
  assert.equal(String(db.saved.estimates[1]?.totalMaterialCost), "60");
  assert.equal(String(db.saved.materials[0]?.requiredQuantity), "3");
  assert.equal(db.saved.txOptions.every((options) => (options as { isolationLevel: string }).isolationLevel === "Serializable"), true);
});

test("concurrent estimates create separate snapshots instead of overwriting", async (t) => {
  const db = estimateDatabase(); t.after(db.restore);
  const [first, second] = await Promise.all([
    createOrderMaterialEstimate("business-a", "order-a"),
    createOrderMaterialEstimate("business-a", "order-a"),
  ]);
  assert.notEqual(first?.id, second?.id);
  assert.equal(db.saved.estimates.length, 2);
});

test("unauthorized estimate listing returns 401 before querying order data", async (t) => {
  let queried = false;
  const restore = stubMethod(prisma.customerOrder, "findFirst", (async () => { queried = true; return null; }) as never);
  t.after(restore);
  const responseState: { code?: number; body?: unknown } = {};
  const response = { status(code: number) { responseState.code = code; return this; }, json(body: unknown) { responseState.body = body; return this; } } as unknown as Response;
  const request = { params: { id: "order-a" }, query: {}, body: {} } as unknown as Request;
  await getOrderMaterialEstimatesController(request, response);
  assert.equal(responseState.code, 401);
  assert.equal(queried, false);
});

test("estimate generation is CSRF protected", () => {
  const stack = (ordersRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }> }).stack;
  const route = stack.map((layer) => layer.route).find((candidate) => candidate?.path === "/:id/material-estimates" && candidate.methods.post);
  assert.ok(route);
  assert.ok(route.stack.some((layer) => layer.handle === requireCsrf));
});
