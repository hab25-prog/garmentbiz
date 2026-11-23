import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import {
  adjustIn,
  adjustOut,
  createConversion,
  issue,
  receive,
  returnIssue,
  waste,
} from "../src/modules/inventory/inventory.service.js";

function stub(target: object, key: string, replacement: (...args: never[]) => unknown) {
  const old = Reflect.get(target, key);
  Reflect.set(target, key, replacement);
  return () => Reflect.set(target, key, old);
}

const D = Prisma.Decimal;

interface TestLayer {
  id: string;
  remainingQty: InstanceType<typeof D>;
  unitCost: InstanceType<typeof D>;
  status: string;
  receivedAt: Date;
  createdAt: Date;
}

function db(options: {
  balance?: string;
  layers?: Array<{ id: string; qty: string; cost: string }>;
  oldOp?: boolean;
  conversion?: { fromUnitId: string; toUnitId: string; factor: string };
  baseUnitBusinessId?: string;
  baseUnitMissing?: boolean;
  requestedUnitExists?: boolean;
  materialMissing?: boolean;
} = {}) {
  const state = {
    balance: new D(options.balance ?? "0"),
    layers: (options.layers ?? []).map((layer): TestLayer => ({
      id: layer.id,
      remainingQty: new D(layer.qty),
      unitCost: new D(layer.cost),
      status: "OPEN",
      receivedAt: new Date(0),
      createdAt: new Date(0),
    })),
    operations: [] as Array<Record<string, unknown>>,
    movements: [] as Array<Record<string, unknown>>,
    allocations: [] as Array<Record<string, unknown>>,
    layersCreated: [] as Array<Record<string, unknown>>,
    conversion: null as string | null,
    unitLookups: 0,
    conversionLookups: 0,
  };

  const tx = {
    $queryRaw: async () => [],
    material: {
      findFirst: async () => options.materialMissing ? null : ({
        id: "mat",
        businessId: "biz",
        unitId: "u_base",
        isActive: true,
        unit: options.baseUnitMissing ? null : {
          id: "u_base",
          businessId: options.baseUnitBusinessId ?? "biz",
        },
      }),
    },
    stockMovement: {
      aggregate: async () => ({ _sum: { quantity: state.balance } }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.movements.push(data);
        state.balance = state.balance.add(data.quantity as InstanceType<typeof D>);
        return data;
      },
    },
    materialCostLayer: {
      aggregate: async () => ({
        _sum: {
          remainingQty: state.layers
            .filter((layer) => layer.status === "OPEN")
            .reduce((sum, layer) => sum.add(layer.remainingQty), new D(0)),
        },
      }),
      findMany: async () => state.layers,
      updateMany: async ({ where, data }: {
        where: { id: string };
        data: { remainingQty: { decrement: InstanceType<typeof D> }; status?: string };
      }) => {
        const layer = state.layers.find((item) => item.id === where.id)!;
        if (layer.remainingQty.lessThan(data.remainingQty.decrement)) return { count: 0 };
        layer.remainingQty = layer.remainingQty.sub(data.remainingQty.decrement);
        if (data.status) layer.status = data.status;
        return { count: 1 };
      },
      update: async ({ where, data }: {
        where: { id: string };
        data: { remainingQty: { increment: InstanceType<typeof D> }; status: string };
      }) => {
        const layer = state.layers.find((item) => item.id === where.id)!;
        layer.remainingQty = layer.remainingQty.add(data.remainingQty.increment);
        layer.status = data.status;
        return layer;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.layersCreated.push(data);
        state.layers.push({
          ...data,
          id: `new${state.layers.length}`,
          remainingQty: data.remainingQty as InstanceType<typeof D>,
          unitCost: data.unitCost as InstanceType<typeof D>,
          status: "OPEN",
          receivedAt: new Date(),
          createdAt: new Date(),
        });
        return data;
      },
    },
    inventoryOperation: {
      findUnique: async () => options.oldOp ? { id: "old", movement: {}, costLayer: {}, allocations: [] } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const operation = { id: `op${state.operations.length + 1}`, ...data };
        state.operations.push(operation);
        return operation;
      },
      findFirst: async () => ({ id: "issue", businessId: "biz", materialId: "mat", quantity: new D("4"), operationType: "ISSUE" }),
      aggregate: async () => ({ _sum: { quantity: new D("0") } }),
    },
    inventoryCostAllocation: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        state.allocations.push(...data);
        return { count: data.length };
      },
      findMany: async () => state.allocations,
      updateMany: async () => ({ count: 1 }),
    },
    unitConversion: {
      findFirst: async () => {
        state.conversionLookups += 1;
        return options.conversion ? { ...options.conversion, factor: new D(options.conversion.factor) } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    unitOfMeasure: {
      findFirst: async () => {
        state.unitLookups += 1;
        return options.requestedUnitExists === false ? null : { id: "u_alt", businessId: "biz" };
      },
      findMany: async () => [{ id: "u_a" }, { id: "u_b" }],
    },
    supplier: { findFirst: async () => ({ id: "supplier" }) },
  };

  const restore = stub(prisma, "$transaction", (async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)) as never);
  return { state, tx, restore };
}

test("manual receipt creates a valued FIFO layer and duplicate request protection works", async (t) => {
  const testDb = db();
  t.after(testDb.restore);
  const input = { materialId: "mat", quantity: "5", unitCost: "2.50", reason: "opening receipt", operationKey: "key1" };
  await receive("biz", "member", input);
  assert.equal(testDb.state.operations.length, 1);
  assert.equal(testDb.state.movements.length, 1);
  assert.equal(testDb.state.layersCreated.length, 1);
  assert.equal(String(testDb.state.balance), "5");
});

test("receipt in a material base unit works without an unnecessary unit lookup or conversion", async (t) => {
  const testDb = db();
  t.after(testDb.restore);
  await receive("biz", "member", {
    materialId: "mat", quantity: "2", unitId: "u_base", unitCost: "4.25", reason: "base unit receipt", operationKey: "base-receipt",
  });
  assert.equal(testDb.state.unitLookups, 0);
  assert.equal(testDb.state.conversionLookups, 0);
  assert.equal(String(testDb.state.layersCreated[0]?.originalQty), "2");
});

test("a valid business base unit can receive stock when the optional unitId is omitted", async (t) => {
  const testDb = db();
  t.after(testDb.restore);
  await receive("biz", "member", {
    materialId: "mat", quantity: "1.25", unitCost: "3", reason: "base unit", operationKey: "base-omitted",
  });
  assert.equal(String(testDb.state.balance), "1.25");
  assert.equal(testDb.state.conversionLookups, 0);
});

test("a material cannot receive stock if its stored base unit belongs to another business or is missing", async (t) => {
  const foreignUnit = db({ baseUnitBusinessId: "biz-other" });
  t.after(foreignUnit.restore);
  await assert.rejects(receive("biz", "member", {
    materialId: "mat", quantity: "1", unitCost: "1", reason: "invalid base", operationKey: "bad-base",
  }), /Material base unit not found for this business/);

  const missingUnit = db({ baseUnitMissing: true });
  t.after(missingUnit.restore);
  await assert.rejects(receive("biz", "member", {
    materialId: "mat", quantity: "1", unitCost: "1", reason: "missing base", operationKey: "missing-base",
  }), /Material base unit not found for this business/);
});

test("an alternate unit must belong to the business and have an explicit conversion", async (t) => {
  const foreignUnit = db({ requestedUnitExists: false });
  t.after(foreignUnit.restore);
  await assert.rejects(receive("biz", "member", {
    materialId: "mat", quantity: "1", unitId: "foreign-unit", unitCost: "1", reason: "foreign unit", operationKey: "foreign-unit",
  }), /Unit not found for this business/);

  const noConversion = db();
  t.after(noConversion.restore);
  await assert.rejects(receive("biz", "member", {
    materialId: "mat", quantity: "1", unitId: "u_alt", unitCost: "1", reason: "unconfigured unit", operationKey: "no-conversion",
  }), /No explicit conversion exists/);
});

test("explicit empty or null unit identifiers are rejected instead of treated as the base unit", async (t) => {
  const testDb = db();
  t.after(testDb.restore);
  await assert.rejects(receive("biz", "member", {
    materialId: "mat", quantity: "1", unitId: "" as string, unitCost: "1", reason: "empty unit", operationKey: "empty-unit",
  }), /Unit not found for this business/);
  await assert.rejects(receive("biz", "member", {
    materialId: "mat", quantity: "1", unitId: null as unknown as string, unitCost: "1", reason: "null unit", operationKey: "null-unit",
  }), /Unit not found for this business/);
});

test("FIFO issue spans oldest layers and records allocation costs", async (t) => {
  const testDb = db({ balance: "5", layers: [{ id: "a", qty: "2", cost: "1.00" }, { id: "b", qty: "3", cost: "2.00" }] });
  t.after(testDb.restore);
  await issue("biz", "member", { materialId: "mat", quantity: "4", reason: "production support", operationKey: "issue-1" });
  assert.deepEqual(testDb.state.allocations.map((allocation) => [allocation.materialCostLayerId, String(allocation.allocatedQuantity)]), [["a", "2"], ["b", "2"]]);
  assert.equal(String(testDb.state.balance), "1");
  assert.equal(testDb.state.movements[0]?.movementType, "INVENTORY_ISSUE");
});

test("issue rejects insufficient stock and material balance discrepancies", async (t) => {
  const insufficient = db({ balance: "1", layers: [{ id: "a", qty: "1", cost: "1" }] });
  t.after(insufficient.restore);
  await assert.rejects(issue("biz", "member", { materialId: "mat", quantity: "2", reason: "test", operationKey: "i" }), /Insufficient available stock/);
  const inconsistent = db({ balance: "2", layers: [{ id: "a", qty: "1", cost: "1" }] });
  t.after(inconsistent.restore);
  await assert.rejects(issue("biz", "member", { materialId: "mat", quantity: "1", reason: "test", operationKey: "i2" }), /Inventory discrepancy/);
});

test("returns enforce original issue quantity and restore stock movement", async (t) => {
  const testDb = db({ layers: [{ id: "a", qty: "0", cost: "2" }] });
  testDb.state.allocations.push({ id: "alloc", inventoryOperationId: "issue", materialCostLayerId: "a", allocatedQuantity: new D("4"), returnedQuantity: new D("0"), unitCostSnapshot: new D("2") });
  t.after(testDb.restore);
  await returnIssue("biz", "member", { issueOperationId: "issue", quantity: "2", reason: "unused", operationKey: "ret1" });
  assert.equal(String(testDb.state.balance), "2");
  assert.equal(testDb.state.movements[0]?.movementType, "INVENTORY_RETURN");
});

test("returns reject a material whose base unit is outside the issue business", async (t) => {
  const testDb = db({ layers: [{ id: "a", qty: "0", cost: "2" }], baseUnitBusinessId: "biz-other" });
  testDb.state.allocations.push({ id: "alloc", inventoryOperationId: "issue", materialCostLayerId: "a", allocatedQuantity: new D("4"), returnedQuantity: new D("0"), unitCostSnapshot: new D("2") });
  t.after(testDb.restore);
  await assert.rejects(returnIssue("biz", "member", { issueOperationId: "issue", quantity: "1", reason: "unused", operationKey: "ret-invalid-unit" }), /Material base unit not found for this business/);
});

test("waste and adjustments share material-unit validation and retain distinct movement types", async (t) => {
  for (const [operation, movementType, key] of [[waste, "INVENTORY_WASTE", "w"], [adjustOut, "ADJUSTMENT_OUT", "ao"]] as const) {
    const testDb = db({ balance: "2", layers: [{ id: "a", qty: "2", cost: "3" }] });
    t.after(testDb.restore);
    await operation("biz", "member", { materialId: "mat", quantity: "1", reason: "damaged", operationKey: key });
    assert.equal(testDb.state.movements[0]?.movementType, movementType);
  }
  const adjustInDb = db();
  t.after(adjustInDb.restore);
  await adjustIn("biz", "member", { materialId: "mat", quantity: "2", unitCost: "4.5", reason: "count correction", operationKey: "ai" });
  assert.equal(adjustInDb.state.movements[0]?.movementType, "ADJUSTMENT_IN");
  assert.equal(adjustInDb.state.conversionLookups, 0);
});

test("explicit unit conversions multiply forward and divide in reverse", async (t) => {
  const forward = db({ conversion: { fromUnitId: "u_alt", toUnitId: "u_base", factor: "2.5" } });
  t.after(forward.restore);
  await receive("biz", "member", { materialId: "mat", quantity: "2", unitId: "u_alt", unitCost: "1", reason: "forward", operationKey: "forward" });
  assert.equal(String(forward.state.layersCreated[0]?.originalQty), "5");

  const reverse = db({ conversion: { fromUnitId: "u_base", toUnitId: "u_alt", factor: "2.5" } });
  t.after(reverse.restore);
  await receive("biz", "member", { materialId: "mat", quantity: "5", unitId: "u_alt", unitCost: "1", reason: "reverse", operationKey: "reverse" });
  assert.equal(String(reverse.state.layersCreated[0]?.originalQty), "2");
});

test("conversion definitions reject invalid precision and units outside the business", async (t) => {
  const testDb = db();
  t.after(testDb.restore);
  await assert.rejects(createConversion("biz", { fromUnitId: "a", toUnitId: "b", factor: "0.1234567891" }), /supported range/);
});

test("all stock-changing operations reject foreign requested units", async (t) => {
  const operations = [
    (key: string) => receive("biz", "member", { materialId: "mat", quantity: "1", unitId: "foreign", unitCost: "1", reason: "test", operationKey: key }),
    (key: string) => issue("biz", "member", { materialId: "mat", quantity: "1", unitId: "foreign", reason: "test", operationKey: key }),
    (key: string) => waste("biz", "member", { materialId: "mat", quantity: "1", unitId: "foreign", reason: "test", operationKey: key }),
    (key: string) => adjustIn("biz", "member", { materialId: "mat", quantity: "1", unitId: "foreign", unitCost: "1", reason: "test", operationKey: key }),
    (key: string) => adjustOut("biz", "member", { materialId: "mat", quantity: "1", unitId: "foreign", reason: "test", operationKey: key }),
  ];
  for (const [index, operation] of operations.entries()) {
    const testDb = db({ requestedUnitExists: false });
    t.after(testDb.restore);
    await assert.rejects(operation(`foreign-${index}`), /Unit not found for this business/);
  }
});

test("receipt rejects a material outside the authenticated business", async (t) => {
  const testDb = db();
  const original = Reflect.get(testDb.tx.material, "findFirst");
  Reflect.set(testDb.tx.material, "findFirst", async () => null);
  t.after(() => { Reflect.set(testDb.tx.material, "findFirst", original); testDb.restore(); });
  await assert.rejects(receive("biz", "member", { materialId: "foreign", quantity: "1", unitCost: "1", reason: "receipt", operationKey: "foreign" }), /Material not found for this business/);
});

test("return cannot exceed original issue quantity", async (t) => {
  const testDb = db({ layers: [{ id: "a", qty: "0", cost: "2" }] });
  testDb.state.allocations.push({ id: "alloc", inventoryOperationId: "issue", materialCostLayerId: "a", allocatedQuantity: new D("4"), returnedQuantity: new D("0"), unitCostSnapshot: new D("2") });
  const original = Reflect.get(testDb.tx.inventoryOperation, "aggregate");
  Reflect.set(testDb.tx.inventoryOperation, "aggregate", async () => ({ _sum: { quantity: new D("3") } }));
  t.after(() => { Reflect.set(testDb.tx.inventoryOperation, "aggregate", original); testDb.restore(); });
  await assert.rejects(returnIssue("biz", "member", { issueOperationId: "issue", quantity: "2", reason: "unused", operationKey: "too-much" }), /exceeds unreturned issued quantity/);
});
