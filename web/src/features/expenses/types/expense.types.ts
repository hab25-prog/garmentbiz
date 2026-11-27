export type ExpenseCategory =
  | "SALARY"
  | "RENT"
  | "UTILITIES"
  | "TRANSPORT"
  | "MAINTENANCE"
  | "SUPPLIES"
  | "OTHER";

export type ExpensePaymentMethod =
  | "CASH"
  | "BANK_TRANSFER"
  | "MOBILE_MONEY"
  | "CARD"
  | "OTHER";

export type ExpenseAuditAction = "CREATED" | "UPDATED" | "VOIDED";

export interface ExpenseEmployeeSummary {
  id: string;
  fullName: string;
  employeeCode: string | null;
  isActive: boolean;
}

/** Exact values copied into ExpenseAuditLog JSON snapshots. */
export interface ExpenseAuditSnapshot {
  id: string;
  businessId: string;
  category: ExpenseCategory;
  paymentMethod: ExpensePaymentMethod | null;
  description: string;
  /** Monetary values are serialized as decimal strings. */
  amount: string;
  /** Addis Ababa local calendar date in YYYY-MM-DD format. */
  expenseDate: string;
  /** Addis Ababa accounting month in YYYY-MM format. */
  periodMonth: string;
  employeeId: string | null;
  reference: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidedByUserId: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseAuditEntry {
  id: string;
  action: ExpenseAuditAction;
  reason: string | null;
  previousValues: ExpenseAuditSnapshot | null;
  newValues: ExpenseAuditSnapshot;
  actorUserId: string;
  actorMembershipId: string;
  actorNameSnapshot: string;
  createdAt: string;
}

/** Expense row returned by the Prisma-backed service. Decimal fields stay strings. */
export interface Expense {
  id: string;
  businessId: string;
  employeeId: string | null;
  category: ExpenseCategory;
  /** Nullable only for historical rows created before the API required a method. */
  paymentMethod: ExpensePaymentMethod | null;
  description: string;
  amount: string;
  expenseDate: string;
  periodMonth: string;
  reference: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidedByUserId: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseListItem extends Expense {
  employee: ExpenseEmployeeSummary | null;
}

export interface ExpenseDetail extends Expense {
  employee: ExpenseEmployeeSummary | null;
  auditLogs: ExpenseAuditEntry[];
}

export interface CreateExpenseFields {
  category: ExpenseCategory;
  paymentMethod: ExpensePaymentMethod;
  description: string;
  /** Exact positive decimal string, up to two fractional digits. */
  amount: string;
  /** Required Addis Ababa calendar date in YYYY-MM-DD format. */
  expenseDate: string;
  /** Optional accounting month in YYYY-MM format; null or omission derives it from expenseDate. */
  periodMonth?: string | null;
  employeeId?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export interface CreateExpenseRequest extends CreateExpenseFields {
  idempotencyKey: string;
}

export interface CreateExpenseResponse extends Expense {
  replayed: boolean;
}

export interface UpdateExpenseRequest {
  category?: ExpenseCategory;
  paymentMethod?: ExpensePaymentMethod;
  description?: string;
  amount?: string;
  expenseDate?: string;
  /** On update, null derives from expenseDate; omission preserves the month unless expenseDate changes. */
  periodMonth?: string | null;
  employeeId?: string | null;
  reference?: string | null;
  notes?: string | null;
  reason: string;
}

export interface VoidExpenseRequest {
  reason: string;
}

export interface ExpenseListFilters {
  category?: ExpenseCategory;
  paymentMethod?: ExpensePaymentMethod;
  employeeId?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  periodMonth?: string;
  includeVoided?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PaginatedExpenses {
  items: ExpenseListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
