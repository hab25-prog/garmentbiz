import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import { createOrderInvoice, issueInvoice } from "../src/modules/invoices/invoices.service.js";
import { createOrderInvoiceController } from "../src/modules/invoices/invoices.controller.js";
import invoicesRoutes from "../src/modules/invoices/invoices.routes.js";
import ordersRoutes from "../src/modules/orders/orders.routes.js";
import { requireCsrf } from "../src/middleware/auth.middleware.js";

const D = Prisma.Decimal;

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function invoiceDb(options: { status?: string; businessId?: string; existingInvoice?: boolean } = {}) {
  const order: Record<string, unknown> = {
    id: "order-a",
    businessId: options.businessId ?? "business-a",
    customerId: "customer-a",
    orderNo: "ORD-2026-0001",
    status: options.status ?? "CONFIRMED",
    totalAmount: new D("123.45"),
    customer: { id: "customer-a", businessId: options.businessId ?? "business-a" },
    items: [
      { description: "Custom shirt", quantity: 2, unitPrice: new D("50.00"), lineTotal: new D("100.00"), product: { name: "Shirt" } },
      { description: null, quantity: 1, unitPrice: new D("23.45"), lineTotal: new D("23.45"), product: { name: "Trouser" } },
    ],
    invoice: options.existingInvoice ? { id: "invoice-existing" } : null,
  };
  const saved: Record<string, unknown>[] = [];
  let created: { id: string; businessId: string; status: string; issueDate?: Date } | null = null;
  let issueStatus = "DRAFT";
  let release = Promise.resolve();
  const tx = {
    $queryRaw: async () => [],
    customerOrder: { findFirst: async (args: { where: { businessId: string; id: string } }) =>
      args.where.businessId === order.businessId && args.where.id === order.id ? order : null },
    invoice: {
      create: async (args: { data: Record<string, unknown>; include: unknown }) => {
        saved.push(args.data);
        created = { id: "invoice-a", businessId: "business-a", status: "DRAFT" };
        order.invoice = { id: "invoice-a" };
        return { id: "invoice-a", ...args.data, customer: {}, order: {}, items: (args.data.items as { create: unknown[] }).create, payments: [] };
      },
      findFirst: async (args: { where: { id: string; businessId: string } }) =>
        args.where.businessId === "business-a" && args.where.id === "invoice-a" ? {
          id: "invoice-a", status: issueStatus, businessId: "business-a", customerId: "customer-a",
          customer: { businessId: "business-a" }, order: { businessId: "business-a", customerId: "customer-a" },
        } : null,
      update: async (args: { data: { status: string; issueDate: Date } }) => {
        issueStatus = args.data.status;
        return { id: "invoice-a", status: issueStatus, issueDate: args.data.issueDate };
      },
    },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    let unlock!: () => void;
    const previous = release;
    release = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try { return await callback(tx); } finally { unlock(); }
  }) as never);
  return { restore, saved, get created() { return created; }, get issueStatus() { return issueStatus; } };
}

test("creates a DRAFT invoice with Decimal totals and order item snapshots", async (t) => {
  const db = invoiceDb(); t.after(db.restore);
  const invoice = await createOrderInvoice("business-a", "order-a");
  assert.equal(invoice?.status, "DRAFT");
  assert.equal(String(db.saved[0]?.subtotal), "123.45");
  assert.equal(String(db.saved[0]?.discount), "0");
  assert.equal(String(db.saved[0]?.tax), "0");
  assert.equal(String(db.saved[0]?.totalAmount), "123.45");
  const itemSnapshots = (db.saved[0]?.items as { create: Array<Record<string, unknown>> }).create;
  assert.equal(itemSnapshots.length, 2);
  assert.equal(itemSnapshots[0]?.description, "Custom shirt");
  assert.equal(itemSnapshots[1]?.description, "Trouser");
  assert.equal(String(itemSnapshots[0]?.unitPrice), "50");
  assert.equal(String(itemSnapshots[0]?.lineTotal), "100");
});

test("rejects cancelled orders", async (t) => {
  const db = invoiceDb({ status: "CANCELLED" }); t.after(db.restore);
  await assert.rejects(createOrderInvoice("business-a", "order-a"), /Cancelled orders/);
  assert.equal(db.saved.length, 0);
});

test("rejects an existing invoice and does not create a duplicate", async (t) => {
  const db = invoiceDb({ existingInvoice: true }); t.after(db.restore);
  await assert.rejects(createOrderInvoice("business-a", "order-a"), /already exists/);
  assert.equal(db.saved.length, 0);
});

test("serializes concurrent invoice creation so only one invoice is created", async (t) => {
  const db = invoiceDb(); t.after(db.restore);
  const results = await Promise.allSettled([
    createOrderInvoice("business-a", "order-a"),
    createOrderInvoice("business-a", "order-a"),
  ]);
  assert.equal(db.saved.length, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("does not find an order belonging to another business", async (t) => {
  const db = invoiceDb({ businessId: "business-b" }); t.after(db.restore);
  assert.equal(await createOrderInvoice("business-a", "order-a"), null);
  assert.equal(db.saved.length, 0);
});

test("rejects invalid and repeated invoice issuance", async (t) => {
  const db = invoiceDb(); t.after(db.restore);
  const issued = await issueInvoice("business-a", "invoice-a");
  assert.equal(issued?.status, "ISSUED");
  assert.ok(issued?.issueDate instanceof Date);
  await assert.rejects(issueInvoice("business-a", "invoice-a"), /Only draft invoices/);
});

test("invoice mutations require existing billing permissions and CSRF middleware", async () => {
  let transactionStarted = false;
  const restore = stubMethod(prisma, "$transaction", (async () => { transactionStarted = true; return null; }) as never);
  const state: { status?: number; body?: unknown } = {};
  const res = { status(code: number) { state.status = code; return this; }, json(body: unknown) { state.body = body; return this; } } as unknown as Response;
  const req = { params: { id: "order-a" }, businessPrincipal: { businessId: "business-a", role: "MANAGER" } } as unknown as Request;
  try { await createOrderInvoiceController(req, res); } finally { restore(); }
  assert.equal(state.status, 403);
  assert.equal(transactionStarted, false);

  type TestRoute = { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
  type TestRouter = { stack: Array<{ route?: TestRoute }> };
  const routes = [ordersRoutes, invoicesRoutes] as unknown as TestRouter[];
  const allRoutes = routes.flatMap((router) => router.stack.flatMap((layer) => layer.route ? [layer.route] : []));
  const mutating = allRoutes.filter((route) => route.methods.post);
  assert.ok(mutating.some((route) => route.path.endsWith("invoice") && route.stack.some((layer) => layer.handle === requireCsrf)));
  assert.ok(mutating.some((route) => route.path.endsWith("issue") && route.stack.some((layer) => layer.handle === requireCsrf)));
});
