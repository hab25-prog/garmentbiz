import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { prisma } from "../src/database/prisma.js";
import {
  authenticate,
  requireActiveBusinessMembership,
} from "../src/middleware/auth.middleware.js";
import {
  createOrderController,
  getOrdersController,
} from "../src/modules/orders/orders.controller.js";
import ordersRoutes from "../src/modules/orders/orders.routes.js";
import {
  createCustomerController,
  getCustomersController,
} from "../src/modules/customers/customers.controller.js";
import {
  createPurchase,
  receivePurchase,
} from "../src/modules/purchases/purchases.service.js";
import { createAccessToken } from "../src/modules/auth/auth.security.js";
import materialsRoutes from "../src/modules/materials/materials.routes.js";
import suppliersRoutes from "../src/modules/suppliers/suppliers.routes.js";
import purchasesRoutes from "../src/modules/purchases/purchases.routes.js";
import customersRoutes from "../src/modules/customers/customers.routes.js";
import employeesRoutes from "../src/modules/employees/employees.routes.js";
import productsRoutes from "../src/modules/products/products.routes.js";

function stubMethod(
  target: object,
  name: string,
  replacement: (...args: never[]) => unknown,
) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function makeRequest(
  options: {
    body?: unknown;
    query?: Record<string, unknown>;
    authorization?: string;
    auth?: { userId: string; membershipId: string; businessId: string };
    business?: {
      businessId: string;
      role: string;
      businessName: string;
      userId: string;
      membershipId: string;
    };
  } = {},
): Request {
  return {
    body: options.body,
    query: options.query ?? {},
    headers: options.authorization
      ? { authorization: options.authorization }
      : {},
    authPrincipal: options.auth,
    businessPrincipal: options.business,
    get(name: string) {
      if (name.toLowerCase() === "authorization") {
        return options.authorization;
      }
      return undefined;
    },
  } as unknown as Request;
}

function makeResponse() {
  const state: {
    statusCode: number;
    body?: unknown;
    headers: string[];
  } = {
    statusCode: 200,
    headers: [],
  };

  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
    append(_name: string, value: string) {
      state.headers.push(value);
      return res;
    },
  } as unknown as Response;

  return { res, state };
}

const businessA = {
  userId: "user-a",
  membershipId: "membership-a",
  businessId: "business-a",
  role: "OWNER",
  businessName: "Workshop A",
};

test("unauthenticated business requests receive 401", async () => {
  const { res, state } = makeResponse();
  let nextCalled = false;

  await authenticate(makeRequest(), res, () => {
    nextCalled = true;
  });

  assert.equal(state.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("valid bearer JWTs resolve to a principal without exposing the token", async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-jwt-secret-with-at-least-32-bytes";

  t.after(() => {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  });

  const token = await createAccessToken({
    userId: "user-a",
    membershipId: "membership-a",
    businessId: "business-a",
  });

  const req = makeRequest({ authorization: `Bearer ${token}` });
  const { res, state } = makeResponse();
  let nextCalled = false;

  await authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(req.authPrincipal, {
    userId: "user-a",
    membershipId: "membership-a",
    businessId: "business-a",
  });
  assert.equal(JSON.stringify(req.authPrincipal).includes(token), false);
});

test("membership middleware resolves only the verified active business", async (t) => {
  let queriedWhere: unknown;

  const restore = stubMethod(prisma.membership, "findFirst", (async (args: {
    where: unknown;
  }) => {
    queriedWhere = args.where;
    return {
      id: "membership-a",
      businessId: "business-a",
      role: "OWNER",
      business: { name: "Workshop A" },
      user: { isActive: true },
    } as never;
  }) as never);

  t.after(restore);

  const req = makeRequest({
    auth: {
      userId: "user-a",
      membershipId: "membership-a",
      businessId: "business-a",
    },
  });

  const { res, state } = makeResponse();
  let nextCalled = false;

  await requireActiveBusinessMembership(req, res, () => {
    nextCalled = true;
  });

  assert.equal(state.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.deepEqual(queriedWhere, {
    id: "membership-a",
    userId: "user-a",
    isActive: true,
    business: { isActive: true },
  });
  assert.equal(req.businessPrincipal?.businessId, "business-a");
});

test("inactive membership is forbidden even with an authenticated JWT", async (t) => {
  const restore = stubMethod(
    prisma.membership,
    "findFirst",
    (async () => null) as never,
  );

  t.after(restore);

  const req = makeRequest({
    auth: {
      userId: "user-a",
      membershipId: "membership-a",
      businessId: "business-a",
    },
  });

  const { res, state } = makeResponse();
  let nextCalled = false;

  await requireActiveBusinessMembership(req, res, () => {
    nextCalled = true;
  });

  assert.equal(state.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("all seven business routers install JWT and active-membership protection", () => {
  const routers = [
    materialsRoutes,
    suppliersRoutes,
    purchasesRoutes,
    customersRoutes,
    employeesRoutes,
    productsRoutes,
    ordersRoutes,
  ];

  for (const router of routers) {
    const middleware = (
      router as unknown as {
        stack: Array<{ route?: unknown; handle: unknown }>;
      }
    ).stack
      .filter((layer) => layer.route === undefined)
      .map((layer) => layer.handle);

    assert.equal(middleware[0], authenticate);
    assert.equal(middleware[1], requireActiveBusinessMembership);
  }
});

test("a request cannot list or create data under a different business", async (t) => {
  let databaseCalled = false;

  const restoreOrderFindMany = stubMethod(
    prisma.customerOrder,
    "findMany",
    (async () => {
      databaseCalled = true;
      return [];
    }) as never,
  );

  const restoreOrderCreate = stubMethod(
    prisma.customerOrder,
    "create",
    (async () => {
      databaseCalled = true;
      return {} as never;
    }) as never,
  );

  t.after(restoreOrderFindMany);
  t.after(restoreOrderCreate);

  const restoreBusiness = stubMethod(
    prisma.business,
    "findUnique",
    (async () => {
      databaseCalled = true;
      return { id: "business-a" } as never;
    }) as never,
  );

  const restoreCustomer = stubMethod(prisma.customer, "create", (async () => {
    databaseCalled = true;
    return {} as never;
  }) as never);

  t.after(restoreBusiness);
  t.after(restoreCustomer);

  const orderListResponse = makeResponse();

  await getOrdersController(
    makeRequest({
      query: { businessId: "business-b" },
      business: businessA,
    }),
    orderListResponse.res,
  );

  assert.equal(orderListResponse.state.statusCode, 403);

  const orderCreateResponse = makeResponse();

  await createOrderController(
    makeRequest({
      body: {
        businessId: "business-b",
        customerId: "customer-b",
        items: [{ productId: "product-b", quantity: 1 }],
      },
      business: businessA,
    }),
    orderCreateResponse.res,
  );

  assert.equal(orderCreateResponse.state.statusCode, 403);
  assert.equal(databaseCalled, false);

  const listResponse = makeResponse();

  await getCustomersController(
    makeRequest({
      query: { businessId: "business-b" },
      business: businessA,
    }),
    listResponse.res,
  );

  assert.equal(listResponse.state.statusCode, 403);

  const createResponse = makeResponse();

  await createCustomerController(
    makeRequest({
      body: { businessId: "business-b", name: "Attempt" },
      business: businessA,
    }),
    createResponse.res,
  );

  assert.equal(createResponse.state.statusCode, 403);
  assert.equal(databaseCalled, false);
});

test("valid create requests use the authenticated business regardless of body omission", async (t) => {
  let createdData: unknown;

  const restoreBusiness = stubMethod(
    prisma.business,
    "findUnique",
    (async () => ({ id: "business-a" })) as never,
  );

  const restoreCustomer = stubMethod(prisma.customer, "create", (async (args: {
    data: unknown;
  }) => {
    createdData = args.data;
    return { id: "customer-a", ...args.data } as never;
  }) as never);

  t.after(restoreBusiness);
  t.after(restoreCustomer);

  const { res, state } = makeResponse();

  await createCustomerController(
    makeRequest({
      body: { name: "  Customer A  " },
      business: businessA,
    }),
    res,
  );

  assert.equal(state.statusCode, 201);
  assert.equal(
    (createdData as { businessId: string }).businessId,
    "business-a",
  );
  assert.equal((createdData as { name: string }).name, "Customer A");
});

test("valid list requests query only the user's active business", async (t) => {
  let queriedWhere: unknown;

  const restore = stubMethod(prisma.customer, "findMany", (async (args: {
    where: unknown;
  }) => {
    queriedWhere = args.where;
    return [{ id: "customer-a", name: "Customer A" }];
  }) as never);

  t.after(restore);

  const { res, state } = makeResponse();

  await getCustomersController(makeRequest({ business: businessA }), res);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(queriedWhere, {
    businessId: "business-a",
    isActive: true,
  });
  assert.deepEqual((state.body as { data: unknown[] }).data, [
    { id: "customer-a", name: "Customer A" },
  ]);
});

test("purchase creation rejects supplier and material references outside the active business", async (t) => {
  let supplierWhere: unknown;
  let materialsWhere: unknown;
  let validSupplier = false;

  const tx = {
    supplier: {
      findFirst: async (args: { where: unknown }) => {
        supplierWhere = args.where;
        return validSupplier ? { id: "supplier-a" } : null;
      },
    },
    material: {
      findMany: async (args: { where: unknown }) => {
        materialsWhere = args.where;
        return [];
      },
    },
    purchase: {
      create: async () => ({ id: "purchase-a" }),
    },
  };

  const restoreTransaction = stubMethod(prisma, "$transaction", (async (
    callback: (transaction: typeof tx) => Promise<unknown>,
  ) => callback(tx)) as never);

  t.after(restoreTransaction);

  await assert.rejects(
    createPurchase({
      businessId: "business-a",
      supplierId: "supplier-b",
      items: [{ materialId: "material-a", quantity: "1", unitCost: "1" }],
    }),
    /Supplier not found for this business/,
  );

  assert.deepEqual(supplierWhere, {
    id: "supplier-b",
    businessId: "business-a",
    isActive: true,
  });

  validSupplier = true;

  await assert.rejects(
    createPurchase({
      businessId: "business-a",
      supplierId: "supplier-a",
      items: [{ materialId: "material-b", quantity: "1", unitCost: "1" }],
    }),
    /One or more materials were not found for this business/,
  );

  assert.deepEqual(materialsWhere, {
    id: { in: ["material-b"] },
    businessId: "business-a",
    isActive: true,
  });
});

test("purchase creation succeeds when every referenced record belongs to the active business", async (t) => {
  let createdData: { businessId: string; supplierId: string } | undefined;

  const tx = {
    supplier: {
      findFirst: async () => ({ id: "supplier-a" }),
    },
    material: {
      findMany: async () => [{ id: "material-a" }],
    },
    purchase: {
      create: async (args: {
        data: { businessId: string; supplierId: string };
      }) => {
        createdData = args.data;
        return { id: "purchase-a", ...args.data };
      },
    },
  };

  const restore = stubMethod(prisma, "$transaction", (async (
    callback: (transaction: typeof tx) => Promise<unknown>,
  ) => callback(tx)) as never);

  t.after(restore);

  const purchase = await createPurchase({
    businessId: "business-a",
    supplierId: "supplier-a",
    items: [{ materialId: "material-a", quantity: "2", unitCost: "3.50" }],
  });

  assert.equal(createdData?.businessId, "business-a");
  assert.equal(createdData?.supplierId, "supplier-a");
  assert.equal((purchase as { id: string }).id, "purchase-a");
});

test("purchase receipt scopes lookup and update to the authenticated business", async (t) => {
  let lookupWhere: unknown;
  let updateCalled = false;

  const tx = {
    purchase: {
      findFirst: async (args: { where: unknown }) => {
        lookupWhere = args.where;
        return null;
      },
      updateMany: async () => {
        updateCalled = true;
        return { count: 1 };
      },
    },
  };

  const restore = stubMethod(prisma, "$transaction", (async (
    callback: (transaction: typeof tx) => Promise<unknown>,
  ) => callback(tx)) as never);

  t.after(restore);

  await assert.rejects(
    receivePurchase("purchase-b", "business-a"),
    /Draft purchase not found/,
  );

  assert.deepEqual(lookupWhere, {
    id: "purchase-b",
    businessId: "business-a",
    status: "DRAFT",
    supplier: { businessId: "business-a" },
    items: { every: { material: { businessId: "business-a" } } },
  });

  assert.equal(updateCalled, false);
});
