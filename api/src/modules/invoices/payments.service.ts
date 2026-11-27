import { createHash } from "node:crypto";
import { Prisma, PaymentMethod } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";
import { InvoiceServiceError } from "./invoices.service.js";

const D = Prisma.Decimal;
const MAX_AMOUNT = new D("999999999999.99");
const PAYMENT_METHODS = new Set<string>(Object.values(PaymentMethod));
const MAX_TRANSACTION_ATTEMPTS = 3;

export interface RecordPaymentInput {
  amount: unknown;
  method: unknown;
  paymentDate?: unknown;
  reference?: unknown;
  notes?: unknown;
  idempotencyKey: unknown;
}

interface NormalizedPayment {
  amount: Prisma.Decimal;
  method: PaymentMethod;
  paymentDate: Date;
  reference: string | null;
  notes: string | null;
  idempotencyKey: string;
  requestHash: string;
}

function normalizePayment(invoiceId: string, input: RecordPaymentInput): NormalizedPayment {
  if (typeof input.amount !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(input.amount.trim())) {
    throw new InvoiceServiceError("Amount must be a positive monetary value with up to two decimal places", 400);
  }
  const amount = new D(input.amount.trim());
  if (!amount.isFinite() || !amount.greaterThan(0) || amount.greaterThan(MAX_AMOUNT)) {
    throw new InvoiceServiceError("Amount must be greater than zero and within supported monetary precision", 400);
  }
  if (typeof input.method !== "string" || !PAYMENT_METHODS.has(input.method)) {
    throw new InvoiceServiceError("Payment method must be CASH, BANK_TRANSFER, MOBILE_MONEY, CARD, or OTHER", 400);
  }

  const dateWasProvided = input.paymentDate !== undefined;
  let paymentDate = new Date();
  let normalizedDate: string | null = null;
  if (dateWasProvided) {
    if (typeof input.paymentDate !== "string" || !input.paymentDate.trim()) {
      throw new InvoiceServiceError("Payment date must be a valid date string", 400);
    }
    paymentDate = parsePaymentDate(input.paymentDate.trim());
    normalizedDate = paymentDate.toISOString();
  }

  if (typeof input.idempotencyKey !== "string") {
    throw new InvoiceServiceError("Idempotency key is required", 400);
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || [...idempotencyKey].length > 128) {
    throw new InvoiceServiceError("Idempotency key must contain 1 to 128 characters", 400);
  }

  const normalizeOptional = (value: unknown, name: string, maximum: number): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") throw new InvoiceServiceError(`${name} must be a string`, 400);
    const normalized = value.trim();
    if ([...normalized].length > maximum) throw new InvoiceServiceError(`${name} cannot exceed ${maximum} characters`, 400);
    return normalized || null;
  };
  const reference = normalizeOptional(input.reference, "Reference", 128);
  const notes = normalizeOptional(input.notes, "Notes", 2000);

  // Canonical JSON property order, decimal amount at scale 2, trimmed optional text,
  // uppercase enum value, and ISO date. Omitted paymentDate hashes as null so retries
  // remain identical even though the persisted default timestamp is captured per request.
  const canonicalRequest = JSON.stringify({
    invoiceId,
    amount: amount.toFixed(2),
    method: input.method,
    paymentDate: normalizedDate,
    reference,
    notes,
  });
  const requestHash = createHash("sha256").update(canonicalRequest, "utf8").digest("hex");

  return {
    amount,
    method: input.method as PaymentMethod,
    paymentDate,
    reference,
    notes,
    idempotencyKey,
    requestHash,
  };
}

/** Accepts YYYY-MM-DD or RFC3339 timestamps with seconds, optional millisecond precision,
 * and an explicit Z or ±HH:MM offset. Date-only values are interpreted as UTC midnight. */
function parsePaymentDate(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  const match = dateOnly ?? dateTime;
  if (!match) throw new InvoiceServiceError("Payment date must use YYYY-MM-DD or RFC3339 date-time with a timezone", 400);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = dateOnly ? 0 : Number(match[4]);
  const minute = dateOnly ? 0 : Number(match[5]);
  const second = dateOnly ? 0 : Number(match[6]);
  const milliseconds = dateOnly || !match[7] ? 0 : Number(match[7].padEnd(3, "0"));
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw new InvoiceServiceError("Payment date contains an invalid calendar or time value", 400);
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    throw new InvoiceServiceError("Payment date contains an impossible calendar date", 400);
  }

  let offsetMinutes = 0;
  const zone = dateOnly ? "Z" : match[8];
  if (zone && zone.toUpperCase() !== "Z") {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutePart = Number(zone.slice(4, 6));
    if (offsetHours > 14 || offsetMinutePart > 59 || (offsetHours === 14 && offsetMinutePart !== 0)) {
      throw new InvoiceServiceError("Payment date contains an invalid timezone offset", 400);
    }
    offsetMinutes = (offsetHours * 60 + offsetMinutePart) * (zone[0] === "+" ? 1 : -1);
  }

  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, milliseconds);
  const instant = new Date(utc.getTime() - offsetMinutes * 60_000);
  if (Number.isNaN(instant.getTime())) throw new InvoiceServiceError("Payment date is outside the supported range", 400);
  return instant;
}

function retryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function paymentSummary(invoiceTotal: Prisma.Decimal, paidAmount: Prisma.Decimal) {
  return {
    invoiceTotal,
    paidAmount,
    outstandingBalance: invoiceTotal.sub(paidAmount),
  };
}

function assertNoOverpayment(invoiceTotal: Prisma.Decimal, paidAmount: Prisma.Decimal): Prisma.Decimal {
  if (!invoiceTotal.isFinite() || invoiceTotal.isNegative()) {
    throw new InvoiceServiceError("Invoice total is invalid for payment", 409);
  }
  const outstanding = invoiceTotal.sub(paidAmount);
  if (outstanding.isNegative()) {
    throw new InvoiceServiceError("Invoice payments already exceed its total. Resolve the balance discrepancy before continuing", 409);
  }
  return outstanding;
}

async function recoverUniqueConflict(businessId: string, invoiceId: string, normalized: NormalizedPayment) {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} AND "businessId" = ${businessId} FOR UPDATE`;
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, businessId, customer: { is: { businessId } } },
          select: { id: true, totalAmount: true, status: true },
        });
        if (!invoice) throw new InvoiceServiceError("Payment request conflicted, and the invoice is unavailable", 409);
        const existing = await tx.payment.findFirst({
          where: { businessId, invoiceId, idempotencyKey: normalized.idempotencyKey },
        });
        if (!existing) throw new InvoiceServiceError("Payment request conflicted with another operation. Please retry using the same idempotency key", 409);
        if (existing.requestHash !== normalized.requestHash) {
          throw new InvoiceServiceError("This idempotency key was already used for a different payment request", 409);
        }
        const aggregate = await tx.payment.aggregate({ where: { businessId, invoiceId }, _sum: { amount: true } });
        const paidAmount = aggregate._sum.amount ?? new D(0);
        const outstandingBalance = assertNoOverpayment(invoice.totalAmount, paidAmount);
        return {
          payment: existing,
          invoiceTotal: invoice.totalAmount,
          paidAmount,
          outstandingBalance,
          invoiceStatus: invoice.status,
          replayed: true,
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      });
    } catch (error) {
      if (retryable(error) && attempt < MAX_TRANSACTION_ATTEMPTS - 1) continue;
      if (retryable(error)) {
        throw new InvoiceServiceError("Payment conflict could not be resolved safely. Please retry with the same idempotency key", 409);
      }
      throw error;
    }
  }
  throw new InvoiceServiceError("Payment conflict could not be resolved safely. Please retry with the same idempotency key", 409);
}

export async function recordInvoicePayment(businessId: string, invoiceId: string, input: RecordPaymentInput) {
  const normalized = normalizePayment(invoiceId, input);
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} AND "businessId" = ${businessId} FOR UPDATE`;
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, businessId, customer: { is: { businessId } } },
          select: { id: true, totalAmount: true, status: true },
        });
        if (!invoice) return null;

        const existing = await tx.payment.findFirst({
          where: { businessId, invoiceId, idempotencyKey: normalized.idempotencyKey },
        });
        if (existing) {
          if (existing.requestHash !== normalized.requestHash) {
            throw new InvoiceServiceError("This idempotency key was already used for a different payment request", 409);
          }
          const paid = await tx.payment.aggregate({ where: { businessId, invoiceId }, _sum: { amount: true } });
          const paidAmount = paid._sum.amount ?? new D(0);
          const outstandingBalance = assertNoOverpayment(invoice.totalAmount, paidAmount);
          return {
            payment: existing,
            invoiceTotal: invoice.totalAmount,
            paidAmount,
            outstandingBalance,
            invoiceStatus: invoice.status,
            replayed: true,
          };
        }

        if (invoice.status !== "ISSUED" && invoice.status !== "PARTIALLY_PAID") {
          throw new InvoiceServiceError("Payments can only be recorded for issued or partially paid invoices", 409);
        }
        const previous = await tx.payment.aggregate({ where: { businessId, invoiceId }, _sum: { amount: true } });
        const previousPaid = previous._sum.amount ?? new D(0);
        const outstanding = assertNoOverpayment(invoice.totalAmount, previousPaid);
        if (normalized.amount.greaterThan(outstanding)) {
          throw new InvoiceServiceError(`Payment exceeds the outstanding balance of ${outstanding.toFixed(2)} ETB`, 409);
        }

        const payment = await tx.payment.create({
          data: {
            businessId,
            invoiceId,
            amount: normalized.amount,
            method: normalized.method,
            paymentDate: normalized.paymentDate,
            reference: normalized.reference,
            notes: normalized.notes,
            idempotencyKey: normalized.idempotencyKey,
            requestHash: normalized.requestHash,
          },
        });
        const current = await tx.payment.aggregate({ where: { businessId, invoiceId }, _sum: { amount: true } });
        const paidAmount = current._sum.amount ?? new D(0);
        const balance = assertNoOverpayment(invoice.totalAmount, paidAmount);
        const status = paidAmount.isZero()
          ? "ISSUED"
          : balance.isZero()
            ? "PAID"
            : "PARTIALLY_PAID";
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status },
        });

        return {
          payment,
          ...paymentSummary(invoice.totalAmount, paidAmount),
          invoiceStatus: status,
          replayed: false,
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      });
    } catch (error) {
      if (retryable(error)) {
        if (attempt < MAX_TRANSACTION_ATTEMPTS - 1) continue;
        throw new InvoiceServiceError("Payment could not be recorded after a serialization conflict. Please retry", 409);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return recoverUniqueConflict(businessId, invoiceId, normalized);
      }
      throw error;
    }
  }
  throw new InvoiceServiceError("Payment could not be recorded after a serialization conflict. Please retry", 409);
}
