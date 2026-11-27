import { apiClient } from "../../../lib/api-client";
import type {
  CreateExpenseRequest,
  CreateExpenseResponse,
  Expense,
  ExpenseDetail,
  ExpenseListFilters,
  PaginatedExpenses,
  UpdateExpenseRequest,
  VoidExpenseRequest,
} from "../types/expense.types";

function listQuery(filters: ExpenseListFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export const expensesApi = {
  list(filters: ExpenseListFilters = {}): Promise<PaginatedExpenses> {
    return apiClient.get<PaginatedExpenses>(`/api/expenses${listQuery(filters)}`);
  },

  getById(expenseId: string): Promise<ExpenseDetail> {
    return apiClient.get<ExpenseDetail>(`/api/expenses/${encodeURIComponent(expenseId)}`);
  },

  create(input: CreateExpenseRequest): Promise<CreateExpenseResponse> {
    return apiClient.post<CreateExpenseResponse>("/api/expenses", input);
  },

  update(expenseId: string, input: UpdateExpenseRequest): Promise<Expense> {
    return apiClient.patch<Expense>(`/api/expenses/${encodeURIComponent(expenseId)}`, input);
  },

  void(expenseId: string, input: VoidExpenseRequest): Promise<Expense> {
    return apiClient.post<Expense>(`/api/expenses/${encodeURIComponent(expenseId)}/void`, input);
  },
};
