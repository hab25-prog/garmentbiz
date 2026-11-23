import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { prisma } from "../src/database/prisma.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../src/middleware/auth.middleware.js";
import unitsRoutes from "../src/modules/units/units.routes.js";
import { createUnitController, getUnitsController, initializeDefaultUnitsController } from "../src/modules/units/units.controller.js";
import { ensureDefaultUnits } from "../src/modules/units/units.service.js";

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function makeResponse() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(code: number) { state.statusCode = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as Response;
  return { res, state };
}

function makeRequest(options: { body?: unknown; query?: Record<string, unknown> } = {}): Request {
  return {
    body: options.body ?? {},
    query: options.query ?? {},
    businessPrincipal: {
      userId: "user-a",
      membershipId: "membership-a",
      businessId: "business-a",
      role: "OWNER",
      businessName: "Workshop A",
    },
  } as unknown as Request;
}

test("GET /api/units requires authentication and an active membership", () => {
  const layers = (unitsRoutes as unknown as {
    stack: Array<{ route?: unknown; handle: unknown }>;
  }).stack;
  const middleware = layers.filter((layer) => layer.route === undefined).map((layer) => layer.handle);
  assert.deepEqual(middleware, [authenticate, requireActiveBusinessMembership]);
  const route = layers.find((layer) => {
    const candidate = layer.route as { path?: string; methods?: Record<string, boolean> } | undefined;
    return candidate?.path === "/" && candidate.methods?.get === true;
  })?.route as {
    path: string;
    methods: Record<string, boolean>;
  } | undefined;
  assert.equal(route?.path, "/");
  assert.equal(route?.methods.get, true);

  const state = { statusCode: 200, body: undefined as unknown };
  const res = {
    status(code: number) { state.statusCode = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as Response;
  let nextCalled = false;
  const req = {
    headers: {},
    get() { return undefined; },
  } as unknown as Request;

  return authenticate(req, res, () => { nextCalled = true; }).then(() => {
    assert.equal(state.statusCode, 401);
    assert.equal(nextCalled, false);
  });
});

test("unit listing is scoped to the authenticated business and returns only public fields", async (t) => {
  let queriedWhere: unknown;
  let queriedSelect: unknown;
  const restore = stubMethod(prisma.unitOfMeasure, "findMany", (async (args: {
    where: unknown;
    select: unknown;
  }) => {
    queriedWhere = args.where;
    queriedSelect = args.select;
    return [{ id: "unit-a", name: "Meter", code: "m" }];
  }) as never);
  t.after(restore);

  const { res, state } = makeResponse();
  await getUnitsController({
    query: { businessId: "business-b" },
    businessPrincipal: {
      userId: "user-a",
      membershipId: "membership-a",
      businessId: "business-a",
      role: "OWNER",
      businessName: "Workshop A",
    },
  } as unknown as Request, res);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(queriedWhere, { businessId: "business-a" });
  assert.deepEqual(queriedSelect, { id: true, name: true, code: true });
  assert.deepEqual((state.body as { data: unknown[] }).data, [
    { id: "unit-a", name: "Meter", code: "m" },
  ]);
});

test("Materials unit-list endpoint returns seeded business units in the form's expected shape", async (t) => {
  let query: unknown;
  const units = [
    { id: "m-1", name: "Meter", code: "m" },
    { id: "cm-1", name: "Centimeter", code: "cm" },
  ];
  const restore = stubMethod(prisma.unitOfMeasure, "findMany", (async (args: { where: unknown; select: unknown }) => {
    query = args.where;
    return units;
  }) as never);
  t.after(restore);

  const { res, state } = makeResponse();
  await getUnitsController(makeRequest(), res);

  assert.deepEqual(query, { businessId: "business-a" });
  assert.deepEqual((state.body as { data: unknown }).data, units);
});

test("unit controller rejects requests without authenticated business context", async () => {
  const { res, state } = makeResponse();
  await getUnitsController({ query: { businessId: "business-attacker" } } as unknown as Request, res);
  assert.equal(state.statusCode, 401);
  assert.deepEqual(state.body, { success: false, message: "Authentication required" });
});

test("default unit provisioning is idempotent, business-scoped, and preserves custom units", async () => {
  const units: Array<{ businessId: string; name: string; code: string }> = [
    { businessId: "business-a", name: "Meter", code: "m-custom" },
  ];
  const client = {
    unitOfMeasure: {
      findMany: async ({ where }: { where: { businessId: string } }) => units.filter((unit) => unit.businessId === where.businessId),
      createMany: async (args: { data: Array<{ businessId: string; name: string; code: string }>; skipDuplicates: boolean }) => {
        assert.equal(args.skipDuplicates, true);
        const toAdd = args.data.filter((next) => !units.some((existing) => existing.businessId === next.businessId && (
          existing.code.toLowerCase() === next.code.toLowerCase() || existing.name.toLowerCase() === next.name.toLowerCase()
        )));
        units.push(...toAdd);
        return { count: toAdd.length };
      },
    },
  } as never;

  const first = await ensureDefaultUnits(client, "business-a");
  const repeated = await ensureDefaultUnits(client, "business-a");
  const secondBusiness = await ensureDefaultUnits(client, "business-b");

  assert.deepEqual(first, { addedCount: 8, alreadyExistedCount: 1 });
  assert.deepEqual(repeated, { addedCount: 0, alreadyExistedCount: 9 });
  assert.deepEqual(secondBusiness, { addedCount: 9, alreadyExistedCount: 0 });
  assert.deepEqual(units[0], { businessId: "business-a", name: "Meter", code: "m-custom" });
  assert.equal(units.filter((unit) => unit.businessId === "business-a").length, 9);
  assert.equal(units.filter((unit) => unit.businessId === "business-b").length, 9);
});

test("existing businesses can initialize defaults through the authenticated endpoint with counts", async (t) => {
  const units: Array<{ id: string; businessId: string; name: string; code: string }> = [
    { id: "custom-unit", businessId: "business-a", name: "Meter", code: "m-custom" },
  ];
  let setupTransactions = 0;
  const restoreTransaction = stubMethod(prisma, "$transaction", (async (callback: (tx: unknown) => Promise<unknown>) => {
    setupTransactions += 1;
    const transaction = {
      unitOfMeasure: {
        findMany: async ({ where }: { where: { businessId: string } }) => units.filter((unit) => unit.businessId === where.businessId),
        createMany: async (args: { data: Array<{ businessId: string; name: string; code: string }>; skipDuplicates: boolean }) => {
          assert.equal(args.skipDuplicates, true);
          const missing = args.data.filter((next) => !units.some((existing) => existing.businessId === next.businessId && (
            existing.name.toLowerCase() === next.name.toLowerCase() || existing.code.toLowerCase() === next.code.toLowerCase()
          )));
          units.push(...missing.map((unit, index) => ({ id: `seed-${setupTransactions}-${index}`, ...unit })));
          return { count: missing.length };
        },
      },
    };
    return callback(transaction);
  }) as never);
  const restoreList = stubMethod(prisma.unitOfMeasure, "findMany", (async (args: { where: { businessId: string } }) =>
    units.filter((unit) => unit.businessId === args.where.businessId).map(({ id, name, code }) => ({ id, name, code }))) as never);
  t.after(restoreTransaction);
  t.after(restoreList);

  const first = makeResponse();
  await initializeDefaultUnitsController(makeRequest(), first.res);
  assert.equal(first.state.statusCode, 200);
  assert.deepEqual(first.state.body && (first.state.body as { data: { addedCount: number; alreadyExistedCount: number } }).data, {
    units: units.filter((unit) => unit.businessId === "business-a").map(({ id, name, code }) => ({ id, name, code })),
    addedCount: 8,
    alreadyExistedCount: 1,
  });

  const repeat = makeResponse();
  await initializeDefaultUnitsController(makeRequest(), repeat.res);
  assert.equal(repeat.state.statusCode, 200);
  assert.deepEqual((repeat.state.body as { data: { addedCount: number; alreadyExistedCount: number } }).data, {
    units: units.filter((unit) => unit.businessId === "business-a").map(({ id, name, code }) => ({ id, name, code })),
    addedCount: 0,
    alreadyExistedCount: 9,
  });
  assert.equal(setupTransactions, 2);

  const crossBusiness = makeResponse();
  await initializeDefaultUnitsController(makeRequest({ body: { businessId: "business-b" } }), crossBusiness.res);
  assert.equal(crossBusiness.state.statusCode, 403);
  assert.equal(setupTransactions, 2);
  assert.equal(units.find((unit) => unit.id === "custom-unit")?.code, "m-custom");
});

test("custom unit creation validates and normalizes the abbreviation within the active business", async (t) => {
  let lookup: unknown;
  let created: unknown;
  const restoreLookup = stubMethod(prisma.unitOfMeasure, "findFirst", (async (args: { where: unknown }) => {
    lookup = args.where;
    return null;
  }) as never);
  const restoreCreate = stubMethod(prisma.unitOfMeasure, "create", (async (args: { data: unknown; select: unknown }) => {
    created = args;
    return { id: "unit-1", name: "Yard", code: "yd" };
  }) as never);
  t.after(restoreLookup);
  t.after(restoreCreate);

  const { res, state } = makeResponse();
  await createUnitController(makeRequest({ body: { name: " Yard ", code: "YD" } }), res);

  assert.equal(state.statusCode, 201);
  assert.deepEqual(lookup, {
    businessId: "business-a",
    OR: [
      { name: { equals: "Yard", mode: "insensitive" } },
      { code: { equals: "yd", mode: "insensitive" } },
    ],
  });
  assert.deepEqual((created as { data: unknown }).data, { businessId: "business-a", name: "Yard", code: "yd" });
});

test("custom unit creation rejects duplicate codes and another business", async (t) => {
  let databaseCalled = false;
  const restore = stubMethod(prisma.unitOfMeasure, "findFirst", (async () => {
    databaseCalled = true;
    return { id: "existing-unit" };
  }) as never);
  t.after(restore);

  const duplicate = makeResponse();
  await createUnitController(makeRequest({ body: { name: "Meter copy", code: "m" } }), duplicate.res);
  assert.equal(duplicate.state.statusCode, 409);

  databaseCalled = false;
  const crossBusiness = makeResponse();
  await createUnitController(makeRequest({ body: { businessId: "business-b", name: "Yard", code: "yd" } }), crossBusiness.res);
  assert.equal(crossBusiness.state.statusCode, 403);
  assert.equal(databaseCalled, false);
});

test("unit routes protect all writes with CSRF and expose no destructive delete route", () => {
  const routes = (unitsRoutes as unknown as {
    stack: Array<{ route?: { methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>;
  }).stack.flatMap((layer) => layer.route ? [layer.route] : []);
  const writes = routes.filter((route) => route.methods.post || route.methods.put || route.methods.patch);
  assert.equal(writes.length, 2);
  assert.ok(writes.every((route) => route.stack.some((layer) => layer.handle === requireCsrf)));
  assert.equal(routes.some((route) => route.methods.delete), false);
});
