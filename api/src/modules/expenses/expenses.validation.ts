import { ExpenseCategory, PaymentMethod, Prisma } from "../../../generated/prisma/client.js";

const TIME_ZONE = "Africa/Addis_Ababa";
const CATEGORY_VALUES = new Set<string>(Object.values(ExpenseCategory));
const PAYMENT_METHOD_VALUES = new Set<string>(Object.values(PaymentMethod));
const MAX_AMOUNT = new Prisma.Decimal("999999999999.99");
const MAX_TEXT = {
  description: 500,
  reference: 128,
  notes: 2000,
  reason: 1000,
  search: 100,
} as const;

export class ExpenseRequestError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ExpenseRequestError";
  }
}

export interface ExpenseFieldsInput {
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  description: string;
  amount: Prisma.Decimal;
  expenseDate: Date;
  periodMonth: Date;
  employeeId: string | null;
  reference: string | null;
  notes: string | null;
}

export interface CreateExpenseInput extends ExpenseFieldsInput {
  idempotencyKey: string;
  requestHash: string;
}

export interface UpdateExpenseInput extends Omit<Partial<ExpenseFieldsInput>, "periodMonth"> {
  periodMonth?: Date | null;
  reason: string;
}

export interface VoidExpenseInput {
  reason: string;
}

export interface ExpenseListInput {
  category?: ExpenseCategory;
  paymentMethod?: PaymentMethod;
  employeeId?: string;
  search?: string;
  expenseDateFrom?: Date;
  expenseDateToExclusive?: Date;
  periodMonth?: Date;
  includeVoided: boolean;
  page: number;
  pageSize: number;
}

const localDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function requiredString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string") throw new ExpenseRequestError(`${name} is required`);
  const normalized = value.trim();
  if (!normalized) throw new ExpenseRequestError(`${name} is required`);
  if ([...normalized].length > maximum) {
    throw new ExpenseRequestError(`${name} cannot exceed ${maximum} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, name: string, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ExpenseRequestError(`${name} must be a string`);
  const normalized = value.trim();
  if ([...normalized].length > maximum) {
    throw new ExpenseRequestError(`${name} cannot exceed ${maximum} characters`);
  }
  return normalized || null;
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function partsAsRecord(date: Date): Record<string, number> {
  const parts = localDateFormatter.formatToParts(date);
  const output: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") output[part.type] = Number(part.value);
  }
  return output;
}

/** Converts an Addis Ababa wall-clock date/time to the UTC instant stored by Prisma. */
function addisLocalToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const nominal = new Date(0);
  nominal.setUTCFullYear(year, month - 1, day);
  nominal.setUTCHours(hour, minute, second, 0);
  const local = partsAsRecord(nominal);
  const asUtc = new Date(0);
  asUtc.setUTCFullYear(local.year ?? 0, (local.month ?? 1) - 1, local.day ?? 1);
  asUtc.setUTCHours(local.hour ?? 0, local.minute ?? 0, local.second ?? 0, 0);
  const offset = asUtc.getTime() - nominal.getTime();
  return new Date(nominal.getTime() - offset);
}

function parseLocalDate(value: unknown, name = "expenseDate"): Date {
  if (typeof value !== "string") throw new ExpenseRequestError(`${name} must use YYYY-MM-DD format`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ExpenseRequestError(`${name} must use YYYY-MM-DD format`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validCalendarDate(year, month, day)) throw new ExpenseRequestError(`${name} is not a valid calendar date`);
  return addisLocalToUtc(year, month, day);
}

function parsePeriodMonth(value: unknown, expenseDate: Date): Date {
  if (value === undefined || value === null || value === "") {
    const parts = partsAsRecord(expenseDate);
    return addisLocalToUtc(parts.year ?? 0, parts.month ?? 1, 1);
  }
  if (typeof value !== "string") throw new ExpenseRequestError("periodMonth must use YYYY-MM format");
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new ExpenseRequestError("periodMonth must use YYYY-MM format");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) {
    throw new ExpenseRequestError("periodMonth is not a valid accounting month");
  }
  return addisLocalToUtc(year, month, 1);
}

export function derivePeriodMonth(expenseDate: Date): Date {
  const parts = partsAsRecord(expenseDate);
  return addisLocalToUtc(parts.year ?? 0, parts.month ?? 1, 1);
}

function parseAmount(value: unknown): Prisma.Decimal {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new ExpenseRequestError("amount must be a positive decimal string with at most two decimal places");
  }
  const amount = new Prisma.Decimal(value.trim());
  if (!amount.isFinite() || !amount.greaterThan(0) || amount.greaterThan(MAX_AMOUNT)) {
    throw new ExpenseRequestError("amount must be greater than zero and fit supported monetary precision");
  }
  return amount;
}

function parseCategory(value: unknown): ExpenseCategory {
  if (typeof value !== "string" || !CATEGORY_VALUES.has(value)) {
    throw new ExpenseRequestError("category must be SALARY, RENT, UTILITIES, TRANSPORT, MAINTENANCE, SUPPLIES, or OTHER");
  }
  return value as ExpenseCategory;
}

function parsePaymentMethod(value: unknown): PaymentMethod {
  if (typeof value !== "string" || !PAYMENT_METHOD_VALUES.has(value)) {
    throw new ExpenseRequestError("paymentMethod must be CASH, BANK_TRANSFER, MOBILE_MONEY, CARD, or OTHER");
  }
  return value as PaymentMethod;
}

function parseEmployeeId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, "employeeId", 128);
}

function parseEditableFields(body: Record<string, unknown>): ExpenseFieldsInput {
  const expenseDate = parseLocalDate(body.expenseDate);
  return {
    category: parseCategory(body.category),
    paymentMethod: parsePaymentMethod(body.paymentMethod),
    description: requiredString(body.description, "description", MAX_TEXT.description),
    amount: parseAmount(body.amount),
    expenseDate,
    periodMonth: parsePeriodMonth(body.periodMonth, expenseDate),
    employeeId: parseEmployeeId(body.employeeId),
    reference: optionalString(body.reference, "reference", MAX_TEXT.reference),
    notes: optionalString(body.notes, "notes", MAX_TEXT.notes),
  };
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExpenseRequestError("Expense details are required");
  }
  return value as Record<string, unknown>;
}

export function parseCreateExpense(value: unknown): Omit<CreateExpenseInput, "requestHash"> {
  const body = objectBody(value);
  const idempotencyKey = requiredString(body.idempotencyKey, "idempotencyKey", 128);
  return { ...parseEditableFields(body), idempotencyKey };
}

export function parseUpdateExpense(value: unknown): UpdateExpenseInput {
  const body = objectBody(value);
  const patch: UpdateExpenseInput = { reason: requiredString(body.reason, "reason", MAX_TEXT.reason) };
  if (Object.hasOwn(body, "category")) patch.category = parseCategory(body.category);
  if (Object.hasOwn(body, "paymentMethod")) patch.paymentMethod = parsePaymentMethod(body.paymentMethod);
  if (Object.hasOwn(body, "description")) patch.description = requiredString(body.description, "description", MAX_TEXT.description);
  if (Object.hasOwn(body, "amount")) patch.amount = parseAmount(body.amount);
  if (Object.hasOwn(body, "expenseDate")) patch.expenseDate = parseLocalDate(body.expenseDate);
  if (Object.hasOwn(body, "periodMonth")) {
    patch.periodMonth = body.periodMonth === null || body.periodMonth === ""
      ? null
      : parsePeriodMonth(body.periodMonth, patch.expenseDate ?? new Date());
  }
  if (Object.hasOwn(body, "employeeId")) patch.employeeId = parseEmployeeId(body.employeeId);
  if (Object.hasOwn(body, "reference")) patch.reference = optionalString(body.reference, "reference", MAX_TEXT.reference);
  if (Object.hasOwn(body, "notes")) patch.notes = optionalString(body.notes, "notes", MAX_TEXT.notes);
  if (Object.keys(patch).length === 1) throw new ExpenseRequestError("At least one expense field must be updated");
  return patch;
}

export function parseVoidExpense(value: unknown): VoidExpenseInput {
  const body = objectBody(value);
  return { reason: requiredString(body.reason, "reason", MAX_TEXT.reason) };
}

function parseEnumFilter<T extends string>(value: unknown, allowed: Set<string>, name: string): T | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !allowed.has(value)) throw new ExpenseRequestError(`${name} is invalid`);
  return value as T;
}

function parseInteger(value: unknown, fallback: number, name: string, maximum: number): number {
  if (value === undefined || value === "") return fallback;
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isSafeInteger(numberValue) || numberValue < 1 || numberValue > maximum) {
    throw new ExpenseRequestError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return numberValue;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new ExpenseRequestError("includeVoided must be true or false");
}

export function parseExpenseListQuery(value: unknown): ExpenseListInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExpenseRequestError("Invalid expense filters");
  }
  const query = value as Record<string, unknown>;
  const expenseDateFrom = query.fromDate === undefined || query.fromDate === "" ? undefined : parseLocalDate(query.fromDate, "fromDate");
  const expenseDateTo = query.toDate === undefined || query.toDate === "" ? undefined : parseLocalDate(query.toDate, "toDate");
  if (expenseDateFrom && expenseDateTo && expenseDateFrom > expenseDateTo) {
    throw new ExpenseRequestError("fromDate must not be later than toDate");
  }
  let expenseDateToExclusive: Date | undefined;
  if (query.toDate !== undefined && query.toDate !== "") {
    const match = typeof query.toDate === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(query.toDate) : null;
    if (!match) throw new ExpenseRequestError("toDate must use YYYY-MM-DD format");
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const nextDay = new Date(0);
    nextDay.setUTCFullYear(year, month - 1, day + 1);
    nextDay.setUTCHours(0, 0, 0, 0);
    expenseDateToExclusive = addisLocalToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate());
  }
  const periodMonth = query.periodMonth === undefined || query.periodMonth === "" ? undefined : parsePeriodMonth(query.periodMonth, new Date());
  const search = optionalString(query.search, "search", MAX_TEXT.search);
  const employeeId = query.employeeId === undefined || query.employeeId === "" ? undefined : requiredString(query.employeeId, "employeeId", 128);
  const category = parseEnumFilter<ExpenseCategory>(query.category, CATEGORY_VALUES, "category");
  const paymentMethod = parseEnumFilter<PaymentMethod>(query.paymentMethod, PAYMENT_METHOD_VALUES, "paymentMethod");
  return {
    ...(category ? { category } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(search ? { search } : {}),
    ...(expenseDateFrom ? { expenseDateFrom } : {}),
    ...(expenseDateToExclusive ? { expenseDateToExclusive } : {}),
    ...(periodMonth ? { periodMonth } : {}),
    includeVoided: parseBoolean(query.includeVoided, false),
    page: parseInteger(query.page, 1, "page", 1_000_000),
    pageSize: parseInteger(query.pageSize, 25, "pageSize", 100),
  };
}

export function localDateForSnapshot(value: Date): string {
  const parts = partsAsRecord(value);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function localMonthForSnapshot(value: Date): string {
  const parts = partsAsRecord(value);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`;
}
