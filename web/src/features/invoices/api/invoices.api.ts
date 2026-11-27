import { ApiError, apiClient } from "../../../lib/api-client";
import type { CreateInvoicePaymentInput, Invoice, InvoicePaymentHistory, RecordInvoicePaymentResult } from "../types/invoice.types";

export const invoicesApi = {
  async getForOrder(orderId: string): Promise<Invoice | null> {
    try {
      return await apiClient.get<Invoice>(`/api/orders/${encodeURIComponent(orderId)}/invoice`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  createForOrder: (orderId: string) =>
    apiClient.post<Invoice>(`/api/orders/${encodeURIComponent(orderId)}/invoice`, {}),
  issue: (invoiceId: string) =>
    apiClient.post<Invoice>(`/api/invoices/${encodeURIComponent(invoiceId)}/issue`, {}),
  getById: (invoiceId: string) =>
    apiClient.get<Invoice>(`/api/invoices/${encodeURIComponent(invoiceId)}`),
  getPaymentHistory: (invoiceId: string) =>
    apiClient.get<InvoicePaymentHistory>(`/api/invoices/${encodeURIComponent(invoiceId)}/payments`),
  recordPayment: (invoiceId: string, input: CreateInvoicePaymentInput) =>
    apiClient.post<RecordInvoicePaymentResult>(`/api/invoices/${encodeURIComponent(invoiceId)}/payments`, input),
};
