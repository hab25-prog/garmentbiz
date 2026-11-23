import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import {
  createProductMaterialRequirement,
  getProductMaterialRequirements,
  parseBomQuantity,
  removeProductMaterialRequirement,
  updateProductMaterialRequirement,
} from "../src/modules/products/products.service.js";
import productsRoutes from "../src/modules/products/products.routes.js";
import { requireCsrf } from "../src/middleware/auth.middleware.js";
import type { Request, Response } from "express";
import { createProductMaterialRequirementController } from "../src/modules/products/products.controller.js";

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function mockTransaction(options: { productExists?: boolean; materialExists?: boolean } = {}) {
  const calls: { created?: Record<string, unknown>; updated?: Record<string, unknown>; deleted?: unknown } = {};
  const tx = {
    product: { findFirst: async () => options.productExists === false ? null : { id: "product-a" } },
    material: { findFirst: async () => options.materialExists === false ? null : { id: "material-a" } },
    productMaterialRequirement: {
      findMany: async (args: unknown) => { calls.deleted = args; return [{ id: "requirement-a" }]; },
      findFirst: async () => ({ id: "requirement-a" }),
      create: async (args: { data: Record<string, unknown> }) => { calls.created = args.data; return { id: "requirement-a", ...args.data }; },
      update: async (args: { data: Record<string, unknown> }) => { calls.updated = args.data; return { id: "requirement-a", ...args.data }; },
      deleteMany: async (args: unknown) => { calls.deleted = args; return { count: 1 }; },
    },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) as never);
  return { calls, restore };
}

test("BOM quantity parsing preserves three-place Decimal precision", () => {
  assert.equal(parseBomQuantity("0.125").toFixed(3), "0.125");
  assert.throws(() => parseBomQuantity("0"), /greater than zero/);
  assert.throws(() => parseBomQuantity("-1"), /positive decimal/);
  assert.throws(() => parseBomQuantity("0.0001"), /positive decimal/);
});

test("creates a material requirement using Decimal quantity per finished unit", async (t) => {
  const db = mockTransaction();
  t.after(db.restore);
  const result = await createProductMaterialRequirement("business-a", "product-a", "material-a", new Prisma.Decimal("1.125"));
  assert.equal(result.id, "requirement-a");
  assert.equal(db.calls.created?.businessId, "business-a");
  assert.equal(String(db.calls.created?.quantityPerUnit), "1.125");
});

test("retrieves requirements scoped to the business and product with the base unit", async (t) => {
  let requirementWhere: unknown;
  const restoreProduct = stubMethod(prisma.product, "findFirst", (async (args: { where: unknown }) => args.where) as never);
  const restoreList = stubMethod(prisma.productMaterialRequirement, "findMany", (async (args: { where: unknown }) => { requirementWhere = args.where; return []; }) as never);
  t.after(restoreProduct); t.after(restoreList);
  const result = await getProductMaterialRequirements("business-a", "product-a");
  assert.deepEqual(result, []);
  assert.deepEqual(requirementWhere, { businessId: "business-a", productId: "product-a" });
});

test("rejects a product owned by another business", async (t) => {
  const db = mockTransaction({ productExists: false }); t.after(db.restore);
  await assert.rejects(createProductMaterialRequirement("business-a", "product-b", "material-a", new Prisma.Decimal("1")), { message: "Product not found for this business" });
  assert.equal(db.calls.created, undefined);
});

test("rejects a material owned by another business or inactive material", async (t) => {
  const db = mockTransaction({ materialExists: false }); t.after(db.restore);
  await assert.rejects(createProductMaterialRequirement("business-a", "product-a", "material-b", new Prisma.Decimal("1")), { message: "Active material not found for this business" });
  assert.equal(db.calls.created, undefined);
});

test("updates a requirement quantity", async (t) => {
  const db = mockTransaction(); t.after(db.restore);
  await updateProductMaterialRequirement("business-a", "product-a", "requirement-a", new Prisma.Decimal("0.375"));
  assert.equal(String(db.calls.updated?.quantityPerUnit), "0.375");
});

test("removes only a requirement scoped to its business and product", async (t) => {
  const db = mockTransaction(); t.after(db.restore);
  assert.equal(await removeProductMaterialRequirement("business-a", "product-a", "requirement-a"), true);
  assert.deepEqual(db.calls.deleted, { where: { id: "requirement-a", businessId: "business-a", productId: "product-a" } });
});

test("duplicate material requirements return a conflict response", async (t) => {
  const duplicate = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
  const tx = {
    product: { findFirst: async () => ({ id: "product-a" }) },
    material: { findFirst: async () => ({ id: "material-a" }) },
    productMaterialRequirement: { create: async () => { throw duplicate; } },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) as never);
  t.after(restore);
  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as Response;
  const request = {
    body: { materialId: "material-a", quantityPerUnit: "1.250" },
    params: { productId: "product-a" },
    query: {},
    businessPrincipal: { businessId: "business-a" },
  } as unknown as Request;
  await createProductMaterialRequirementController(request, response);
  assert.equal(state.status, 409);
  assert.deepEqual(state.body, { success: false, message: "This material is already included in the product requirements" });
});

test("all BOM mutation routes include CSRF validation", () => {
  const stack = (productsRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> }; handle: unknown }> }).stack;
  const routes = stack.flatMap((layer) => layer.route ? [layer.route] : []);
  const mutations = routes.filter((route) => ["post", "patch", "delete"].some((method) => route.methods[method]) && route.path.includes("material-requirements"));
  assert.equal(mutations.length, 3);
  for (const route of mutations) assert.ok(route.stack.some((layer) => layer.handle === requireCsrf), `${route.path} must require CSRF`);
});
