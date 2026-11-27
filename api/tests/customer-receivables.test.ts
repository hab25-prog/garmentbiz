import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import { getCustomerReceivables } from "../src/modules/customers/customers.service.js";
import { getCustomerReceivablesController } from "../src/modules/customers/customers.controller.js";

const D = Prisma.Decimal;
type TestPayment = { businessId: string; amount: Prisma.Decimal; idempotencyKey?: string; requestHash?: string };
type TestInvoice = {
  id: string;
  businessId: string;
  invoiceNo: string;
  issueDate: Date;
  dueDate: Date | null;
  status: "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";
  totalAmount: Prisma.Decimal;
  payments: TestPayment[];
};

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function customerDb(options: { businessId?: string; invoices?: TestInvoice[] } = {}) {
  const businessId = options.businessId ?? "business-a";
  const invoices = options.invoices ?? [];
  let query: Record<string, unknown> | undefined;
  const restore = stubMethod(prisma.customer, "findFirst", (async (args: {
    where: { id: string; businessId: string };
    select: { invoices: { where: { businessId: string; status: { in: string[] } }; orderBy: unknown; select: { payments: { where: { businessId: string }; select: Record<string, boolean> } } } };
  }) => {
    query = args as unknown as Record<string, unknown>;
    if (args.where.id !== "customer-a" || args.where.businessId !== businessId) return null;
    const includedStatus = new Set(args.select.invoices.where.status.in);
    return {
      id: "customer-a",
      name: "Alem Garments",
      phone: "+251900000000",
      email: "customer@example.test",
      address: "Addis Ababa",
      notes: "private internal note",
      invoices: invoices
        .filter((invoice) => invoice.businessId === args.select.invoices.where.businessId && includedStatus.has(invoice.status))
        .map((invoice) => ({
          ...invoice,
          payments: invoice.payments
            .filter((payment) => payment.businessId === args.select.invoices.select.payments.where.businessId)
            .map((payment) => ({ amount: payment.amount })),
        })),
    };
  }) as never);
  return { get query() { return query; }, restore };
}

function invoice(id: string, status: TestInvoice["status"], total: string, payments: Array<{ amount: string; businessId?: string }> = []): TestInvoice {
  return {
    id,
    businessId: "business-a",
    invoiceNo: `INV-${id}`,
    issueDate: new Date("2026-06-01T00:00:00.000Z"),
    dueDate: new Date("2026-06-30T00:00:00.000Z"),
    status,
    totalAmount: new D(total),
    payments: payments.map((payment) => ({
      businessId: payment.businessId ?? "business-a",
      amount: new D(payment.amount),
      idempotencyKey: "should-not-leak",
      requestHash: "should-not-leak-either",
    })),
  };
}

test("customer with no invoices has zero receivables", async (t) => {
  const db = customerDb(); t.after(db.restore);
  const result = await getCustomerReceivables("business-a", "customer-a");
  assert.deepEqual(result?.customer, {
    id: "customer-a", name: "Alem Garments", phone: "+251900000000", email: "customer@example.test", address: "Addis Ababa",
  });
  assert.equal(result?.receivables.currency, "ETB");
  assert.equal(String(result?.receivables.totalOutstanding), "0");
  assert.equal(String(result?.receivables.totalInvoiced), "0");
  assert.equal(String(result?.receivables.totalPaid), "0");
  assert.deepEqual(result?.receivables.invoices, []);
});

test("one unpaid invoice has its full total outstanding", async (t) => {
  const db = customerDb({ invoices: [invoice("unpaid", "ISSUED", "125.50")] }); t.after(db.restore);
  const result = await getCustomerReceivables("business-a", "customer-a");
  const row = result?.receivables.invoices[0];
  assert.equal(row?.invoiceNumber, "INV-unpaid");
  assert.equal(String(row?.total), "125.5");
  assert.equal(String(row?.paidAmount), "0");
  assert.equal(String(row?.outstandingBalance), "125.5");
  assert.equal(row?.dueDate?.toISOString(), "2026-06-30T00:00:00.000Z");
});

test("partially paid and fully paid invoices have correct balances", async (t) => {
  const db = customerDb({ invoices: [
    invoice("partial", "PARTIALLY_PAID", "100", [{ amount: "30.25" }, { amount: "19.75" }]),
    invoice("paid", "PAID", "50", [{ amount: "20" }, { amount: "30" }]),
  ] }); t.after(db.restore);
  const result = await getCustomerReceivables("business-a", "customer-a");
  const byId = new Map(result?.receivables.invoices.map((row) => [row.id, row]));
  assert.equal(String(byId.get("partial")?.paidAmount), "50");
  assert.equal(String(byId.get("partial")?.outstandingBalance), "50");
  assert.equal(String(byId.get("paid")?.paidAmount), "50");
  assert.equal(String(byId.get("paid")?.outstandingBalance), "0");
  assert.equal(String(result?.receivables.totalOutstanding), "50");
});

test("multiple invoices aggregate total invoiced, paid, and outstanding", async (t) => {
  const db = customerDb({ invoices: [
    invoice("one", "PARTIALLY_PAID", "100", [{ amount: "20" }]),
    invoice("two", "PARTIALLY_PAID", "200", [{ amount: "50" }]),
    invoice("three", "PAID", "300", [{ amount: "300" }]),
  ] }); t.after(db.restore);
  const result = await getCustomerReceivables("business-a", "customer-a");
  assert.equal(result?.receivables.invoices.length, 3);
  assert.equal(String(result?.receivables.totalInvoiced), "600");
  assert.equal(String(result?.receivables.totalPaid), "370");
  assert.equal(String(result?.receivables.totalOutstanding), "230");
});

test("DRAFT and VOID invoices are excluded from results and totals", async (t) => {
  const db = customerDb({ invoices: [
    invoice("issued", "ISSUED", "10"),
    invoice("draft", "DRAFT", "1000", [{ amount: "100" }]),
    invoice("void", "VOID", "2000", [{ amount: "200" }]),
  ] }); t.after(db.restore);
  const result = await getCustomerReceivables("business-a", "customer-a");
  assert.deepEqual(result?.receivables.invoices.map((row) => row.id), ["issued"]);
  assert.equal(String(result?.receivables.totalInvoiced), "10");
  assert.equal(String(result?.receivables.totalPaid), "0");
  const args = db.query as { select: { invoices: { where: { status: { in: string[] } } } } };
  assert.deepEqual(args.select.invoices.where.status.in, ["ISSUED", "PARTIALLY_PAID", "PAID"]);
});

test("uses Decimal precision when aggregating fractional ETB amounts", async (t) => {
  const db = customerDb({ invoices: [
    invoice("fractional-a", "PARTIALLY_PAID", "0.30", [{ amount: "0.10" }]),
    invoice("fractional-b", "PARTIALLY_PAID", "0.30", [{ amount: "0.20" }]),
  ] }); t.after(db.restore);
  const result = await getCustomerReceivables("business-a", "customer-a");
  assert.equal(String(result?.receivables.totalInvoiced), "0.6");
  assert.equal(String(result?.receivables.totalPaid), "0.3");
  assert.equal(String(result?.receivables.totalOutstanding), "0.3");
});

test("customer query and nested invoice and payment queries are business-scoped", async (t) => {
  const db = customerDb({ invoices: [invoice("foreign-payment", "ISSUED", "10", [{ amount: "10", businessId: "business-b" }])] }); t.after(db.restore);
  const result = await getCustomerReceivables("business-a", "customer-a");
  assert.equal(String(result?.receivables.totalPaid), "0");
  const args = db.query as { where: { businessId: string }; select: { invoices: { where: { businessId: string }; select: { payments: { where: { businessId: string } } } } } };
  assert.equal(args.where.businessId, "business-a");
  assert.equal(args.select.invoices.where.businessId, "business-a");
  assert.equal(args.select.invoices.select.payments.where.businessId, "business-a");
});

test("cross-business or nonexistent customers return no receivables", async (t) => {
  const db = customerDb({ businessId: "business-b", invoices: [invoice("foreign", "ISSUED", "10")] }); t.after(db.restore);
  assert.equal(await getCustomerReceivables("business-a", "customer-a"), null);
  assert.equal(await getCustomerReceivables("business-a", "missing-customer"), null);
});

test("rejects historical overpayment and inconsistent paid status", async (t) => {
  const overpaid = customerDb({ invoices: [invoice("overpaid", "PARTIALLY_PAID", "10", [{ amount: "10.01" }])] });
  try {
    await assert.rejects(getCustomerReceivables("business-a", "customer-a"), /invalid or overpaid historical balance/);
  } finally { overpaid.restore(); }

  const mismatch = customerDb({ invoices: [invoice("status-mismatch", "PAID", "10", [{ amount: "9" }])] });
  try {
    await assert.rejects(getCustomerReceivables("business-a", "customer-a"), /inconsistent with its status/);
  } finally { mismatch.restore(); }
});

test("receivables query performs no writes and does not expose idempotency fields", async (t) => {
  const db = customerDb({ invoices: [invoice("safe", "PARTIALLY_PAID", "10", [{ amount: "2" }])] });
  let writes = 0;
  const restoreCustomerCreate = stubMethod(prisma.customer, "create", (async () => { writes++; }) as never);
  const restoreInvoiceUpdate = stubMethod(prisma.invoice, "update", (async () => { writes++; }) as never);
  const restorePaymentCreate = stubMethod(prisma.payment, "create", (async () => { writes++; }) as never);
  t.after(() => { restorePaymentCreate(); restoreInvoiceUpdate(); restoreCustomerCreate(); db.restore(); });
  const result = await getCustomerReceivables("business-a", "customer-a");
  assert.equal(writes, 0);
  const json = JSON.stringify(result);
  assert.equal(json.includes("idempotencyKey"), false);
  assert.equal(json.includes("requestHash"), false);
  assert.equal(json.includes("private internal note"), false);
});

test("receivables controller derives business from membership and returns integrity errors", async (t) => {
  const db = customerDb({ invoices: [invoice("issued", "ISSUED", "10")] }); t.after(db.restore);
  const state: { status?: number; body?: unknown } = {};
  const res = { status(code: number) { state.status = code; return this; }, json(body: unknown) { state.body = body; return this; } } as unknown as Response;
  const req = {
    params: { customerId: "customer-a" },
    query: { businessId: "attacker-business" },
    businessPrincipal: { businessId: "business-a", role: "OWNER" },
  } as unknown as Request;
  await getCustomerReceivablesController(req, res);
  assert.equal(state.status, 200);
  assert.equal((state.body as { data: { receivables: { currency: string } } }).data.receivables.currency, "ETB");
  const args = db.query as { where: { businessId: string } };
  assert.equal(args.where.businessId, "business-a");

  const bad = customerDb({ invoices: [invoice("overpaid-controller", "ISSUED", "1", [{ amount: "2" }])] });
  const badState: { status?: number; body?: unknown } = {};
  const badRes = { status(code: number) { badState.status = code; return this; }, json(body: unknown) { badState.body = body; return this; } } as unknown as Response;
  try {
    await getCustomerReceivablesController(req, badRes);
    assert.equal(badState.status, 409);
  } finally { bad.restore(); }
});
