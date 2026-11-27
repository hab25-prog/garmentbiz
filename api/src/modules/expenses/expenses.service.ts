import { createHash } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";
import {
  derivePeriodMonth,
  localDateForSnapshot,
  localMonthForSnapshot,
  type CreateExpenseInput,
  type ExpenseFieldsInput,
  type ExpenseListInput,
  type UpdateExpenseInput,
  type VoidExpenseInput,
} from "./expenses.validation.js";

const MAX_TRANSACTION_ATTEMPTS = 3;
const D = Prisma.Decimal;

export class ExpenseServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "ExpenseServiceError";
  }
}

export interface ExpenseActorContext {
  businessId: string;
  userId: string;
  membershipId: string;
}

const expenseResponseInclude = {
  employee: { select: { id: true, fullName: true, employeeCode: true, isActive: true } },
} satisfies Prisma.ExpenseInclude;

const auditResponseSelect = {
  id: true,
  action: true,
  reason: true,
  previousValues: true,
  newValues: true,
  actorUserId: true,
  actorMembershipId: true,
  actorNameSnapshot: true,
  createdAt: true,
} satisfies Prisma.ExpenseAuditLogSelect;

type Transaction = Prisma.TransactionClient;

function knownErrorCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

function snapshot(expense: {
  id: string;
  businessId: string;
  category: string;
  paymentMethod: string | null;
  description: string;
  amount: Prisma.Decimal;
  expenseDate: Date;
  periodMonth: Date;
  employeeId: string | null;
  reference: string | null;
  notes: string | null;
  voidedAt: Date | null;
  voidedByUserId: string | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Prisma.InputJsonObject {
  return {
    id: expense.id,
    businessId: expense.businessId,
    category: expense.category,
    paymentMethod: expense.paymentMethod,
    description: expense.description,
    amount: expense.amount.toFixed(2),
    expenseDate: localDateForSnapshot(expense.expenseDate),
    periodMonth: localMonthForSnapshot(expense.periodMonth),
    employeeId: expense.employeeId,
    reference: expense.reference,
    notes: expense.notes,
    voidedAt: expense.voidedAt?.toISOString() ?? null,
    voidedByUserId: expense.voidedByUserId,
    voidReason: expense.voidReason,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

async function validateActor(tx: Transaction, actor: ExpenseActorContext, mutation: boolean) {
  const membership = await tx.membership.findFirst({
    where: {
      id: actor.membershipId,
      businessId: actor.businessId,
      userId: actor.userId,
      isActive: true,
      business: { is: { isActive: true } },
      user: { is: { isActive: true } },
    },
    select: {
      id: true,
      businessId: true,
      userId: true,
      role: true,
      user: { select: { fullName: true } },
    },
  });
  if (!membership) throw new ExpenseServiceError("Active business membership is required", 403);

  const canView = ["OWNER", "ADMIN", "ACCOUNTANT", "MANAGER"].includes(membership.role);
  const canManage = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(membership.role);
  if ((mutation && !canManage) || (!mutation && !canView)) {
    throw new ExpenseServiceError("You do not have permission to manage expenses", 403);
  }
  return {
    userId: membership.userId,
    membershipId: membership.id,
    name: membership.user.fullName,
  };
}

async function validateEmployee(tx: Transaction, businessId: string, employeeId: string | null) {
  if (!employeeId) return;
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, businessId },
    select: { id: true },
  });
  if (!employee) throw new ExpenseServiceError("Employee not found for this business", 400);
}

function requestHash(input: ExpenseFieldsInput): string {
  const canonical = JSON.stringify({
    category: input.category,
    paymentMethod: input.paymentMethod,
    description: input.description,
    amount: input.amount.toFixed(2),
    expenseDate: localDateForSnapshot(input.expenseDate),
    periodMonth: localMonthForSnapshot(input.periodMonth),
    employeeId: input.employeeId,
    reference: input.reference,
    notes: input.notes,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function createdAuditWhere(businessId: string, idempotencyKey: string) {
  return { businessId, action: "CREATED" as const, idempotencyKey };
}

async function readCreateReplay(
  tx: Transaction,
  businessId: string,
  idempotencyKey: string,
  hash: string,
) {
  const audit = await tx.expenseAuditLog.findFirst({
    where: createdAuditWhere(businessId, idempotencyKey),
    include: { expense: true },
  });
  if (!audit) return null;
  if (audit.requestHash !== hash) {
    throw new ExpenseServiceError("This idempotency key was already used for a different expense request", 409);
  }
  return audit.expense;
}

async function recoverCreateConflict(
  businessId: string,
  input: Pick<CreateExpenseInput, "idempotencyKey" | "requestHash">,
) {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      const expense = await prisma.$transaction(
        (tx) => readCreateReplay(tx, businessId, input.idempotencyKey, input.requestHash),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 },
      );
      if (!expense) {
        throw new ExpenseServiceError("Expense request conflicted with another operation. Retry using the same idempotency key", 409);
      }
      return { expense, replayed: true };
    } catch (error) {
      if (knownErrorCode(error) === "P2034" && attempt < MAX_TRANSACTION_ATTEMPTS - 1) continue;
      if (knownErrorCode(error) === "P2034") {
        throw new ExpenseServiceError("Expense conflict could not be resolved safely. Retry using the same idempotency key", 409);
      }
      throw error;
    }
  }
  throw new ExpenseServiceError("Expense conflict could not be resolved safely. Retry using the same idempotency key", 409);
}

export async function createExpense(
  actor: ExpenseActorContext,
  input: Omit<CreateExpenseInput, "requestHash">,
) {
  const normalized: CreateExpenseInput = { ...input, requestHash: requestHash(input) };
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      const expense = await prisma.$transaction(async (tx) => {
        const identity = await validateActor(tx, actor, true);
        const replay = await readCreateReplay(tx, actor.businessId, normalized.idempotencyKey, normalized.requestHash);
        if (replay) return { expense: replay, replayed: true };

        await validateEmployee(tx, actor.businessId, normalized.employeeId);
        const created = await tx.expense.create({
          data: {
            businessId: actor.businessId,
            employeeId: normalized.employeeId,
            category: normalized.category,
            paymentMethod: normalized.paymentMethod,
            description: normalized.description,
            amount: normalized.amount,
            expenseDate: normalized.expenseDate,
            periodMonth: normalized.periodMonth,
            reference: normalized.reference,
            notes: normalized.notes,
          },
        });
        await tx.expenseAuditLog.create({
          data: {
            businessId: actor.businessId,
            expenseId: created.id,
            actorUserId: identity.userId,
            actorMembershipId: identity.membershipId,
            actorNameSnapshot: identity.name,
            action: "CREATED",
            reason: null,
            previousValues: Prisma.DbNull,
            newValues: snapshot(created),
            idempotencyKey: normalized.idempotencyKey,
            requestHash: normalized.requestHash,
          },
        });
        return { expense: created, replayed: false };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      });
      return expense;
    } catch (error) {
      if (knownErrorCode(error) === "P2034") {
        if (attempt < MAX_TRANSACTION_ATTEMPTS - 1) continue;
        return recoverCreateConflict(actor.businessId, normalized);
      }
      if (knownErrorCode(error) === "P2002") return recoverCreateConflict(actor.businessId, normalized);
      throw error;
    }
  }
  throw new ExpenseServiceError("Expense could not be created. Retry using the same idempotency key", 409);
}

function expenseWhere(businessId: string, id: string, includeVoided: boolean) {
  return { id, businessId, ...(includeVoided ? {} : { voidedAt: null }) };
}

export async function listExpenses(businessId: string, filters: ExpenseListInput) {
  const where: Prisma.ExpenseWhereInput = {
    businessId,
    ...(filters.includeVoided ? {} : { voidedAt: null }),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
    ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
    ...(filters.periodMonth ? { periodMonth: filters.periodMonth } : {}),
    ...(filters.expenseDateFrom || filters.expenseDateToExclusive
      ? { expenseDate: {
          ...(filters.expenseDateFrom ? { gte: filters.expenseDateFrom } : {}),
          ...(filters.expenseDateToExclusive ? { lt: filters.expenseDateToExclusive } : {}),
        } }
      : {}),
    ...(filters.search ? { OR: [
      { description: { contains: filters.search, mode: "insensitive" } },
      { reference: { contains: filters.search, mode: "insensitive" } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: expenseResponseInclude,
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.expense.count({ where }),
  ]);
  return { items, total, page: filters.page, pageSize: filters.pageSize, pageCount: Math.ceil(total / filters.pageSize) };
}

export async function getExpense(businessId: string, expenseId: string, includeVoided = true) {
  return prisma.expense.findFirst({
    where: expenseWhere(businessId, expenseId, includeVoided),
    include: {
      ...expenseResponseInclude,
      auditLogs: {
        where: { businessId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: auditResponseSelect,
      },
    },
  });
}

async function lockExpense(tx: Transaction, businessId: string, expenseId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${expenseId} AND "businessId" = ${businessId} FOR UPDATE`;
  return tx.expense.findFirst({ where: { id: expenseId, businessId } });
}

function mergeEditableFields(current: NonNullable<Awaited<ReturnType<typeof lockExpense>>>, patch: UpdateExpenseInput): ExpenseFieldsInput {
  const expenseDate = patch.expenseDate ?? current.expenseDate;
  return {
    category: patch.category ?? current.category,
    paymentMethod: patch.paymentMethod ?? current.paymentMethod as ExpenseFieldsInput["paymentMethod"],
    description: patch.description ?? current.description,
    amount: patch.amount ?? new D(current.amount),
    expenseDate,
    periodMonth: patch.periodMonth instanceof Date
      ? patch.periodMonth
      : (patch.expenseDate || Object.hasOwn(patch, "periodMonth") ? derivePeriodMonth(expenseDate) : current.periodMonth),
    employeeId: patch.employeeId === undefined ? current.employeeId : patch.employeeId,
    reference: patch.reference === undefined ? current.reference : patch.reference,
    notes: patch.notes === undefined ? current.notes : patch.notes,
  };
}

export async function updateExpense(actor: ExpenseActorContext, expenseId: string, patch: UpdateExpenseInput) {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await lockExpense(tx, actor.businessId, expenseId);
        if (!current) return null;
        if (current.voidedAt) throw new ExpenseServiceError("Voided expenses cannot be edited", 409);
        const identity = await validateActor(tx, actor, true);
        const fields = mergeEditableFields(current, patch);
        await validateEmployee(tx, actor.businessId, fields.employeeId);
        const previousValues = snapshot(current);
        const updated = await tx.expense.update({ where: { id: current.id }, data: fields });
        await tx.expenseAuditLog.create({
          data: {
            businessId: actor.businessId,
            expenseId: current.id,
            actorUserId: identity.userId,
            actorMembershipId: identity.membershipId,
            actorNameSnapshot: identity.name,
            action: "UPDATED",
            reason: patch.reason,
            previousValues,
            newValues: snapshot(updated),
          },
        });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 });
    } catch (error) {
      if (knownErrorCode(error) === "P2034" && attempt < MAX_TRANSACTION_ATTEMPTS - 1) continue;
      if (knownErrorCode(error) === "P2034") throw new ExpenseServiceError("Expense update conflicted with another change. Please retry", 409);
      throw error;
    }
  }
  throw new ExpenseServiceError("Expense update could not be completed", 409);
}

export async function voidExpense(actor: ExpenseActorContext, expenseId: string, input: VoidExpenseInput) {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await lockExpense(tx, actor.businessId, expenseId);
        if (!current) return null;
        if (current.voidedAt) throw new ExpenseServiceError("Expense has already been voided", 409);
        const identity = await validateActor(tx, actor, true);
        const voidedAt = new Date();
        const updated = await tx.expense.update({
          where: { id: current.id },
          data: { voidedAt, voidedByUserId: identity.userId, voidReason: input.reason },
        });
        await tx.expenseAuditLog.create({
          data: {
            businessId: actor.businessId,
            expenseId: current.id,
            actorUserId: identity.userId,
            actorMembershipId: identity.membershipId,
            actorNameSnapshot: identity.name,
            action: "VOIDED",
            reason: input.reason,
            previousValues: snapshot(current),
            newValues: snapshot(updated),
          },
        });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 });
    } catch (error) {
      if (knownErrorCode(error) === "P2034" && attempt < MAX_TRANSACTION_ATTEMPTS - 1) continue;
      if (knownErrorCode(error) === "P2034") throw new ExpenseServiceError("Expense void conflicted with another change. Please retry", 409);
      throw error;
    }
  }
  throw new ExpenseServiceError("Expense void could not be completed", 409);
}
