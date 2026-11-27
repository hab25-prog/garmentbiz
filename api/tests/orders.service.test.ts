import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import {
  createOrder,
  getOrderById,
  updateOrderStatus,
} from "../src/modules/orders/orders.service.js";

function stubMethod(
  target: object,
  name: string,
  replacement: (...args: never[]) => unknown,
) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function createTestDatabase(
  yearlyOrders: Array<{ orderNo: string }> = [],
  options: { customerExists?: boolean; productExists?: boolean } = {},
) {
  let createdOrderData: Record<string, unknown> | undefined;

  const tx = {
    customer: {
      findFirst: async () =>
        options.customerExists === false ? null : { id: "customer-a" },
    },
    product: {
      findMany: async () =>
        options.productExists === false
          ? []
          : [
              {
                id: "product-a",
                basePrice: new Prisma.Decimal("100.00"),
              },
            ],
    },
    $queryRaw: async () => [],
    customerOrder: {
      findMany: async () => yearlyOrders,
      create: async (args: { data: Record<string, unknown> }) => {
        createdOrderData = args.data;
        return args.data;
      },
    },
  };

  const restore = stubMethod(prisma, "$transaction", (async (
    callback: (transaction: typeof tx) => Promise<unknown>,
  ) => callback(tx)) as never);

  return {
    restore,
    getCreatedOrderData: () => createdOrderData,
  };
}

test("order creation calculates item totals and generates the yearly order number", async (t) => {
  const database = createTestDatabase();
  t.after(database.restore);

  await createOrder({
    businessId: "business-a",
    customerId: "customer-a",
    orderDate: "2026-05-10T00:00:00.000Z",
    items: [
      {
        productId: "product-a",
        quantity: 3,
        unitPrice: "120.00",
      },
    ],
  });

  const data = database.getCreatedOrderData()!;
  const items = data.items as {
    create: Array<{
      quantity: number;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }>;
  };

  assert.equal(data.orderNo, "ORD-2026-0001");
  assert.equal(String(data.totalAmount), "360");
  assert.equal(items.create[0].quantity, 3);
  assert.equal(String(items.create[0].unitPrice), "120");
  assert.equal(String(items.create[0].lineTotal), "360");
});

test("manager order creation may use the product price but cannot override it", async (t) => {
  const database = createTestDatabase();
  t.after(database.restore);
  await createOrder({
    businessId: "business-a",
    customerId: "customer-a",
    allowCustomUnitPrice: false,
    items: [{ productId: "product-a", quantity: 1, unitPrice: "100.00" }],
  });
  assert.equal(String((database.getCreatedOrderData()!.items as { create: Array<{ unitPrice: Prisma.Decimal }> }).create[0]?.unitPrice), "100");

  const deniedDb = createTestDatabase();
  t.after(deniedDb.restore);
  await assert.rejects(createOrder({
    businessId: "business-a",
    customerId: "customer-a",
    allowCustomUnitPrice: false,
    items: [{ productId: "product-a", quantity: 1, unitPrice: "99.00" }],
  }), { message: "Managers cannot change order pricing" });
  assert.equal(deniedDb.getCreatedOrderData(), undefined);
});

test("order numbering finds the highest numeric sequence above 9999", async (t) => {
  const database = createTestDatabase([
    { orderNo: "ORD-2026-9999" },
    { orderNo: "ORD-2026-10000" },
  ]);
  t.after(database.restore);

  await createOrder({
    businessId: "business-a",
    customerId: "customer-a",
    orderDate: "2026-05-10T00:00:00.000Z",
    items: [{ productId: "product-a", quantity: 1 }],
  });

  const data = database.getCreatedOrderData()!;

  assert.equal(data.orderNo, "ORD-2026-10001");
});

test("order creation rejects a customer not belonging to the business", async (t) => {
  const database = createTestDatabase([], { customerExists: false });
  t.after(database.restore);

  await assert.rejects(
    createOrder({
      businessId: "business-a",
      customerId: "customer-b",
      items: [{ productId: "product-a", quantity: 1 }],
    }),
    { message: "Customer not found or inactive" },
  );

  assert.equal(database.getCreatedOrderData(), undefined);
});

test("order creation rejects products not belonging to the business", async (t) => {
  const database = createTestDatabase([], { productExists: false });
  t.after(database.restore);

  await assert.rejects(
    createOrder({
      businessId: "business-a",
      customerId: "customer-a",
      items: [{ productId: "product-b", quantity: 1 }],
    }),
    {
      message: "One or more products were not found or are inactive",
    },
  );

  assert.equal(database.getCreatedOrderData(), undefined);
});

test("order creation rejects duplicate products", async () => {
  await assert.rejects(
    createOrder({
      businessId: "business-a",
      customerId: "customer-a",
      items: [
        { productId: "product-a", quantity: 1 },
        { productId: "product-a", quantity: 2 },
      ],
    }),
    { message: "A product can only appear once in an order" },
  );
});
function createStatusTestDatabase(
  options: {
    status?: string;
    batchCount?: number;
    batches?: Array<{ batchNo: string; status: string; orderItemId: string | null; completedQuantity: number }>;
    items?: Array<{ id: string; quantity: number; product: { name: string } }>;
    orderExists?: boolean;
    updateCount?: number;
  } = {},
) {
  const state = {
    status: options.status ?? "PENDING",
    updateCount: options.updateCount ?? 1,
    orderLocks: 0,
  };

  const tx = {
    $queryRaw: async () => { state.orderLocks += 1; return []; },
    customerOrder: {
      findFirst: async () =>
        options.orderExists === false
          ? null
          : { id: "order-a", status: state.status, items: options.items ?? [], customer: {}, batches: options.batches ?? [] },

      updateMany: async (args: { data: { status: string } }) => {
        if (state.updateCount === 1) {
          state.status = args.data.status;
        }
        return { count: state.updateCount };
      },
    },

    productionBatch: {
      count: async () => options.batchCount ?? (options.batches ?? []).filter((batch) => batch.status !== "CANCELLED").length,
      findMany: async () => (options.batches ?? []).filter((batch) => batch.status !== "CANCELLED"),
    },
  };

  const restore = stubMethod(prisma, "$transaction", (async (
    callback: (transaction: typeof tx) => Promise<unknown>,
  ) => callback(tx)) as never);

  return { restore, state };
}
test("order can move from PENDING to CONFIRMED", async (t) => {
  const database = createStatusTestDatabase();
  t.after(database.restore);

  const result = await updateOrderStatus("business-a", "order-a", "CONFIRMED");

  assert.equal(database.state.status, "CONFIRMED");
  assert.equal(result?.status, "CONFIRMED");
});

test("order cannot skip directly from PENDING to IN_PRODUCTION", async (t) => {
  const database = createStatusTestDatabase();
  t.after(database.restore);

  await assert.rejects(
    updateOrderStatus("business-a", "order-a", "IN_PRODUCTION"),
    { message: "Cannot change order status from PENDING to IN_PRODUCTION" },
  );
});

test("order cannot be cancelled after production has started", async (t) => {
  const database = createStatusTestDatabase({
    status: "IN_PRODUCTION",
  });
  t.after(database.restore);

  await assert.rejects(
    updateOrderStatus("business-a", "order-a", "CANCELLED"),
    {
      message: "Cannot change order status from IN_PRODUCTION to CANCELLED",
    },
  );
});

test("production cannot start without a production batch", async (t) => {
  const database = createStatusTestDatabase({
    status: "CONFIRMED",
    batchCount: 0,
  });
  t.after(database.restore);

  await assert.rejects(
    updateOrderStatus("business-a", "order-a", "IN_PRODUCTION"),
    {
      message:
        "At least one active production batch is required before starting production",
    },
  );
});

test("production can start when at least one batch exists", async (t) => {
  const database = createStatusTestDatabase({
    status: "CONFIRMED",
    batchCount: 1,
  });
  t.after(database.restore);

  const result = await updateOrderStatus(
    "business-a",
    "order-a",
    "IN_PRODUCTION",
  );

  assert.equal(database.state.status, "IN_PRODUCTION");
  assert.equal(result?.status, "IN_PRODUCTION");
});

test("order status update rejects an unknown status", async () => {
  await assert.rejects(updateOrderStatus("business-a", "order-a", "UNKNOWN"), {
    message: "Invalid order status",
  });
});

test("order from another business is treated as not found", async (t) => {
  const database = createStatusTestDatabase({
    orderExists: false,
  });
  t.after(database.restore);

  await assert.rejects(
    updateOrderStatus("business-a", "order-other", "CONFIRMED"),
    { message: "Order not found" },
  );
});

test("order status update detects a concurrent change", async (t) => {
  const database = createStatusTestDatabase({
    updateCount: 0,
  });
  t.after(database.restore);

  await assert.rejects(
    updateOrderStatus("business-a", "order-a", "CONFIRMED"),
    {
      message:
        "Order status changed concurrently. Please reload and try again.",
    },
  );
});

test("order detail includes business-scoped batches with order-item product and lifecycle fields", async (t) => {
  let args: Record<string, unknown> | undefined;
  const restore = stubMethod(prisma.customerOrder, "findFirst", (async (input: Record<string, unknown>) => {
    args = input;
    return { id: "order-a", status: "IN_PRODUCTION", items: [], batches: [] };
  }) as never);
  t.after(restore);
  await getOrderById("business-a", "order-a");
  const include = args?.include as Record<string, unknown>;
  const batches = include.batches as { where: { businessId: string }; include: { orderItem: { include: { product: boolean } } } };
  assert.equal((args?.where as { businessId: string }).businessId, "business-a");
  assert.equal(batches.where.businessId, "business-a");
  assert.deepEqual(batches.include.orderItem, { include: { product: true } });
  assert.ok(batches.include.materialUsages);
});

function actualCostOrder(options: { status?: string; batches?: Array<Record<string, unknown>>; materialEstimates?: Array<Record<string, unknown>> } = {}) {
  return {
    id: "order-a", businessId: "business-a", status: options.status ?? "IN_PRODUCTION",
    items: [{ id: "item-a", productId: "product-a", quantity: 5, product: { id: "product-a", name: "Shirt" } }],
    batches: options.batches ?? [], materialEstimates: options.materialEstimates ?? [],
  };
}
function usage(issued: string, consumed: string, returned: string, wasted: string, cost: string) {
  return { issuedQuantity: new Prisma.Decimal(issued), consumedQuantity: new Prisma.Decimal(consumed), returnedQuantity: new Prisma.Decimal(returned), wastedQuantity: new Prisma.Decimal(wasted), totalCost: new Prisma.Decimal(cost) };
}
async function loadActualCosts(order: ReturnType<typeof actualCostOrder>) {
  let query: Record<string, unknown> | undefined;
  const restore = stubMethod(prisma.customerOrder, "findFirst", (async (args: Record<string, unknown>) => { query = args; return order; }) as never);
  try {
    const result = await getOrderById("business-a", "order-a");
    return { result, query };
  } finally { restore(); }
}

test("actual material cost aggregates reconciled usage per batch and product using Decimal", async () => {
  const batches = [
    { id: "batch-1", batchNo: "B-1", status: "IN_PROGRESS", orderItemId: "item-a", materialUsages: [usage("3.5", "2", "1", "0.5", "12.35")] },
    { id: "batch-2", batchNo: "B-2", status: "COMPLETED", orderItemId: "item-a", materialUsages: [usage("2", "2", "0", "0", "0.10")] },
  ];
  const { result } = await loadActualCosts(actualCostOrder({ batches }));
  const summary = result!.productionActualMaterialCost;
  assert.equal(String(summary.totalReconciledMaterialCost), "12.45");
  assert.deepEqual(summary.batchCosts.map((batch: { batchNo: string; materialCost: Prisma.Decimal }) => [batch.batchNo, String(batch.materialCost)]), [["B-1", "12.35"], ["B-2", "0.1"]]);
  assert.equal(String(summary.productCosts[0]!.materialCost), "12.45");
  assert.equal(summary.activeBatchCount, 2);
  assert.equal(summary.completedBatchCount, 1);
  assert.equal(summary.isFinal, false);
});

test("actual material cost excludes cancelled batch history", async () => {
  const { result } = await loadActualCosts(actualCostOrder({ batches: [
    { id: "active", batchNo: "B-A", status: "COMPLETED", orderItemId: "item-a", materialUsages: [usage("1", "1", "0", "0", "2.25")] },
    { id: "cancelled", batchNo: "B-C", status: "CANCELLED", orderItemId: "item-a", materialUsages: [usage("1", "1", "0", "0", "99.00")] },
  ] }));
  assert.equal(String(result!.productionActualMaterialCost.totalReconciledMaterialCost), "2.25");
  assert.deepEqual(result!.productionActualMaterialCost.batchCosts.map((batch: { batchNo: string }) => batch.batchNo), ["B-A"]);
  assert.equal(result!.batches.length, 2, "cancelled batch history remains available");
});

test("unreconciled usages are provisional and excluded from reconciled cost", async () => {
  const { result } = await loadActualCosts(actualCostOrder({ batches: [
    { id: "batch-1", batchNo: "B-1", status: "IN_PROGRESS", orderItemId: "item-a", materialUsages: [usage("4", "1", "0", "0", "3.00")] },
  ] }));
  const summary = result!.productionActualMaterialCost;
  assert.equal(String(summary.totalReconciledMaterialCost), "0");
  assert.equal(summary.unreconciledUsageCount, 1);
  assert.equal(summary.isProvisional, true);
  assert.equal(summary.isFinal, false);
});

test("no material usage produces a zero provisional summary", async () => {
  const { result } = await loadActualCosts(actualCostOrder({ batches: [{ id: "batch-1", batchNo: "B-1", status: "PLANNED", orderItemId: "item-a", materialUsages: [] }] }));
  assert.equal(String(result!.productionActualMaterialCost.totalReconciledMaterialCost), "0");
  assert.equal(result!.productionActualMaterialCost.unreconciledUsageCount, 0);
  assert.equal(result!.productionActualMaterialCost.isFinal, false);
});

test("completed order with all active batches and usages reconciled has final costs", async () => {
  const { result } = await loadActualCosts(actualCostOrder({ status: "COMPLETED", batches: [{ id: "batch-1", batchNo: "B-1", status: "COMPLETED", orderItemId: "item-a", materialUsages: [usage("2", "1", "1", "0", "4.75")] }] }));
  assert.equal(String(result!.productionActualMaterialCost.totalReconciledMaterialCost), "4.75");
  assert.equal(result!.productionActualMaterialCost.isFinal, true);
  assert.equal(result!.productionActualMaterialCost.isProvisional, false);
});

test("actual cost query is scoped to the authenticated business and does not read cost sheets", async () => {
  const { result, query } = await loadActualCosts(actualCostOrder({ batches: [{ id: "batch-1", batchNo: "B-1", status: "IN_PROGRESS", orderItemId: "item-a", materialUsages: [usage("1", "1", "0", "0", "8.10")] }] }));
  assert.equal((query!.where as { businessId: string }).businessId, "business-a");
  assert.equal(((query!.include as { batches: { where: { businessId: string } } }).batches.where.businessId), "business-a");
  assert.equal(String(result!.productionActualMaterialCost.totalReconciledMaterialCost), "8.1");
});

test("comparison scales the immutable estimate snapshot to completed quantity and uses reconciled usage cost", async () => {
  const estimate = { id: "estimate-a", items: [{ orderItemId: "item-a", productId: "product-a", orderedQuantity: 5, requirements: [{ requiredQuantity: new Prisma.Decimal("10"), materialEstimate: { requiredQuantity: new Prisma.Decimal("10"), estimatedCost: new Prisma.Decimal("100") } }] }] };
  const { result } = await loadActualCosts(actualCostOrder({ materialEstimates: [estimate], batches: [
    { id: "done", batchNo: "B-D", status: "COMPLETED", orderItemId: "item-a", completedQuantity: 2, materialUsages: [usage("3", "1", "1", "1", "25.50")] },
    { id: "working", batchNo: "B-W", status: "IN_PROGRESS", orderItemId: "item-a", completedQuantity: 1, materialUsages: [usage("1", "0", "0", "0", "99.00")] },
  ] }));
  const comparison = result!.estimatedVsActualMaterialCost;
  assert.equal(comparison.status, "COMPLETE");
  assert.equal(String(comparison.items[0]!.estimatedMaterialCost), "40");
  assert.equal(String(comparison.items[0]!.actualMaterialCost), "25.5");
  assert.equal(String(comparison.items[0]!.variance), "-14.5");
  assert.equal(String(comparison.items[0]!.estimatedCostPerUnit), "20");
  assert.equal(String(comparison.items[0]!.actualCostPerUnit), "12.75");
  assert.equal(String(comparison.estimatedMaterialCost), "40");
});

const orderItems = [
  { id: "item-shirt", quantity: 3, product: { name: "Shirt" } },
  { id: "item-pants", quantity: 2, product: { name: "Pants" } },
];
const fulfilledBatches = [
  { batchNo: "BATCH-S1", status: "COMPLETED", orderItemId: "item-shirt", completedQuantity: 1 },
  { batchNo: "BATCH-S2", status: "COMPLETED", orderItemId: "item-shirt", completedQuantity: 2 },
  { batchNo: "BATCH-P1", status: "COMPLETED", orderItemId: "item-pants", completedQuantity: 2 },
];

test("order completes when each product quantity is fulfilled across multiple batches", async (t) => {
  const database = createStatusTestDatabase({ status: "IN_PRODUCTION", batches: fulfilledBatches, items: orderItems });
  t.after(database.restore);
  const result = await updateOrderStatus("business-a", "order-a", "COMPLETED");
  assert.equal(database.state.status, "COMPLETED");
  assert.equal(result?.status, "COMPLETED");
  assert.equal(database.state.orderLocks, 1);
});

test("order completion rejects an incomplete product quantity with useful detail", async (t) => {
  const database = createStatusTestDatabase({ status: "IN_PRODUCTION", batches: fulfilledBatches.slice(1), items: orderItems });
  t.after(database.restore);
  await assert.rejects(updateOrderStatus("business-a", "order-a", "COMPLETED"), /Shirt has 1 unit remaining to produce/);
  assert.equal(database.state.status, "IN_PRODUCTION");
});

test("order completion rejects when no batches exist", async (t) => {
  const database = createStatusTestDatabase({ status: "IN_PRODUCTION", items: orderItems });
  t.after(database.restore);
  await assert.rejects(updateOrderStatus("business-a", "order-a", "COMPLETED"), /without an active production batch/);
});

test("order completion rejects when only cancelled batches exist", async (t) => {
  const database = createStatusTestDatabase({ status: "IN_PRODUCTION", items: orderItems, batches: [{ ...fulfilledBatches[0]!, status: "CANCELLED" }] });
  t.after(database.restore);
  await assert.rejects(updateOrderStatus("business-a", "order-a", "COMPLETED"), /without an active production batch/);
});

test("order completion rejects an unfinished active batch", async (t) => {
  const database = createStatusTestDatabase({ status: "IN_PRODUCTION", items: orderItems, batches: [{ ...fulfilledBatches[0]!, status: "IN_PROGRESS" }] });
  t.after(database.restore);
  await assert.rejects(updateOrderStatus("business-a", "order-a", "COMPLETED"), /Production batch BATCH-S1 must be completed/);
});

test("order cannot enter production when its only batch is cancelled", async (t) => {
  const database = createStatusTestDatabase({ status: "CONFIRMED", batches: [{ ...fulfilledBatches[0]!, status: "CANCELLED" }] });
  t.after(database.restore);
  await assert.rejects(updateOrderStatus("business-a", "order-a", "IN_PRODUCTION"), /At least one active production batch/);
});

test("delivery is rejected before completion and succeeds after completion", async (t) => {
  const before = createStatusTestDatabase({ status: "IN_PRODUCTION" });
  t.after(before.restore);
  await assert.rejects(updateOrderStatus("business-a", "order-a", "DELIVERED"), /Cannot change order status from IN_PRODUCTION to DELIVERED/);
  const after = createStatusTestDatabase({ status: "COMPLETED" });
  t.after(after.restore);
  await updateOrderStatus("business-a", "order-a", "DELIVERED");
  assert.equal(after.state.status, "DELIVERED");
});
