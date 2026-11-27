import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoicesApi } from "../api/invoices.api";
import type { CreateInvoicePaymentInput } from "../types/invoice.types";

export const invoiceKeys = {
  forOrder: (orderId: string) => ["orders", orderId, "invoice"] as const,
  detail: (invoiceId: string) => ["invoices", invoiceId] as const,
  payments: (invoiceId: string) => ["invoices", invoiceId, "payments"] as const,
};

export function useOrderInvoice(orderId: string | null) {
  return useQuery({
    queryKey: invoiceKeys.forOrder(orderId ?? ""),
    queryFn: () => invoicesApi.getForOrder(orderId!),
    enabled: Boolean(orderId),
  });
}

function useInvalidateInvoice(orderId: string) {
  const queryClient = useQueryClient();
  return async (invoiceId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: invoiceKeys.forOrder(orderId) }),
      queryClient.invalidateQueries({ queryKey: ["orders", orderId] }),
      ...(invoiceId ? [queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) })] : []),
    ]);
  };
}

export function useCreateOrderInvoice(orderId: string) {
  const invalidate = useInvalidateInvoice(orderId);
  return useMutation({
    mutationFn: () => invoicesApi.createForOrder(orderId),
    onSuccess: (invoice) => invalidate(invoice.id),
  });
}

export function useIssueInvoice(orderId: string) {
  const invalidate = useInvalidateInvoice(orderId);
  return useMutation({
    mutationFn: (invoiceId: string) => invoicesApi.issue(invoiceId),
    onSuccess: (invoice) => invalidate(invoice.id),
  });
}

export function useRecordInvoicePayment(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { invoiceId: string; customerId: string; payment: CreateInvoicePaymentInput }) =>
      invoicesApi.recordPayment(variables.invoiceId, variables.payment),
    onSuccess: (_result, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(variables.invoiceId) }),
      queryClient.invalidateQueries({ queryKey: invoiceKeys.payments(variables.invoiceId) }),
      queryClient.invalidateQueries({ queryKey: invoiceKeys.forOrder(orderId) }),
      queryClient.invalidateQueries({ queryKey: ["orders", orderId] }),
      queryClient.invalidateQueries({ queryKey: ["customers", variables.customerId, "receivables"] }),
    ]),
  });
}
