import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { Request, Response } from "express";
import { PaymentMethod, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import { recordInvoicePayment, type RecordPaymentInput } from "../src/modules/invoices/payments.service.js";
import { getInvoice, getInvoicePaymentHistory } from "../src/modules/invoices/invoices.service.js";
import { getInvoicePaymentHistoryController, recordInvoicePaymentController } from "../src/modules/invoices/invoices.controller.js";
import invoicesRoutes from "../src/modules/invoices/invoices.routes.js";
import { requireCsrf } from "../src/middleware/auth.middleware.js";

const D = Prisma.Decimal;

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function serializationError() {
  return new Prisma.PrismaClientKnownRequestError("Serialization conflict", { code: "P2034", clientVersion: "6.19.3" });
}

function uniqueError() {
  return new Prisma.PrismaClientKnownRequestError("Unique conflict", { code: "P2002", clientVersion: "6.19.3" });
}

function paymentDb(options: { total?: string; status?: string; businessId?: string; retryFailures?: number; retryOnce?: boolean; existingPayments?: Array<Record<string, unknown> & { amount: Prisma.Decimal; idempotencyKey: string | null; requestHash: string | null }> } = {}) {
  const state = {
    invoice: { id: "invoice-a", businessId: options.businessId ?? "business-a", status: options.status ?? "ISSUED", totalAmount: new D(options.total ?? "100.00") },
    payments: options.existingPayments ? [...options.existingPayments] : [] as Array<Record<string, unknown> & { amount: Prisma.Decimal; idempotencyKey: string | null; requestHash: string | null }>,
    creates: 0,
    updates: 0,
    retries: 0,
    attempts: 0,
  };
  let release = Promise.resolve();
  const tx = {
    $queryRaw: async () => [],
    invoice: {
      findFirst: async (args: { where: { id: string; businessId: string } }) =>
        args.where.id === state.invoice.id && args.where.businessId === state.invoice.businessId
          ? { ...state.invoice }
          : null,
      update: async (args: { data: { status: string } }) => {
        state.updates++;
        state.invoice.status = args.data.status;
        return { ...state.invoice };
      },
    },
    payment: {
      findFirst: async (args: { where: { businessId: string; invoiceId: string; idempotencyKey: string } }) =>
        state.payments.find((payment) => payment.businessId === args.where.businessId && payment.invoiceId === args.where.invoiceId && payment.idempotencyKey === args.where.idempotencyKey) ?? null,
      aggregate: async (args: { where: { businessId: string; invoiceId: string } }) => {
        const amount = state.payments
          .filter((payment) => payment.businessId === args.where.businessId && payment.invoiceId === args.where.invoiceId)
          .reduce((sum, payment) => sum.add(payment.amount), new D(0));
        return { _sum: { amount: state.payments.some((payment) => payment.businessId === args.where.businessId && payment.invoiceId === args.where.invoiceId) ? amount : null } };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        state.creates++;
        const payment = { id: `payment-${state.creates}`, ...args.data } as Record<string, unknown> & { amount: Prisma.Decimal; idempotencyKey: string; requestHash: string };
        state.payments.push(payment);
        return payment;
      },
    },
  };
  const restore = stubMethod(prisma, "$transaction", (async (
    callback: (transaction: typeof tx) => Promise<unknown>,
    transactionOptions?: { isolationLevel?: string },
  ) => {
    assert.equal(transactionOptions?.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
    let unlock!: () => void;
    const previous = release;
    release = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
      state.attempts++;
      const retryFailures = options.retryFailures ?? (options.retryOnce ? 1 : 0);
      if (state.attempts <= retryFailures) {
        state.retries++;
        throw serializationError();
      }
      return await callback(tx);
    } finally {
      unlock();
    }
  }) as never);
  return { state, tx, restore };
}

const baseInput = (overrides: Partial<RecordPaymentInput> = {}): RecordPaymentInput => ({
  amount: "100.00",
  method: PaymentMethod.CASH,
  idempotencyKey: "payment-request-1",
  ...overrides,
});

test("records a full payment, marks invoice PAID, and preserves invoice total", async (t) => {
  const db = paymentDb({ total: "100.00" }); t.after(db.restore);
  const result = await recordInvoicePayment("business-a", "invoice-a", baseInput());
  assert.equal(String(result?.paidAmount), "100");
  assert.equal(String(result?.outstandingBalance), "0");
  assert.equal(result?.invoiceStatus, "PAID");
  assert.equal(db.state.invoice.status, "PAID");
  assert.equal(String(db.state.invoice.totalAmount), "100");
  assert.equal(db.state.creates, 1);
});

test("records a partial payment and sets PARTIALLY_PAID", async (t) => {
  const db = paymentDb({ total: "100" }); t.after(db.restore);
  const result = await recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "35.25" }));
  assert.equal(String(result?.paidAmount), "35.25");
  assert.equal(String(result?.outstandingBalance), "64.75");
  assert.equal(result?.invoiceStatus, "PARTIALLY_PAID");
});

test("supports multiple distinct partial payments and exact balance totals", async (t) => {
  const db = paymentDb({ total: "1.00" }); t.after(db.restore);
  const first = await recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "0.10", idempotencyKey: "one" }));
  const second = await recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "0.20", idempotencyKey: "two" }));
  assert.equal(String(first?.outstandingBalance), "0.9");
  assert.equal(String(second?.paidAmount), "0.3");
  assert.equal(String(second?.outstandingBalance), "0.7");
  assert.equal(db.state.creates, 2);
  assert.equal(db.state.invoice.status, "PARTIALLY_PAID");
});

test("returns the original payment for an identical idempotent retry", async (t) => {
  const db = paymentDb({ total: "100" }); t.after(db.restore);
  const input = baseInput({ amount: "100", reference: "  cash slip  " });
  const first = await recordInvoicePayment("business-a", "invoice-a", input);
  const retry = await recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "100.00", reference: "cash slip" }));
  assert.equal(retry?.replayed, true);
  assert.equal(retry?.invoiceStatus, "PAID");
  assert.equal(retry?.payment.id, first?.payment.id);
  assert.equal(db.state.creates, 1);
});

test("returns a consistent summary when replaying an earlier partial payment", async (t) => {
  const db = paymentDb({ total: "100" }); t.after(db.restore);
  const first = await recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "30", idempotencyKey: "first" }));
  await recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "20", idempotencyKey: "second" }));
  const replay = await recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "30", idempotencyKey: "first" }));
  assert.equal(replay?.payment.id, first?.payment.id);
  assert.equal(String(replay?.invoiceTotal), "100");
  assert.equal(String(replay?.paidAmount), "50");
  assert.equal(String(replay?.outstandingBalance), "50");
  assert.equal(replay?.invoiceStatus, "PARTIALLY_PAID");
});

test("rejects reuse of an idempotency key with a different normalized request", async (t) => {
  const db = paymentDb(); t.after(db.restore);
  await recordInvoicePayment("business-a", "invoice-a", baseInput());
  await assert.rejects(
    recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "99" })),
    (error: unknown) => error instanceof Error && error.message.includes("already used for a different payment"),
  );
  assert.equal(db.state.creates, 1);
});

test("rejects a same-key retry when method, date, reference, or notes change", async () => {
  const changes: Partial<RecordPaymentInput>[] = [
    { method: PaymentMethod.BANK_TRANSFER },
    { paymentDate: "2026-11-24T11:00:00Z" },
    { reference: "different" },
    { notes: "different" },
  ];
  for (const change of changes) {
    const db = paymentDb();
    try {
      await recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "10", paymentDate: "2026-11-24T10:00:00Z", reference: "ref", notes: "note" }));
      await assert.rejects(
        recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "10", paymentDate: "2026-11-24T10:00:00Z", reference: "ref", notes: "note", ...change })),
        /already used for a different payment request/,
      );
      assert.equal(db.state.creates, 1);
    } finally { db.restore(); }
  }
});

test("rejects zero and negative amounts", async (t) => {
  const db = paymentDb(); t.after(db.restore);
  for (const amount of ["0", "-1"]) {
    await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput({ amount })), /Amount must/);
  }
  assert.equal(db.state.creates, 0);
});

test("rejects overpayment and leaves invoice unchanged", async (t) => {
  const db = paymentDb({ total: "10" }); t.after(db.restore);
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "10.01" })), /exceeds the outstanding balance/);
  assert.equal(db.state.creates, 0);
  assert.equal(db.state.updates, 0);
  assert.equal(db.state.invoice.status, "ISSUED");
});

test("rejects payment on DRAFT and VOID invoices", async (t) => {
  for (const status of ["DRAFT", "VOID"]) {
    const db = paymentDb({ status });
    try {
      await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput()), /can only be recorded for issued or partially paid/);
      assert.equal(db.state.creates, 0);
    } finally { db.restore(); }
  }
});

test("rejects invalid methods, dates, idempotency keys, reference, and notes", async (t) => {
  const db = paymentDb(); t.after(db.restore);
  const invalidInputs: RecordPaymentInput[] = [
    baseInput({ method: "TELEBIRR" }),
    baseInput({ paymentDate: "not-a-date" }),
    baseInput({ idempotencyKey: "" }),
    baseInput({ idempotencyKey: "x".repeat(129) }),
    baseInput({ reference: "x".repeat(129) }),
    baseInput({ notes: "x".repeat(2001) }),
  ];
  for (const input of invalidInputs) await assert.rejects(recordInvoicePayment("business-a", "invoice-a", input));
  assert.equal(db.state.creates, 0);
});

test("strictly rejects impossible dates, invalid month/time, and non-leap February 29", async (t) => {
  const db = paymentDb(); t.after(db.restore);
  for (const paymentDate of [
    "2026-02-30",
    "2026-13-01",
    "2026-01-01T24:00:00Z",
    "2026-01-01T10:60:00Z",
    "2026-01-01T10:00:60Z",
    "2025-02-29",
    "2026-01-01T10:00:00",
    "2026-01-01T10:00:00+15:00",
  ]) {
    await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput({ paymentDate })), /Payment date/);
  }
  assert.equal(db.state.creates, 0);
});

test("accepts leap-year dates and normalizes equivalent timezone timestamps identically", async (t) => {
  const dateDb = paymentDb();
  try {
    const result = await recordInvoicePayment("business-a", "invoice-a", baseInput({ paymentDate: "2024-02-29" }));
    assert.equal(result?.payment.paymentDate.toISOString(), "2024-02-29T00:00:00.000Z");
  } finally { dateDb.restore(); }

  const equivalentDb = paymentDb(); t.after(equivalentDb.restore);
  const first = await recordInvoicePayment("business-a", "invoice-a", baseInput({
    amount: "100", paymentDate: "2026-11-24T12:00:00+02:00", idempotencyKey: "timezone-equivalent",
  }));
  const retry = await recordInvoicePayment("business-a", "invoice-a", baseInput({
    amount: "100.00", paymentDate: "2026-11-24T10:00:00Z", idempotencyKey: "timezone-equivalent",
  }));
  assert.equal(retry?.replayed, true);
  assert.equal(retry?.payment.id, first?.payment.id);
  assert.equal(first?.payment.paymentDate.toISOString(), "2026-11-24T10:00:00.000Z");
});

test("counts Unicode code points for idempotency and bounded text", async (t) => {
  const db = paymentDb(); t.after(db.restore);
  const unicodeKey = "🧵".repeat(128);
  const accepted = await recordInvoicePayment("business-a", "invoice-a", baseInput({ idempotencyKey: unicodeKey, reference: "é".repeat(128) }));
  assert.equal(accepted?.payment.idempotencyKey, unicodeKey);
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput({ idempotencyKey: "🧵".repeat(129) })), /Idempotency key/);
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput({ idempotencyKey: "   " })), /Idempotency key/);
});

test("rejects amount formats outside Decimal(14,2) and accepts exact decimal precision", async (t) => {
  const db = paymentDb({ total: "999999999999.99" }); t.after(db.restore);
  const result = await recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "999999999999.99" }));
  assert.equal(String(result?.paidAmount), "999999999999.99");
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "1000000000000.00", idempotencyKey: "too-large" })), /Amount must/);
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "1.001", idempotencyKey: "precision" })), /Amount must/);
});

test("does not find an invoice belonging to another business", async (t) => {
  const db = paymentDb({ businessId: "business-b" }); t.after(db.restore);
  assert.equal(await recordInvoicePayment("business-a", "invoice-a", baseInput()), null);
  assert.equal(db.state.creates, 0);
});

test("retries Prisma P2034 at most three transaction attempts", async (t) => {
  const db = paymentDb({ retryOnce: true }); t.after(db.restore);
  const result = await recordInvoicePayment("business-a", "invoice-a", baseInput());
  assert.equal(result?.invoiceStatus, "PAID");
  assert.equal(db.state.retries, 1);
  assert.equal(db.state.attempts, 2);
  assert.equal(db.state.creates, 1);
});

test("returns a conflict after three P2034 failures without creating a payment", async (t) => {
  const db = paymentDb({ retryFailures: 3 }); t.after(db.restore);
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput()), /serialization conflict/);
  assert.equal(db.state.attempts, 3);
  assert.equal(db.state.creates, 0);
});

test("concurrent payments cannot exceed the invoice total", async (t) => {
  const db = paymentDb({ total: "100" }); t.after(db.restore);
  const attempts = await Promise.allSettled([
    recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "60", idempotencyKey: "parallel-a" })),
    recordInvoicePayment("business-a", "invoice-a", baseInput({ amount: "60", idempotencyKey: "parallel-b" })),
  ]);
  assert.equal(db.state.payments.length, 1);
  assert.equal(db.state.payments.reduce((sum, payment) => sum.add(payment.amount), new D(0)).toFixed(2), "60.00");
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
});

function uniqueRaceHash(input: RecordPaymentInput) {
  return createHash("sha256").update(JSON.stringify({
    invoiceId: "invoice-a", amount: String(input.amount), method: input.method,
    paymentDate: input.paymentDate ?? null, reference: input.reference ?? null, notes: input.notes ?? null,
  }), "utf8").digest("hex");
}

function uniqueRaceDatabase(existingHash: string | null) {
  const input = baseInput({ amount: "10.00" });
  const existing = {
    id: "payment-existing", businessId: "business-a", invoiceId: "invoice-a", amount: new D("10"),
    method: PaymentMethod.CASH, paymentDate: new Date(), reference: null, notes: null,
    idempotencyKey: "payment-request-1", requestHash: existingHash,
  };
  let transactions = 0;
  let lockCalls = 0;
  const tx = {
    $queryRaw: async () => { lockCalls++; return []; },
    invoice: {
      findFirst: async () => ({ id: "invoice-a", totalAmount: new D("100"), status: "PARTIALLY_PAID" }),
    },
    payment: {
      findFirst: async () => transactions === 1 ? null : existing,
      aggregate: async () => ({ _sum: { amount: transactions === 1 ? null : new D("10") } }),
      create: async () => { throw uniqueError(); },
    },
  };
  const restoreTransaction = stubMethod(prisma, "$transaction", (async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    transactions++;
    return callback(tx);
  }) as never);
  return { input, existing, get transactions() { return transactions; }, get lockCalls() { return lockCalls; }, restore: restoreTransaction, tx };
}

test("P2002 recovery returns the original payment and a consistent locked summary", async (t) => {
  const fixture = uniqueRaceDatabase(uniqueRaceHash(baseInput({ amount: "10.00" })));
  t.after(fixture.restore);
  const result = await recordInvoicePayment("business-a", "invoice-a", fixture.input);
  assert.equal(result.replayed, true);
  assert.equal(result.payment.id, "payment-existing");
  assert.equal(String(result.paidAmount), "10");
  assert.equal(String(result.outstandingBalance), "90");
  assert.equal(result.invoiceStatus, "PARTIALLY_PAID");
  assert.equal(fixture.transactions, 2);
  assert.equal(fixture.lockCalls, 2);
});

test("P2002 recovery rejects a different hash and conflicts when no matching row exists", async (t) => {
  const different = uniqueRaceDatabase("different-hash");
  t.after(different.restore);
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", different.input), /already used for a different payment/);

  const missing = uniqueRaceDatabase(null);
  t.after(missing.restore);
  // Simulate a unique violation followed by a recovery lookup with no row.
  const tx = missing.tx as unknown as { payment: { findFirst: () => Promise<unknown> } };
  tx.payment.findFirst = async () => null;
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", missing.input), /conflicted with another operation/);
});

test("P2002 recovery retries P2034 only a bounded number of times", async (t) => {
  const fixture = uniqueRaceDatabase(uniqueRaceHash(baseInput({ amount: "10.00" })));
  let attempts = 0;
  const tx = {
    $queryRaw: async () => [],
    invoice: { findFirst: async () => ({ id: "invoice-a", totalAmount: new D("100"), status: "ISSUED" }) },
    payment: { findFirst: async () => null, aggregate: async () => ({ _sum: { amount: null } }), create: async () => { throw uniqueError(); } },
  };
  const restore = stubMethod(prisma, "$transaction", (async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    attempts++;
    if (attempts === 1) return callback(tx);
    throw serializationError();
  }) as never);
  t.after(() => { restore(); fixture.restore(); });
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", fixture.input), /could not be resolved safely/);
  assert.equal(attempts, 4);
});

test("rejects already-overpaid historical balances for new and replay requests", async (t) => {
  const historicalPayment = {
    id: "historical", businessId: "business-a", invoiceId: "invoice-a", amount: new D("101"),
    idempotencyKey: null, requestHash: null,
  };
  const db = paymentDb({ total: "100", status: "PARTIALLY_PAID", existingPayments: [historicalPayment] });
  t.after(db.restore);
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput()), /payments already exceed its total/i);
  assert.equal(db.state.creates, 0);

  const matching = {
    id: "replay", businessId: "business-a", invoiceId: "invoice-a", amount: new D("1"),
    idempotencyKey: "payment-request-1", requestHash: uniqueRaceHash(baseInput()),
  };
  const replayDb = paymentDb({ total: "100", status: "PARTIALLY_PAID", existingPayments: [historicalPayment, matching] });
  t.after(replayDb.restore);
  await assert.rejects(recordInvoicePayment("business-a", "invoice-a", baseInput()), /payments already exceed its total/i);
  assert.equal(replayDb.state.creates, 0);
});

test("billing role and CSRF protections apply to payment mutation", async () => {
  let transactionStarted = false;
  const restore = stubMethod(prisma, "$transaction", (async () => { transactionStarted = true; return null; }) as never);
  const responseState: { status?: number; body?: unknown } = {};
  const res = { status(code: number) { responseState.status = code; return this; }, json(body: unknown) { responseState.body = body; return this; } } as unknown as Response;
  const req = {
    params: { invoiceId: "invoice-a" },
    body: { amount: "1", method: "CASH", idempotencyKey: "one" },
    businessPrincipal: { businessId: "business-a", role: "MANAGER" },
  } as unknown as Request;
  try { await recordInvoicePaymentController(req, res); } finally { restore(); }
  assert.equal(responseState.status, 403);
  assert.equal(transactionStarted, false);

  const route = (invoicesRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }> }).stack
    .flatMap((layer) => layer.route ? [layer.route] : [])
    .find((item) => item.path === "/:invoiceId/payments" && item.methods.post);
  assert.ok(route?.stack.some((layer) => layer.handle === requireCsrf));
});

function paymentReadDb(options: { businessId?: string; payments?: Array<Record<string, unknown> & { amount: Prisma.Decimal; paymentDate: Date; createdAt: Date }> } = {}) {
  const invoice = {
    id: "invoice-read",
    invoiceNo: "INV-1001",
    businessId: options.businessId ?? "business-a",
    customerId: "customer-a",
    totalAmount: new D("1.00"),
    status: "PARTIALLY_PAID",
    customer: { id: "customer-a", name: "Customer A" },
    order: { id: "order-a" },
    items: [],
    payments: options.payments ?? [],
  };
  let query: unknown;
  const restore = stubMethod(prisma.invoice, "findFirst", (async (args: { where: { businessId: string; id: string }; include?: { payments?: { orderBy?: unknown } }; select?: unknown }) => {
    query = args;
    if (args.where.businessId !== invoice.businessId || args.where.id !== invoice.id) return null;
    const rows = [...invoice.payments].sort((left, right) =>
      right.paymentDate.getTime() - left.paymentDate.getTime() || right.createdAt.getTime() - left.createdAt.getTime() || String(right.id).localeCompare(String(left.id)),
    );
    return { ...invoice, payments: rows };
  }) as never);
  return { invoice, get query() { return query; }, restore };
}

function readPayment(id: string, amount: string, paymentDate: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    amount: new D(amount),
    method: PaymentMethod.CASH,
    paymentDate: new Date(paymentDate),
    reference: null,
    notes: null,
    createdAt: new Date(paymentDate),
    idempotencyKey: `secret-key-${id}`,
    requestHash: `secret-hash-${id}`,
    ...extra,
  };
}

test("payment history returns a zero-paid summary for an invoice with no payments", async (t) => {
  const db = paymentReadDb(); t.after(db.restore);
  const result = await getInvoicePaymentHistory("business-a", "invoice-read");
  assert.equal(result?.invoiceId, "invoice-read");
  assert.equal(result?.invoiceNo, "INV-1001");
  assert.equal(String(result?.invoiceTotal), "1");
  assert.equal(String(result?.totalPaid), "0");
  assert.equal(String(result?.outstandingBalance), "1");
  assert.equal(result?.invoiceStatus, "PARTIALLY_PAID");
  assert.equal(result?.currency, "ETB");
  assert.deepEqual(result?.payments, []);
  const args = db.query as { where: { businessId: string }; select: { payments: { where: { businessId: string }; select: Record<string, boolean> } } };
  assert.equal(args.where.businessId, "business-a");
  assert.equal(args.select.payments.where.businessId, "business-a");
  assert.deepEqual(Object.keys(args.select.payments.select).sort(), ["amount", "id", "method", "notes", "paymentDate", "reference"].sort());
});

test("payment history calculates a full payment with Decimal arithmetic", async (t) => {
  const db = paymentReadDb({ payments: [readPayment("payment-full", "1.00", "2026-05-01T10:00:00Z")] }); t.after(db.restore);
  const result = await getInvoicePaymentHistory("business-a", "invoice-read");
  assert.equal(String(result?.totalPaid), "1");
  assert.equal(String(result?.outstandingBalance), "0");
  assert.equal(result?.payments.length, 1);
  assert.equal(result?.payments[0]?.id, "payment-full");
});

test("payment history totals multiple partial payments and orders newest first", async (t) => {
  const db = paymentReadDb({ payments: [
    readPayment("payment-old", "0.10", "2026-05-01T10:00:00Z"),
    readPayment("payment-new", "0.20", "2026-05-02T10:00:00Z"),
  ] }); t.after(db.restore);
  const result = await getInvoicePaymentHistory("business-a", "invoice-read");
  assert.equal(String(result?.totalPaid), "0.3");
  assert.equal(String(result?.outstandingBalance), "0.7");
  assert.deepEqual(result?.payments.map((payment) => payment.id), ["payment-new", "payment-old"]);
  const args = db.query as { select: { payments: { orderBy: Array<Record<string, string>> } } };
  assert.equal(args.select.payments.orderBy[0]?.paymentDate, "desc");
});

test("invoice detail includes safe payment history and a payment summary", async (t) => {
  const db = paymentReadDb({ payments: [readPayment("detail-payment", "0.25", "2026-05-03T10:00:00Z")] }); t.after(db.restore);
  const invoice = await getInvoice("business-a", "invoice-read");
  assert.equal(String(invoice?.paymentSummary.totalPaid), "0.25");
  assert.equal(String(invoice?.paymentSummary.outstandingBalance), "0.75");
  assert.equal(invoice?.paymentSummary.paymentStatus, "PARTIALLY_PAID");
  assert.equal(invoice?.paymentSummary.currency, "ETB");
  const serialized = JSON.stringify(invoice);
  assert.equal(serialized.includes("idempotencyKey"), false);
  assert.equal(serialized.includes("requestHash"), false);
});

test("payment history is business-scoped and returns not found for another business or missing invoice", async (t) => {
  const db = paymentReadDb({ businessId: "business-b" }); t.after(db.restore);
  assert.equal(await getInvoicePaymentHistory("business-a", "invoice-read"), null);
  assert.equal(await getInvoicePaymentHistory("business-a", "nonexistent"), null);
});

test("read endpoints reject historical overpayment without changing records", async (t) => {
  const db = paymentReadDb({ payments: [readPayment("payment-a", "0.75", "2026-05-02T10:00:00Z"), readPayment("payment-b", "0.50", "2026-05-03T10:00:00Z")] });
  let writes = 0;
  const restoreUpdate = stubMethod(prisma.invoice, "update", (async () => { writes++; }) as never);
  const restoreCreate = stubMethod(prisma.payment, "create", (async () => { writes++; }) as never);
  t.after(() => { restoreCreate(); restoreUpdate(); db.restore(); });
  await assert.rejects(getInvoicePaymentHistory("business-a", "invoice-read"), /exceeds or conflicts with the invoice total/);
  await assert.rejects(getInvoice("business-a", "invoice-read"), /exceeds or conflicts with the invoice total/);
  assert.equal(writes, 0);
});

test("payment history controller returns a safe response and route is read-only", async (t) => {
  const db = paymentReadDb({ payments: [readPayment("safe-payment", "0.10", "2026-05-02T10:00:00Z")] }); t.after(db.restore);
  const responseState: { status?: number; body?: { data?: unknown } } = {};
  const res = { status(code: number) { responseState.status = code; return this; }, json(body: typeof responseState.body) { responseState.body = body; return this; } } as unknown as Response;
  const req = { params: { invoiceId: "invoice-read" }, businessPrincipal: { businessId: "business-a", role: "OWNER" } } as unknown as Request;
  await getInvoicePaymentHistoryController(req, res);
  assert.equal(responseState.status, 200);
  assert.equal(JSON.stringify(responseState.body).includes("requestHash"), false);

  const route = (invoicesRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
    .flatMap((layer) => layer.route ? [layer.route] : [])
    .find((item) => item.path === "/:invoiceId/payments");
  assert.equal(route?.methods.get, true);
  assert.equal(route?.methods.post, undefined);
});
