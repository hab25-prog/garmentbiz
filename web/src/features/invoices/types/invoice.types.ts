export type InvoiceStatus = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface InvoicePayment {
  id: string;
  amount: string;
  method: "CASH" | "BANK_TRANSFER" | "MOBILE_MONEY" | "CARD" | "OTHER";
  paymentDate: string;
  reference: string | null;
  notes: string | null;
}

export interface InvoicePaymentSummary {
  totalPaid: string;
  outstandingBalance: string;
  paymentStatus: InvoiceStatus;
  currency: "ETB";
}

export interface CreateInvoicePaymentInput {
  amount: string;
  method: InvoicePayment["method"];
  paymentDate?: string;
  reference?: string;
  notes?: string;
  idempotencyKey: string;
}

export interface RecordInvoicePaymentResult {
  payment: InvoicePayment;
  invoiceTotal: string;
  paidAmount: string;
  outstandingBalance: string;
  invoiceStatus: InvoiceStatus;
  replayed: boolean;
}

export interface InvoicePaymentHistory {
  invoiceId: string;
  invoiceNo: string;
  invoiceTotal: string;
  totalPaid: string;
  outstandingBalance: string;
  invoiceStatus: InvoiceStatus;
  currency: "ETB";
  payments: InvoicePayment[];
}

export interface Invoice {
  id: string;
  businessId: string;
  customerId: string;
  orderId: string | null;
  invoiceNo: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string | null;
  subtotal: string;
  discount: string;
  tax: string;
  totalAmount: string;
  notes: string | null;
  items: InvoiceItem[];
  payments?: InvoicePayment[];
  paymentSummary?: InvoicePaymentSummary;
}
