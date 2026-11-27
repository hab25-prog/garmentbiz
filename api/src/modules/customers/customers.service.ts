import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

const D = Prisma.Decimal;

export class CustomerReceivablesError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "CustomerReceivablesError";
  }
}

export interface CreateCustomerInput {
  businessId: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export async function createCustomer(input: CreateCustomerInput) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  return prisma.customer.create({
    data: {
      businessId: input.businessId,
      name: input.name,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

export async function getCustomers(businessId: string) {
  return prisma.customer.findMany({
    where: {
      businessId,
      isActive: true,
    },
    orderBy: {
      name: "asc",
    },
  });
}

export async function getCustomerReceivables(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      invoices: {
        where: { businessId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          invoiceNo: true,
          issueDate: true,
          dueDate: true,
          status: true,
          totalAmount: true,
          payments: {
            where: { businessId },
            select: { amount: true },
          },
        },
      },
    },
  });
  if (!customer) return null;

  let totalInvoiced = new D(0);
  let totalPaid = new D(0);
  let totalOutstanding = new D(0);

  const invoices = customer.invoices.map((invoice) => {
    const paidAmount = invoice.payments.reduce((sum, payment) => sum.add(payment.amount), new D(0));
    const outstandingBalance = invoice.totalAmount.sub(paidAmount);
    if (
      !invoice.totalAmount.isFinite() || invoice.totalAmount.isNegative() ||
      !paidAmount.isFinite() || paidAmount.isNegative() || outstandingBalance.isNegative()
    ) {
      throw new CustomerReceivablesError(`Invoice ${invoice.invoiceNo} has an invalid or overpaid historical balance`);
    }
    if (
      (invoice.status === "PAID" && !outstandingBalance.isZero()) ||
      (invoice.status === "ISSUED" && paidAmount.greaterThan(0)) ||
      (invoice.status === "PARTIALLY_PAID" && (!paidAmount.greaterThan(0) || outstandingBalance.isZero()))
    ) {
      throw new CustomerReceivablesError(`Invoice ${invoice.invoiceNo} has a payment total inconsistent with its status`);
    }

    totalInvoiced = totalInvoiced.add(invoice.totalAmount);
    totalPaid = totalPaid.add(paidAmount);
    totalOutstanding = totalOutstanding.add(outstandingBalance);

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNo,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      total: invoice.totalAmount,
      paidAmount,
      outstandingBalance,
    };
  });

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
    },
    receivables: {
      currency: "ETB" as const,
      totalOutstanding,
      totalInvoiced,
      totalPaid,
      invoices,
    },
  };
}
