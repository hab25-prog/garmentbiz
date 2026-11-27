import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { expensesApi } from "../api/expenses.api";
import type {
  CreateExpenseRequest,
  ExpenseListFilters,
  UpdateExpenseRequest,
  VoidExpenseRequest,
} from "../types/expense.types";

export const expenseKeys = {
  all: ["expenses"] as const,
  lists: ["expenses", "list"] as const,
  list: (filters: ExpenseListFilters = {}) => ["expenses", "list", filters] as const,
  detail: (expenseId: string) => ["expenses", "detail", expenseId] as const,
};

export function useExpenses(filters: ExpenseListFilters = {}) {
  return useQuery({
    queryKey: expenseKeys.list(filters),
    queryFn: () => expensesApi.list(filters),
  });
}

export function useExpense(expenseId: string | null) {
  return useQuery({
    queryKey: expenseKeys.detail(expenseId ?? ""),
    queryFn: () => expensesApi.getById(expenseId!),
    enabled: Boolean(expenseId),
    refetchOnMount: "always",
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseRequest) => expensesApi.create(input),
    onSuccess: async (expense) => Promise.all([
      queryClient.invalidateQueries({ queryKey: expenseKeys.lists }),
      queryClient.invalidateQueries({ queryKey: expenseKeys.detail(expense.id) }),
    ]),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { expenseId: string; input: UpdateExpenseRequest }) =>
      expensesApi.update(variables.expenseId, variables.input),
    onSuccess: (_expense, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: expenseKeys.lists }),
      queryClient.invalidateQueries({ queryKey: expenseKeys.detail(variables.expenseId) }),
    ]),
  });
}

export function useVoidExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { expenseId: string; input: VoidExpenseRequest }) =>
      expensesApi.void(variables.expenseId, variables.input),
    onSuccess: (_expense, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: expenseKeys.lists }),
      queryClient.invalidateQueries({ queryKey: expenseKeys.detail(variables.expenseId) }),
    ]),
  });
}
