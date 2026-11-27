import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { ExpenseCategory, PaymentMethod, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/database/prisma.js";
import { requireCsrf } from "../src/middleware/auth.middleware.js";
import { requireExpenseManageAccess, requireExpenseReadAccess } from "../src/modules/expenses/expenses.authorization.js";
import { createExpenseController } from "../src/modules/expenses/expenses.controller.js";
import { createExpense, getExpense, listExpenses, updateExpense, voidExpense, type ExpenseActorContext } from "../src/modules/expenses/expenses.service.js";
import { ExpenseRequestError, parseCreateExpense, parseExpenseListQuery, parseUpdateExpense, parseVoidExpense } from "../src/modules/expenses/expenses.validation.js";

const D = Prisma.Decimal;
const actor: ExpenseActorContext = { businessId: "business-a", userId: "user-a", membershipId: "membership-a" };

function stubMethod(target: object, name: string, replacement: (...args: never[]) => unknown) {
  const original = Reflect.get(target, name);
  Reflect.set(target, name, replacement);
  return () => Reflect.set(target, name, original);
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique conflict", { code: "P2002", clientVersion: "6.19.3" });
}

function p2034() {
  return new Prisma.PrismaClientKnownRequestError("Serialization conflict", { code: "P2034", clientVersion: "6.19.3" });
}

type ExpenseRow = {
  id: string; businessId: string; employeeId: string | null; category: ExpenseCategory;
  paymentMethod: PaymentMethod | null; description: string; amount: Prisma.Decimal;
  expenseDate: Date; periodMonth: Date; reference: string | null; notes: string | null;
  voidedAt: Date | null; voidedByUserId: string | null; voidReason: string | null;
  createdAt: Date; updatedAt: Date;
};
type AuditRow = Record<string, unknown> & {
  id: string; businessId: string; expenseId: string; action: "CREATED" | "UPDATED" | "VOIDED";
  idempotencyKey: string | null; requestHash: string | null;
};

function cloneExpense(row: ExpenseRow): ExpenseRow { return { ...row, amount: new D(row.amount), expenseDate: new Date(row.expenseDate), periodMonth: new Date(row.periodMonth), voidedAt: row.voidedAt ? new Date(row.voidedAt) : null, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) }; }

function expenseDb(options: {
  role?: string; employeeBusinessId?: string; employeeActive?: boolean; retryFailures?: number;
  auditFailure?: boolean; p2002Race?: boolean; raceHash?: string; p2002WithoutWinner?: boolean;
  initial?: ExpenseRow[];
} = {}) {
  const state: { expenses: ExpenseRow[]; audits: AuditRow[]; attempts: number; regularAttempts: number; rawLocks: string[]; lastListWhere?: Record<string, unknown>; lastDetailArgs?: Record<string, unknown> } = {
    expenses: (options.initial ?? []).map(cloneExpense), audits: [], attempts: 0, regularAttempts: 0, rawLocks: [],
  };
  let nextId = 1;
  let injectedRace = false;
  const createRow = (data: Record<string, unknown>): ExpenseRow => ({
    id: `expense-${nextId++}`,
    businessId: String(data.businessId),
    employeeId: data.employeeId as string | null,
    category: data.category as ExpenseCategory,
    paymentMethod: data.paymentMethod as PaymentMethod | null,
    description: String(data.description),
    amount: new D(data.amount as Prisma.Decimal),
    expenseDate: new Date(data.expenseDate as Date),
    periodMonth: new Date(data.periodMonth as Date),
    reference: data.reference as string | null,
    notes: data.notes as string | null,
    voidedAt: (data.voidedAt as Date | null) ?? null,
    voidedByUserId: (data.voidedByUserId as string | null) ?? null,
    voidReason: (data.voidReason as string | null) ?? null,
    createdAt: new Date("2026-11-24T12:00:00.000Z"),
    updatedAt: new Date("2026-11-24T12:00:00.000Z"),
  });

  const restoreFindMany = stubMethod(prisma.expense, "findMany", (async (args: { where: Record<string, unknown>; skip: number; take: number }) => {
    state.lastListWhere = args.where;
    return state.expenses.filter((row) => row.businessId === args.where.businessId).slice(args.skip, args.skip + args.take);
  }) as never);
  const restoreCount = stubMethod(prisma.expense, "count", (async (args: { where: Record<string, unknown> }) => {
    state.lastListWhere = args.where;
    return state.expenses.filter((row) => row.businessId === args.where.businessId).length;
  }) as never);
  const restoreFindFirst = stubMethod(prisma.expense, "findFirst", (async (args: { where: { id: string; businessId: string }; include?: Record<string, unknown> }) => {
    state.lastDetailArgs = args as unknown as Record<string, unknown>;
    return state.expenses.find((row) => row.id === args.where.id && row.businessId === args.where.businessId) ?? null;
  }) as never);

  const transaction = async (callback: (tx: Record<string, unknown>) => Promise<unknown>, txOptions?: { isolationLevel?: string }) => {
    assert.equal(txOptions?.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
    state.attempts++;
    if (state.regularAttempts < (options.retryFailures ?? 0)) {
      state.regularAttempts++;
      throw p2034();
    }
    state.regularAttempts++;
    const working = { expenses: state.expenses.map(cloneExpense), audits: state.audits.map((audit) => ({ ...audit })) };
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { state.rawLocks.push(String(values[0])); return []; },
      membership: {
        findFirst: async (args: { where: { businessId: string } }) => args.where.businessId === actor.businessId
          ? { id: actor.membershipId, businessId: actor.businessId, userId: actor.userId, role: options.role ?? "OWNER", user: { fullName: "Mekdes Owner" } }
          : null,
      },
      employee: {
        findFirst: async (args: { where: { id: string; businessId: string } }) => args.where.businessId === (options.employeeBusinessId ?? actor.businessId)
          ? { id: args.where.id, isActive: options.employeeActive ?? true }
          : null,
      },
      expense: {
        create: async (args: { data: Record<string, unknown> }) => {
          const row = createRow(args.data); working.expenses.push(row); return row;
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const found = working.expenses.find((row) => row.id === args.where.id);
          if (!found) throw new Error("missing expense in test database");
          const changed = { ...found, ...args.data, amount: args.data.amount === undefined ? found.amount : new D(args.data.amount as Prisma.Decimal), updatedAt: new Date("2026-11-24T13:00:00.000Z") } as ExpenseRow;
          Object.assign(found, changed);
          return cloneExpense(found);
        },
        findFirst: async (args: { where: { id: string; businessId: string } }) => working.expenses.find((row) => row.id === args.where.id && row.businessId === args.where.businessId) ?? null,
      },
      expenseAuditLog: {
        findFirst: async (args: { where: { businessId: string; idempotencyKey: string }; include?: { expense?: boolean } }) => {
          const found = working.audits.find((row) => row.businessId === args.where.businessId && row.action === "CREATED" && row.idempotencyKey === args.where.idempotencyKey);
          if (!found) return null;
          return { ...found, ...(args.include?.expense ? { expense: working.expenses.find((row) => row.id === found.expenseId) ?? null } : {}) };
        },
        create: async (args: { data: Record<string, unknown> }) => {
          if (options.auditFailure) throw new Error("audit insert failed");
          const auditData = args.data;
          const key = auditData.idempotencyKey as string | null;
          if (key && options.p2002Race && !injectedRace) {
            injectedRace = true;
            if (!options.p2002WithoutWinner) {
              const winnerExpense = working.expenses[working.expenses.length - 1];
              if (winnerExpense) state.expenses.push(cloneExpense(winnerExpense));
              state.audits.push({ ...auditData, id: "race-audit", requestHash: options.raceHash ?? auditData.requestHash } as AuditRow);
            }
            throw p2002();
          }
          const audit: AuditRow = { ...auditData, id: `audit-${working.audits.length + 1}`, idempotencyKey: key ?? null, requestHash: (auditData.requestHash as string | null) ?? null } as AuditRow;
          if (key && working.audits.some((row) => row.businessId === audit.businessId && row.idempotencyKey === key)) throw p2002();
          working.audits.push(audit);
          return audit;
        },
      },
    };
    const result = await callback(tx);
    state.expenses = working.expenses;
    state.audits = working.audits;
    return result;
  };
  const restoreTransaction = stubMethod(prisma, "$transaction", transaction as never);
  return {
    state,
    restore() { restoreTransaction(); restoreFindFirst(); restoreCount(); restoreFindMany(); },
    seed(row: ExpenseRow) { state.expenses.push(cloneExpense(row)); },
  };
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    category: "SUPPLIES",
    paymentMethod: "CASH",
    description: "Thread purchase",
    amount: "1250.50",
    expenseDate: "2026-11-24",
    employeeId: null,
    reference: "RCPT-22",
    notes: "Black thread",
    idempotencyKey: "expense-key-1",
    ...overrides,
  };
}

function stateResponse() {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as Response;
  return { state, response };
}

test("creates Addis Ababa normalized expense and CREATED audit with decimal string snapshot", async (t) => {
  const db = expenseDb(); t.after(db.restore);
  const result = await createExpense(actor, parseCreateExpense(createPayload()));
  assert.equal(result.replayed, false);
  assert.equal(String(result.expense.amount), "1250.5");
  assert.equal(result.expense.expenseDate.toISOString(), "2026-11-23T21:00:00.000Z");
  assert.equal(result.expense.periodMonth.toISOString(), "2026-10-31T21:00:00.000Z");
  assert.equal(db.state.audits[0]?.action, "CREATED");
  assert.equal(db.state.audits[0]?.actorNameSnapshot, "Mekdes Owner");
  assert.equal(db.state.audits[0]?.actorUserId, "user-a");
  assert.equal(db.state.audits[0]?.actorMembershipId, "membership-a");
  assert.equal(db.state.audits[0]?.previousValues, Prisma.DbNull);
  const snapshot = db.state.audits[0]?.newValues as Record<string, unknown>;
  assert.equal(snapshot.amount, "1250.50");
  assert.equal(snapshot.expenseDate, "2026-11-24");
  assert.equal(snapshot.periodMonth, "2026-11");
  assert.equal(db.state.audits[0]?.idempotencyKey, "expense-key-1");
});

test("same key and normalized request replays original expense without duplicate writes", async (t) => {
  const db = expenseDb(); t.after(db.restore);
  const first = await createExpense(actor, parseCreateExpense(createPayload()));
  const retry = await createExpense(actor, parseCreateExpense(createPayload({ amount: "1250.50" })));
  assert.equal(retry.replayed, true);
  assert.equal(retry.expense.id, first.expense.id);
  assert.equal(db.state.expenses.length, 1);
  assert.equal(db.state.audits.length, 1);
});

test("idempotency keys validate Unicode code points at the configured boundary", () => {
  assert.equal(parseCreateExpense(createPayload({ idempotencyKey: "😀".repeat(128) })).idempotencyKey, "😀".repeat(128));
  assert.throws(() => parseCreateExpense(createPayload({ idempotencyKey: "é".repeat(129) })), /cannot exceed 128 characters/);
});

test("same idempotency key with different normalized request conflicts", async (t) => {
  const db = expenseDb(); t.after(db.restore);
  await createExpense(actor, parseCreateExpense(createPayload()));
  await assert.rejects(createExpense(actor, parseCreateExpense(createPayload({ amount: "1251.00" }))), /different expense request/);
  assert.equal(db.state.expenses.length, 1);
});

test("P2002 recovers a same-hash winner, conflicts on a different hash, and safely rejects missing winner", async (t) => {
  const recovered = expenseDb({ p2002Race: true }); t.after(recovered.restore);
  const replay = await createExpense(actor, parseCreateExpense(createPayload()));
  assert.equal(replay.replayed, true);
  assert.equal(replay.expense.id, "expense-1");

  const mismatch = expenseDb({ p2002Race: true, raceHash: "not-the-request-hash" }); t.after(mismatch.restore);
  await assert.rejects(createExpense(actor, parseCreateExpense(createPayload())), /different expense request/);

  const missing = expenseDb({ p2002Race: true, p2002WithoutWinner: true }); t.after(missing.restore);
  await assert.rejects(createExpense(actor, parseCreateExpense(createPayload())), /conflicted with another operation/);
});

test("creation validates employee ownership but permits inactive employees", async (t) => {
  const foreign = expenseDb({ employeeBusinessId: "business-b" }); t.after(foreign.restore);
  await assert.rejects(createExpense(actor, parseCreateExpense(createPayload({ employeeId: "employee-1" }))), /Employee not found for this business/);
  assert.equal(foreign.state.expenses.length, 0);

  const inactive = expenseDb({ employeeActive: false }); t.after(inactive.restore);
  const created = await createExpense(actor, parseCreateExpense(createPayload({ employeeId: "employee-old" })));
  assert.equal(created.expense.employeeId, "employee-old");
});

test("mutation service rechecks current business role inside the transaction", async (t) => {
  const db = expenseDb({ role: "MANAGER" }); t.after(db.restore);
  await assert.rejects(createExpense(actor, parseCreateExpense(createPayload())), /permission to manage expenses/);
  assert.equal(db.state.expenses.length, 0);
});

test("expense and audit creation roll back together when audit insert fails", async (t) => {
  const db = expenseDb({ auditFailure: true }); t.after(db.restore);
  await assert.rejects(createExpense(actor, parseCreateExpense(createPayload())), /audit insert failed/);
  assert.equal(db.state.expenses.length, 0);
  assert.equal(db.state.audits.length, 0);
});

test("updates lock the business expense and append before/after audit snapshots", async (t) => {
  const db = expenseDb(); t.after(db.restore);
  const created = await createExpense(actor, parseCreateExpense(createPayload()));
  const patch = parseUpdateExpense({ amount: "1300.00", reason: "Corrected receipt amount" });
  const updated = await updateExpense(actor, created.expense.id, patch);
  assert.equal(String(updated?.amount), "1300");
  assert.equal(db.state.rawLocks.at(-1), created.expense.id);
  const audit = db.state.audits.at(-1);
  assert.equal(audit?.action, "UPDATED");
  assert.equal(audit?.reason, "Corrected receipt amount");
  assert.equal((audit?.previousValues as Record<string, unknown>).amount, "1250.50");
  assert.equal((audit?.newValues as Record<string, unknown>).amount, "1300.00");
});

test("void requires a reason, preserves metadata and audit, and cannot be repeated or edited", async (t) => {
  const db = expenseDb(); t.after(db.restore);
  const created = await createExpense(actor, parseCreateExpense(createPayload()));
  const voided = await voidExpense(actor, created.expense.id, parseVoidExpense({ reason: "Recorded against wrong receipt" }));
  assert.ok(voided?.voidedAt instanceof Date);
  assert.equal(voided?.voidedByUserId, actor.userId);
  assert.equal(voided?.voidReason, "Recorded against wrong receipt");
  assert.equal(db.state.audits.at(-1)?.action, "VOIDED");
  assert.equal((db.state.audits.at(-1)?.newValues as Record<string, unknown>).voidReason, "Recorded against wrong receipt");
  await assert.rejects(voidExpense(actor, created.expense.id, parseVoidExpense({ reason: "Again" })), /already been voided/);
  await assert.rejects(updateExpense(actor, created.expense.id, parseUpdateExpense({ notes: "Changed", reason: "Edit" })), /cannot be edited/);
});

test("P2034 failures retry a bounded number of times", async (t) => {
  const retry = expenseDb({ retryFailures: 2 }); t.after(retry.restore);
  const result = await createExpense(actor, parseCreateExpense(createPayload()));
  assert.equal(result.replayed, false);
  assert.equal(retry.state.attempts, 3);

  const exhausted = expenseDb({ retryFailures: 10 }); t.after(exhausted.restore);
  await assert.rejects(createExpense(actor, parseCreateExpense(createPayload())), /conflict could not be resolved safely/);
  assert.equal(exhausted.state.attempts, 6); // three write attempts plus three bounded recovery reads
});

test("list filters are business-scoped, paginated, and exclude voided by default", async (t) => {
  const db = expenseDb(); t.after(db.restore);
  const filters = parseExpenseListQuery({ category: "SALARY", paymentMethod: "BANK_TRANSFER", employeeId: "e1", search: "salary", fromDate: "2026-11-01", toDate: "2026-11-30", periodMonth: "2026-11", page: "2", pageSize: "10" });
  const result = await listExpenses(actor.businessId, filters);
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 10);
  assert.equal(db.state.lastListWhere?.businessId, actor.businessId);
  assert.equal(db.state.lastListWhere?.voidedAt, null);
  assert.deepEqual(db.state.lastListWhere?.category, "SALARY");
});

test("detail read is tenant scoped and omits idempotency fields from audit selection", async (t) => {
  const db = expenseDb(); t.after(db.restore);
  const created = await createExpense(actor, parseCreateExpense(createPayload()));
  await getExpense("business-a", created.expense.id);
  assert.deepEqual(db.state.lastDetailArgs?.where, { id: created.expense.id, businessId: "business-a" });
  const include = db.state.lastDetailArgs?.include as { auditLogs: { where: Record<string, unknown>; select: Record<string, unknown> } };
  assert.deepEqual(include.auditLogs.where, { businessId: "business-a" });
  assert.equal(Object.hasOwn(include.auditLogs.select, "idempotencyKey"), false);
  assert.equal(Object.hasOwn(include.auditLogs.select, "requestHash"), false);
});

test("date, decimal, enum, and request validation rejects malformed values", () => {
  for (const payload of [
    createPayload({ expenseDate: "2026-02-29" }),
    createPayload({ expenseDate: "2026-13-01" }),
    createPayload({ expenseDate: "2026-11-24T00:00:00Z" }),
    createPayload({ amount: "1.001" }),
    createPayload({ amount: "0" }),
    createPayload({ amount: "1000000000000.00" }),
    createPayload({ paymentMethod: "CHEQUE" }),
    createPayload({ idempotencyKey: "  " }),
  ]) assert.throws(() => parseCreateExpense(payload), ExpenseRequestError);
  assert.throws(() => parseUpdateExpense({ notes: "changed" }), /reason is required/);
  assert.throws(() => parseVoidExpense({ reason: "  " }), /reason is required/);
  assert.throws(() => parseExpenseListQuery({ includeVoided: "yes" }), /includeVoided must be true or false/);
  assert.throws(() => parseExpenseListQuery({ fromDate: "2026-12-01", toDate: "2026-11-01" }), /fromDate must not be later/);
});

test("Addis date and month boundaries normalize to local midnight instants", () => {
  const nov = parseCreateExpense(createPayload({ expenseDate: "2026-11-01" }));
  assert.equal(nov.expenseDate.toISOString(), "2026-10-31T21:00:00.000Z");
  assert.equal(nov.periodMonth.toISOString(), "2026-10-31T21:00:00.000Z");
  const custom = parseCreateExpense(createPayload({ expenseDate: "2026-11-24", periodMonth: "2026-10" }));
  assert.equal(custom.periodMonth.toISOString(), "2026-09-30T21:00:00.000Z");
});

test("MANAGER is read-only, OWNER can manage, and EMPLOYEE has no access", async () => {
  const makeResponse = () => ({ status(code: number) { this.code = code; return this; }, json(_body: unknown) { return this; }, code: undefined as number | undefined }) as unknown as Response;
  const request = (role: string) => ({ businessPrincipal: { role } } as unknown as Request);
  const managerRes = makeResponse();
  assert.equal(requireExpenseReadAccess(request("MANAGER"), managerRes), true);
  const managerWriteRes = makeResponse();
  assert.equal(requireExpenseManageAccess(request("MANAGER"), managerWriteRes), false);
  assert.equal((managerWriteRes as unknown as { code: number }).code, 403);
  assert.equal(requireExpenseManageAccess(request("OWNER"), makeResponse()), true);
  assert.equal(requireExpenseReadAccess(request("EMPLOYEE"), makeResponse()), false);
});

test("create controller derives tenant from membership and never returns idempotency metadata", async (t) => {
  const db = expenseDb(); t.after(db.restore);
  const { state, response } = stateResponse();
  const req = {
    body: createPayload({ businessId: "business-a" }),
    businessPrincipal: { businessId: "business-a", userId: "user-a", membershipId: "membership-a", role: "ACCOUNTANT" },
  } as unknown as Request;
  await createExpenseController(req, response);
  assert.equal(state.status, 201);
  const json = JSON.stringify(state.body);
  assert.equal(json.includes("idempotencyKey"), false);
  assert.equal(json.includes("requestHash"), false);

  const foreign = expenseDb(); t.after(foreign.restore);
  const blocked = stateResponse();
  await createExpenseController({ ...req, body: createPayload({ businessId: "business-b" }) } as unknown as Request, blocked.response);
  assert.equal(blocked.state.status, 403);
  assert.equal(foreign.state.expenses.length, 0);
});

test("CSRF middleware rejects missing token and accepts matching allowed-origin token", async () => {
  function invoke(headers: Record<string, string>) {
    let statusCode: number | undefined;
    let continued = false;
    const req = { get(name: string) { return headers[name.toLowerCase()]; }, headers: { cookie: headers.cookie } } as unknown as Request;
    const res = { status(code: number) { statusCode = code; return this; }, json(_body: unknown) { return this; } } as unknown as Response;
    requireCsrf(req, res, (() => { continued = true; }) as never);
    return { statusCode, continued };
  }
  assert.deepEqual(invoke({ origin: "http://localhost:5173", cookie: "garmentbiz_csrf=abc" }), { statusCode: 403, continued: false });
  assert.deepEqual(invoke({ origin: "http://localhost:5173", cookie: "garmentbiz_csrf=abc", "x-csrf-token": "abc" }), { statusCode: undefined, continued: true });
});
