import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

const D = Prisma.Decimal;

const paymentHistorySelect = {
  id: true,
  amount: true,
  method: true,
  paymentDate: true,
  reference: true,
  notes: true,
} satisfies Prisma.PaymentSelect;

const paymentHistoryOrder = [
  { paymentDate: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.PaymentOrderByWithRelationInput[];

type PaymentHistoryRow = {
  id: string;
  amount: Prisma.Decimal;
  method: import("../../../generated/prisma/client.js").PaymentMethod;
  paymentDate: Date;
  reference: string | null;
  notes: string | null;
};

function withPaymentSummary<T extends {
  totalAmount: Prisma.Decimal;
  status: string;
  payments: PaymentHistoryRow[];
}>(invoice: T) {
  const payments = invoice.payments.map((payment) => ({
    id: payment.id,
    amount: payment.amount,
    method: payment.method,
    paymentDate: payment.paymentDate,
    reference: payment.reference,
    notes: payment.notes,
  }));
  const totalPaid = payments.reduce((sum, payment) => sum.add(payment.amount), new D(0));
  const outstandingBalance = invoice.totalAmount.sub(totalPaid);
  if (!invoice.totalAmount.isFinite() || invoice.totalAmount.isNegative() || outstandingBalance.isNegative()) {
    throw new InvoiceServiceError("Invoice payment history exceeds or conflicts with the invoice total", 409);
  }

  return {
    ...invoice,
    payments,
    paymentSummary: {
      totalPaid,
      outstandingBalance,
      paymentStatus: invoice.status,
      currency: "ETB" as const,
    },
  };
}

export class InvoiceServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "InvoiceServiceError";
  }
}

function retryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function createOrderInvoice(businessId: string, orderId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${orderId} AND "businessId" = ${businessId} FOR UPDATE`;
        const order = await tx.customerOrder.findFirst({
          where: { id: orderId, businessId },
          include: {
            customer: { select: { id: true, businessId: true } },
            items: { include: { product: { select: { name: true } } } },
            invoice: { select: { id: true } },
          },
        });
        if (!order) return null;
        if (order.status === "CANCELLED") {
          throw new InvoiceServiceError("Cancelled orders cannot be invoiced", 409);
        }
        if (order.customer.businessId !== businessId) {
          throw new InvoiceServiceError("Order customer is outside this business", 409);
        }
        if (order.invoice) {
          throw new InvoiceServiceError("An invoice already exists for this order", 409);
        }
        if (order.items.length === 0) {
          throw new InvoiceServiceError("An order must have at least one item before it can be invoiced", 409);
        }

        const subtotal = new D(order.totalAmount);
        if (!subtotal.isFinite() || subtotal.isNegative()) {
          throw new InvoiceServiceError("Order total is invalid for invoicing", 409);
        }
        const discount = new D(0);
        const tax = new D(0);
        const totalAmount = subtotal.sub(discount);
        const invoiceNo = `INV-${order.orderNo}`;

        return tx.invoice.create({
          data: {
            businessId,
            customerId: order.customerId,
            orderId: order.id,
            invoiceNo,
            status: "DRAFT",
            subtotal,
            discount,
            tax,
            totalAmount,
            items: {
              create: order.items.map((item) => ({
                description: item.description?.trim() || item.product.name,
                quantity: item.quantity,
                unitPrice: new D(item.unitPrice),
                lineTotal: new D(item.lineTotal),
              })),
            },
          },
          include: { customer: true, order: true, items: true, payments: true },
        });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      });
    } catch (error) {
      if (retryable(error) && attempt < 2) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new InvoiceServiceError("An invoice already exists for this order", 409);
      }
      throw error;
    }
  }
  throw new InvoiceServiceError("Invoice could not be created. Please try again", 409);
}

export async function getOrderInvoice(businessId: string, orderId: string) {
  const order = await prisma.customerOrder.findFirst({
    where: { id: orderId, businessId },
    select: { id: true, customerId: true },
  });
  if (!order) return null;
  return prisma.invoice.findFirst({
    where: { businessId, orderId, customerId: order.customerId, customer: { is: { businessId } } },
    include: {
      customer: true,
      order: true,
      items: true,
      payments: { where: { businessId }, orderBy: paymentHistoryOrder, select: paymentHistorySelect },
    },
  }).then((invoice) => invoice ? withPaymentSummary(invoice) : null);
}

export async function getInvoice(businessId: string, invoiceId: string) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, businessId, customer: { is: { businessId } } },
    include: {
      customer: true,
      order: true,
      items: true,
      payments: { where: { businessId }, orderBy: paymentHistoryOrder, select: paymentHistorySelect },
    },
  }).then((invoice) => invoice ? withPaymentSummary(invoice) : null);
}

export async function getInvoicePaymentHistory(businessId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, businessId, customer: { is: { businessId } } },
    select: {
      id: true,
      invoiceNo: true,
      totalAmount: true,
      status: true,
      payments: { where: { businessId }, orderBy: paymentHistoryOrder, select: paymentHistorySelect },
    },
  });
  if (!invoice) return null;
  const summarized = withPaymentSummary(invoice);
  return {
    invoiceId: summarized.id,
    invoiceNo: summarized.invoiceNo,
    invoiceTotal: summarized.totalAmount,
    totalPaid: summarized.paymentSummary.totalPaid,
    outstandingBalance: summarized.paymentSummary.outstandingBalance,
    invoiceStatus: summarized.status,
    currency: summarized.paymentSummary.currency,
    payments: summarized.payments,
  };
}

export async function issueInvoice(businessId: string, invoiceId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} AND "businessId" = ${businessId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, businessId },
      include: {
        customer: { select: { businessId: true } },
        order: { select: { businessId: true, customerId: true } },
      },
    });
    if (!invoice) return null;
    if (invoice.customer.businessId !== businessId ||
        (invoice.order && (invoice.order.businessId !== businessId || invoice.order.customerId !== invoice.customerId))) {
      throw new InvoiceServiceError("Invoice customer or order is outside this business", 409);
    }
    if (invoice.status !== "DRAFT") {
      throw new InvoiceServiceError("Only draft invoices can be issued", 409);
    }
    return tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "ISSUED", issueDate: new Date() },
      include: { customer: true, order: true, items: true, payments: true },
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10000,
    timeout: 20000,
  });
}
