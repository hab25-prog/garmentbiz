export interface PaymentRequestFingerprintInput {
  invoiceId: string;
  amount: string;
  method: string;
  paymentDate?: string;
  reference?: string;
  notes?: string;
}

export interface PendingPaymentSubmission {
  key: string;
  fingerprint: string;
  version: 1;
}

export interface PendingPaymentRead {
  pending: PendingPaymentSubmission[];
  storageAvailable: boolean;
}

const STORAGE_PREFIX = "garmentbiz:invoice-payment-retry:v1:";
const STORAGE_EVENT = "garmentbiz:invoice-payment-retry-change";
const STORAGE_NONE = "__none__";
const STORAGE_UNAVAILABLE = "__unavailable__";
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(invoiceId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(invoiceId)}`;
}

function validRecord(value: unknown): value is PendingPaymentSubmission {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.includes("version") || !keys.includes("key") || !keys.includes("fingerprint")) return false;
  const record = value as Partial<PendingPaymentSubmission>;
  return record.version === 1 && typeof record.key === "string" && KEY_PATTERN.test(record.key) &&
    typeof record.fingerprint === "string" && FINGERPRINT_PATTERN.test(record.fingerprint);
}

function validRecords(value: unknown): PendingPaymentSubmission[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(validRecord);
}

function decodeRecords(raw: string): PendingPaymentSubmission[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (validRecord(parsed)) return [parsed]; // Upgrade the earlier single-record format without losing an unresolved retry.
    return validRecords(parsed);
  } catch {
    return null;
  }
}

export function readPendingPayment(invoiceId: string): PendingPaymentRead {
  const store = storage();
  if (!store) return { pending: [], storageAvailable: false };
  const key = storageKey(invoiceId);
  try {
    const raw = store.getItem(key);
    if (raw === null) return { pending: [], storageAvailable: true };
    const records = decodeRecords(raw);
    return records ? { pending: records, storageAvailable: true } : { pending: [], storageAvailable: true };
  } catch {
    return { pending: [], storageAvailable: false };
  }
}

export function pendingPaymentSnapshot(invoiceId: string | null): string {
  if (!invoiceId) return STORAGE_NONE;
  const store = storage();
  if (!store) return STORAGE_UNAVAILABLE;
  try {
    const value = store.getItem(storageKey(invoiceId));
    return value === null ? STORAGE_NONE : `value:${value}`;
  } catch {
    return STORAGE_UNAVAILABLE;
  }
}

export function subscribeToPendingPayment(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(STORAGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(STORAGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function parsePendingPaymentSnapshot(snapshot: string): PendingPaymentRead {
  if (snapshot === STORAGE_UNAVAILABLE) return { pending: [], storageAvailable: false };
  if (snapshot === STORAGE_NONE) return { pending: [], storageAvailable: true };
  if (!snapshot.startsWith("value:")) return { pending: [], storageAvailable: false };
  const records = decodeRecords(snapshot.slice("value:".length));
  return { pending: records ?? [], storageAvailable: true };
}

function notifyStorageChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STORAGE_EVENT));
}

export function savePendingPayment(invoiceId: string, pending: PendingPaymentSubmission): boolean {
  const store = storage();
  if (!store || !validRecord(pending)) return false;
  try {
    const key = storageKey(invoiceId);
    const raw = store.getItem(key);
    const records = raw === null ? [] : decodeRecords(raw);
    if (records === null) return false;
    const matchingFingerprint = records.find((record) => record.fingerprint === pending.fingerprint);
    if (matchingFingerprint) return matchingFingerprint.key === pending.key;
    if (records.some((record) => record.key === pending.key)) return false;
    store.setItem(key, JSON.stringify([...records, pending]));
    notifyStorageChanged();
    return true;
  } catch {
    return false;
  }
}

export function clearPendingPayment(invoiceId: string, fingerprint: string, expectedKey: string): boolean {
  const store = storage();
  if (!store) return false;
  const key = storageKey(invoiceId);
  try {
    const raw = store.getItem(key);
    if (!raw) return true;
    const records = decodeRecords(raw);
    if (records === null) {
      store.removeItem(key);
      notifyStorageChanged();
      return true;
    }
    const remaining = records.filter((record) => !(record.fingerprint === fingerprint && record.key === expectedKey));
    if (remaining.length !== records.length) {
      if (remaining.length === 0) store.removeItem(key);
      else store.setItem(key, JSON.stringify(remaining));
      notifyStorageChanged();
    }
    return true;
  } catch {
    return false;
  }
}

export async function fingerprintPaymentRequest(input: PaymentRequestFingerprintInput): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure payment retry protection is unavailable in this browser. Use a secure connection and try again.");
  }
  const [whole, fraction = ""] = input.amount.split(".");
  const canonical = JSON.stringify({
    invoiceId: input.invoiceId,
    amount: `${whole}.${fraction.padEnd(2, "0")}`,
    method: input.method,
    paymentDate: input.paymentDate ? `${input.paymentDate}T00:00:00.000Z` : null,
    reference: input.reference?.trim() || null,
    notes: input.notes?.trim() || null,
  });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createPaymentIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("Secure payment retry protection is unavailable in this browser. Try again on a secure connection.");
}
