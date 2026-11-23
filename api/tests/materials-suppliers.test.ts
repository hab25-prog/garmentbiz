import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { prisma } from "../src/database/prisma.js";
import { requireCsrf } from "../src/middleware/auth.middleware.js";
import { createMaterialController, getMaterialsController, stockMovementsController, updateMaterialController } from "../src/modules/materials/materials.controller.js";
import materialsRoutes from "../src/modules/materials/materials.routes.js";
import { createSupplierController, getSuppliersController } from "../src/modules/suppliers/suppliers.controller.js";
import suppliersRoutes from "../src/modules/suppliers/suppliers.routes.js";

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function makeRequest(options: { body?: unknown; query?: Record<string, unknown>; params?: Record<string, string> } = {}): Request {
  return {
    body: options.body ?? {},
    query: options.query ?? {},
    params: options.params ?? {},
    businessPrincipal: {
      userId: "user-a",
      membershipId: "membership-a",
      businessId: "business-a",
      role: "OWNER",
      businessName: "Workshop A",
    },
  } as unknown as Request;
}

function makeResponse() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const response = {
    status(code: number) { state.statusCode = code; return response; },
    json(body: unknown) { state.body = body; return response; },
  } as unknown as Response;
  return { response, state };
}

test("material creation rejects a negative reorder level before database access", async (t) => {
  let called = false;
  const restore = stubMethod(prisma.material, "create", (async () => { called = true; }) as never);
  t.after(restore);

  const { response, state } = makeResponse();
  await createMaterialController(makeRequest({ body: { name: "Cotton", unitId: "unit-a", reorderLevel: -1 } }), response);

  assert.equal(state.statusCode, 400);
  assert.equal(called, false);
});

test("material creation reports a duplicate business SKU as a conflict", async (t) => {
  const restoreBusiness = stubMethod(prisma.business, "findUnique", (async () => ({ id: "business-a" })) as never);
  const restoreUnit = stubMethod(prisma.unitOfMeasure, "findFirst", (async () => ({ id: "unit-a" })) as never);
  const restoreMaterial = stubMethod(prisma.material, "create", (async () => { throw { code: "P2002" }; }) as never);
  t.after(restoreBusiness);
  t.after(restoreUnit);
  t.after(restoreMaterial);

  const { response, state } = makeResponse();
  await createMaterialController(makeRequest({ body: { name: "Cotton", unitId: "unit-a", sku: "COT-1" } }), response);

  assert.equal(state.statusCode, 409);
  assert.match((state.body as { message: string }).message, /SKU already exists/);
});

test("material creation requires and persists a unit owned by the active business", async (t) => {
  let unitQuery: unknown;
  let materialData: unknown;
  const restoreBusiness = stubMethod(prisma.business, "findUnique", (async () => ({ id: "business-a" })) as never);
  const restoreUnit = stubMethod(prisma.unitOfMeasure, "findFirst", (async (args: { where: unknown }) => {
    unitQuery = args.where;
    return { id: "unit-a" };
  }) as never);
  const restoreMaterial = stubMethod(prisma.material, "create", (async (args: { data: unknown }) => {
    materialData = args.data;
    return { id: "material-a", unit: { id: "unit-a", name: "Meter", code: "m" } };
  }) as never);
  t.after(restoreBusiness);
  t.after(restoreUnit);
  t.after(restoreMaterial);

  const { response, state } = makeResponse();
  await createMaterialController(makeRequest({ body: { name: "Cotton", unitId: "unit-a" } }), response);

  assert.equal(state.statusCode, 201);
  assert.deepEqual(unitQuery, { id: "unit-a", businessId: "business-a" });
  assert.deepEqual(materialData, {
    businessId: "business-a",
    unitId: "unit-a",
    name: "Cotton",
    type: "OTHER",
    reorderLevel: 0,
  });
});

test("materials list is scoped to authenticated business and can include archived rows", async (t) => {
  let query: { where: unknown } | undefined;
  const restoreMaterials = stubMethod(prisma.material, "findMany", (async (args: { where: unknown }) => {
    query = args;
    return [];
  }) as never);
  t.after(restoreMaterials);

  const { response, state } = makeResponse();
  await getMaterialsController(makeRequest({ query: { includeArchived: "true" } }), response);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(query?.where, { businessId: "business-a", unit: { businessId: "business-a" } });
});

test("material unit changes are rejected after movement history exists", async (t) => {
  const restoreMaterial = stubMethod(prisma.material, "findFirst", (async () => ({ id: "material-a", unitId: "unit-old" })) as never);
  const restoreUnit = stubMethod(prisma.unitOfMeasure, "findFirst", (async () => ({ id: "unit-new" })) as never);
  const restoreMovementCount = stubMethod(prisma.stockMovement, "count", (async () => 1) as never);
  const restoreLayerCount = stubMethod(prisma.materialCostLayer, "count", (async () => 0) as never);
  const restoreOperationCount = stubMethod(prisma.inventoryOperation, "count", (async () => 0) as never);
  const restorePurchaseCount = stubMethod(prisma.purchaseItem, "count", (async () => 0) as never);
  const restoreUsageCount = stubMethod(prisma.productionMaterialUsage, "count", (async () => 0) as never);
  t.after(restoreMaterial);
  t.after(restoreUnit);
  t.after(restoreMovementCount);
  t.after(restoreLayerCount);
  t.after(restoreOperationCount);
  t.after(restorePurchaseCount);
  t.after(restoreUsageCount);

  const { response, state } = makeResponse();
  await updateMaterialController(makeRequest({ params: { id: "material-a" }, body: { unitId: "unit-new" } }), response);

  assert.equal(state.statusCode, 409);
  assert.match((state.body as { message: string }).message, /unit cannot be changed/);
});

test("a material from another business cannot be updated", async (t) => {
  let query: unknown;
  const restore = stubMethod(prisma.material, "findFirst", (async (args: { where: unknown }) => {
    query = args.where;
    return null;
  }) as never);
  t.after(restore);

  const { response, state } = makeResponse();
  await updateMaterialController(makeRequest({ params: { id: "material-b" }, body: { name: "Changed" } }), response);

  assert.equal(state.statusCode, 404);
  assert.deepEqual(query, { id: "material-b", businessId: "business-a" });
});

test("stock history rejects unsupported movement filters as validation errors", async (t) => {
  let called = false;
  const restore = stubMethod(prisma.stockMovement, "findMany", (async () => { called = true; return []; }) as never);
  t.after(restore);

  const { response, state } = makeResponse();
  await stockMovementsController(makeRequest({ query: { type: "NOT_A_MOVEMENT" } }), response);

  assert.equal(state.statusCode, 400);
  assert.equal(called, false);
});

test("supplier creation validates email and rejects an existing business supplier name", async (t) => {
  const invalidEmail = makeResponse();
  await createSupplierController(makeRequest({ body: { name: "Supplier", email: "not-an-email" } }), invalidEmail.response);
  assert.equal(invalidEmail.state.statusCode, 400);

  const restoreBusiness = stubMethod(prisma.business, "findUnique", (async () => ({ id: "business-a" })) as never);
  const restoreSupplier = stubMethod(prisma.supplier, "findFirst", (async () => ({ id: "supplier-a" })) as never);
  t.after(restoreBusiness);
  t.after(restoreSupplier);

  const duplicate = makeResponse();
  await createSupplierController(makeRequest({ body: { name: "  Supplier A " } }), duplicate.response);
  assert.equal(duplicate.state.statusCode, 409);
});

test("supplier lists are limited to the authenticated business", async (t) => {
  let query: unknown;
  const restore = stubMethod(prisma.supplier, "findMany", (async (args: { where: unknown }) => {
    query = args.where;
    return [];
  }) as never);
  t.after(restore);

  const { response, state } = makeResponse();
  await getSuppliersController(makeRequest(), response);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(query, { businessId: "business-a", isActive: true });
});

test("materials and suppliers mutation routes require CSRF middleware", () => {
  const routeLayers = (router: typeof materialsRoutes) => (router as unknown as {
    stack: Array<{ route?: { methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>
  }).stack.filter((layer) => layer.route).map((layer) => layer.route!);

  for (const route of [...routeLayers(materialsRoutes), ...routeLayers(suppliersRoutes)]) {
    if (!route.methods.post && !route.methods.patch && !route.methods.put && !route.methods.delete) continue;
    assert.ok(route.stack.some((layer) => layer.handle === requireCsrf));
  }
});
