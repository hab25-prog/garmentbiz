import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import {
  createOrder,
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
    orderExists?: boolean;
    updateCount?: number;
  } = {},
) {
  const state = {
    status: options.status ?? "PENDING",
    updateCount: options.updateCount ?? 1,
  };

  const tx = {
    customerOrder: {
      findFirst: async () =>
        options.orderExists === false
          ? null
          : { id: "order-a", status: state.status },

      updateMany: async (args: { data: { status: string } }) => {
        if (state.updateCount === 1) {
          state.status = args.data.status;
        }
        return { count: state.updateCount };
      },
    },

    productionBatch: {
      count: async () => options.batchCount ?? 0,
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
        "At least one production batch is required before starting production",
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
