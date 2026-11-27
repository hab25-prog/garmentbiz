import type { CreateExpenseFields } from "../types/expense.types";

export interface PendingExpenseCreate {
  key: string;
  fingerprint: string;
  version: 1;
}

export interface NormalizedExpenseCreateRequest {
  category: CreateExpenseFields["category"];
  paymentMethod: CreateExpenseFields["paymentMethod"];
  description: string;
  amount: string;
  expenseDate: string;
  periodMonth: string;
  employeeId: string | null;
  reference: string | null;
  notes: string | null;
}

export type ExpenseRetryStorageError =
  | "invalid-business"
  | "invalid-request"
  | "storage-unavailable"
  | "malformed-storage"
  | "secure-crypto-unavailable";

export type ExpenseRetryResult =
  | { ok: true; pending: PendingExpenseCreate; reused: boolean }
  | { ok: false; error: ExpenseRetryStorageError };

export type ExpenseRetryReadResult =
  | { ok: true; pending: PendingExpenseCreate[] }
  | { ok: false; error: "invalid-business" | "storage-unavailable" | "malformed-storage" };

const STORAGE_PREFIX = "garmentbiz:expense-create-retry:v1:";
const STORAGE_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

function getStorage(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function keyForBusiness(businessId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(businessId)}`;
}

function isPendingExpenseCreate(value: unknown): value is PendingExpenseCreate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3 &&
    record.version === STORAGE_VERSION &&
    typeof record.key === "string" && UUID_PATTERN.test(record.key) &&
    typeof record.fingerprint === "string" && FINGERPRINT_PATTERN.test(record.fingerprint);
}

function decodePending(raw: string): PendingExpenseCreate[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isPendingExpenseCreate)) return null;
    const keys = new Set(parsed.map((entry: PendingExpenseCreate) => entry.key));
    const fingerprints = new Set(parsed.map((entry: PendingExpenseCreate) => entry.fingerprint));
    if (keys.size !== parsed.length || fingerprints.size !== parsed.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

function normalizeOptional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** Canonical fields and ordering match the normalized request the API hashes. */
export function normalizeExpenseCreateRequest(
  input: CreateExpenseFields,
): NormalizedExpenseCreateRequest | null {
  if (typeof input.description !== "string" || typeof input.amount !== "string" ||
      typeof input.expenseDate !== "string") return null;

  const description = input.description.trim();
  const amountInput = input.amount.trim();
  if (!description || [...description].length > 500 || !AMOUNT_PATTERN.test(amountInput) ||
      !isCalendarDate(input.expenseDate)) return null;

  const [whole, fraction = ""] = amountInput.split(".");
  const normalizedAmount = `${whole}.${fraction.padEnd(2, "0")}`;
  if (/^0+\.0{2}$/.test(normalizedAmount)) return null;

  let periodMonth: string;
  if (input.periodMonth === undefined || input.periodMonth === null || input.periodMonth === "") {
    periodMonth = input.expenseDate.slice(0, 7);
  } else if (/^(\d{4})-(\d{2})$/.test(input.periodMonth)) {
    const [, year, month] = /^(\d{4})-(\d{2})$/.exec(input.periodMonth)!;
    if (Number(year) < 1 || Number(month) < 1 || Number(month) > 12) return null;
    periodMonth = input.periodMonth;
  } else {
    return null;
  }

  const employeeId = normalizeOptional(input.employeeId);
  const reference = normalizeOptional(input.reference);
  const notes = normalizeOptional(input.notes);
  if ((employeeId && [...employeeId].length > 128) ||
      (reference && [...reference].length > 128) ||
      (notes && [...notes].length > 2000)) return null;

  return {
    category: input.category,
    paymentMethod: input.paymentMethod,
    description,
    amount: normalizedAmount,
    expenseDate: input.expenseDate,
    periodMonth,
    employeeId,
    reference,
    notes,
  };
}

async function fingerprintRequest(request: NormalizedExpenseCreateRequest): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const canonical = JSON.stringify({
    category: request.category,
    paymentMethod: request.paymentMethod,
    description: request.description,
    amount: request.amount,
    expenseDate: request.expenseDate,
    periodMonth: request.periodMonth,
    employeeId: request.employeeId,
    reference: request.reference,
    notes: request.notes,
  });
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function createKey(): string | null {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function prepareExpenseCreateRetry(
  businessId: string,
  input: CreateExpenseFields,
): Promise<ExpenseRetryResult> {
  if (!businessId.trim()) return { ok: false, error: "invalid-business" };
  const normalized = normalizeExpenseCreateRequest(input);
  if (!normalized) return { ok: false, error: "invalid-request" };
  const fingerprint = await fingerprintRequest(normalized);
  if (!fingerprint) return { ok: false, error: "secure-crypto-unavailable" };
  const store = getStorage();
  if (!store) return { ok: false, error: "storage-unavailable" };

  try {
    const storageKey = keyForBusiness(businessId);
    const raw = store.getItem(storageKey);
    const pending = raw === null ? [] : decodePending(raw);
    if (!pending) return { ok: false, error: "malformed-storage" };
    const existing = pending.find((entry) => entry.fingerprint === fingerprint);
    if (existing) return { ok: true, pending: existing, reused: true };

    const key = createKey();
    if (!key) return { ok: false, error: "secure-crypto-unavailable" };
    const record: PendingExpenseCreate = { key, fingerprint, version: STORAGE_VERSION };
    store.setItem(storageKey, JSON.stringify([...pending, record]));
    return { ok: true, pending: record, reused: false };
  } catch {
    return { ok: false, error: "storage-unavailable" };
  }
}

export function readPendingExpenseCreates(businessId: string): ExpenseRetryReadResult {
  if (!businessId.trim()) return { ok: false, error: "invalid-business" };
  const store = getStorage();
  if (!store) return { ok: false, error: "storage-unavailable" };
  try {
    const raw = store.getItem(keyForBusiness(businessId));
    if (raw === null) return { ok: true, pending: [] };
    const pending = decodePending(raw);
    return pending ? { ok: true, pending } : { ok: false, error: "malformed-storage" };
  } catch {
    return { ok: false, error: "storage-unavailable" };
  }
}

/** Call only after the server confirms creation; unrelated unresolved retries are retained. */
export function clearExpenseCreateRetry(
  businessId: string,
  fingerprint: string,
  expectedKey: string,
): boolean {
  if (!businessId.trim() || !FINGERPRINT_PATTERN.test(fingerprint) || !UUID_PATTERN.test(expectedKey)) return false;
  const store = getStorage();
  if (!store) return false;
  try {
    const storageKey = keyForBusiness(businessId);
    const raw = store.getItem(storageKey);
    if (raw === null) return true;
    const pending = decodePending(raw);
    if (!pending) return false;
    const remaining = pending.filter((entry) => !(entry.fingerprint === fingerprint && entry.key === expectedKey));
    if (remaining.length === pending.length) return true;
    if (remaining.length === 0) store.removeItem(storageKey);
    else store.setItem(storageKey, JSON.stringify(remaining));
    return true;
  } catch {
    return false;
  }
}
