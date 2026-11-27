export interface Customer {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerInput {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export type ReceivableInvoiceStatus = "ISSUED" | "PARTIALLY_PAID" | "PAID";

export interface CustomerReceivablesResponse {
  customer: Pick<Customer, "id" | "name" | "phone" | "email" | "address">;
  receivables: {
    currency: "ETB";
    totalOutstanding: string;
    totalInvoiced: string;
    totalPaid: string;
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      issueDate: string;
      dueDate: string | null;
      status: ReceivableInvoiceStatus;
      total: string;
      paidAmount: string;
      outstandingBalance: string;
    }>;
  };
}
