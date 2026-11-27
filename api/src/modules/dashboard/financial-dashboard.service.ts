import { Prisma } from "../../../generated/prisma/client.js";
import type { ExpenseCategory } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";
import { getOperationalPeriodBounds, type OperationalPeriod } from "./dashboard.service.js";

const D = Prisma.Decimal;
const invoiceStatuses = ["ISSUED", "PARTIALLY_PAID", "PAID"] as const;
const expenseCategories: readonly ExpenseCategory[] = [
  "SALARY",
  "RENT",
  "UTILITIES",
  "TRANSPORT",
  "MAINTENANCE",
  "SUPPLIES",
  "OTHER",
];

function fixedMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function isUsageReconciled(usage: {
  issuedQuantity: Prisma.Decimal;
  consumedQuantity: Prisma.Decimal;
  returnedQuantity: Prisma.Decimal;
  wastedQuantity: Prisma.Decimal;
}): boolean {
  return usage.issuedQuantity.equals(
    usage.consumedQuantity.add(usage.returnedQuantity).add(usage.wastedQuantity),
  );
}

/**
 * Aggregates recorded business financial activity. These figures are not profit:
 * labor, overhead allocation, taxes, supplier payments, refunds, and payment reversals
 * are not comprehensively represented by the current models.
 */
interface FinancialRange {
  key: string;
  timeZone: string;
  start: Date;
  endExclusive: Date;
}

async function aggregateFinancialRange(businessId: string, bounds: FinancialRange) {
  const range = { gte: bounds.start, lt: bounds.endExclusive };

  const [
    invoicedSalesAggregate,
    paymentsReceivedAggregate,
    voidInvoicePaymentsAggregate,
    materialPurchasesAggregate,
    expenseGroups,
    eligibleInvoices,
    productionUsages,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { businessId, status: { in: [...invoiceStatuses] }, issueDate: range },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    // Aggregate payments independently: joining invoices, items, or other one-to-many
    // relations here could multiply receipt totals. Recorded payments remain receipts
    // even if their invoice was later voided; the separate warning below exposes those.
    prisma.payment.aggregate({
      where: {
        businessId,
        paymentDate: range,
        invoice: { is: { businessId } },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: {
        businessId,
        paymentDate: range,
        invoice: { is: { businessId, status: "VOID" } },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.purchaseItem.aggregate({
      where: {
        purchase: {
          is: {
            businessId,
            status: "RECEIVED",
            OR: [
              { receivedAt: range },
              { receivedAt: null, purchaseDate: range },
            ],
          },
        },
      },
      _sum: { totalCost: true },
    }),
    prisma.expense.groupBy({
      by: ["category"],
      where: { businessId, voidedAt: null, expenseDate: range },
      _sum: { amount: true },
    }),
    prisma.invoice.findMany({
      where: { businessId, status: { in: [...invoiceStatuses] } },
      select: { id: true, invoiceNo: true, status: true, totalAmount: true },
    }),
    prisma.productionMaterialUsage.findMany({
      where: {
        businessId,
        recordedAt: range,
        productionBatch: { is: { businessId, status: { not: "CANCELLED" } } },
      },
      select: {
        issuedQuantity: true,
        consumedQuantity: true,
        returnedQuantity: true,
        wastedQuantity: true,
        totalCost: true,
        productionBatch: { select: { id: true, status: true } },
      },
    }),
  ]);

  const paymentGroups = eligibleInvoices.length === 0
    ? []
    : await prisma.payment.groupBy({
      by: ["invoiceId"],
      where: {
        businessId,
        invoiceId: { in: eligibleInvoices.map((invoice) => invoice.id) },
        invoice: { is: { businessId } },
      },
      _sum: { amount: true },
    });
  const paidByInvoice = new Map(
    paymentGroups.map((payment) => [payment.invoiceId, payment._sum.amount ?? new D(0)]),
  );

  let validOutstanding = new D(0);
  let overpaidInvoiceCount = 0;
  let statusMismatchInvoiceCount = 0;
  let invalidInvoiceAmountCount = 0;
  const invoiceIntegrityIssues: Array<{ invoiceNumber: string; code: string }> = [];
  for (const invoice of eligibleInvoices) {
    const total = invoice.totalAmount;
    const paid = paidByInvoice.get(invoice.id) ?? new D(0);
    if (!total.isFinite() || total.isNegative() || !paid.isFinite() || paid.isNegative()) {
      invalidInvoiceAmountCount += 1;
      invoiceIntegrityIssues.push({ invoiceNumber: invoice.invoiceNo, code: "INVALID_INVOICE_OR_PAYMENT_AMOUNT" });
      continue;
    }

    const outstanding = total.sub(paid);
    if (outstanding.isNegative()) {
      overpaidInvoiceCount += 1;
      invoiceIntegrityIssues.push({ invoiceNumber: invoice.invoiceNo, code: "OVERPAID_INVOICE" });
      continue;
    }

    const statusMismatch =
      (invoice.status === "PAID" && !outstanding.isZero()) ||
      (invoice.status === "ISSUED" && paid.greaterThan(0)) ||
      (invoice.status === "PARTIALLY_PAID" && (!paid.greaterThan(0) || outstanding.isZero()));
    if (statusMismatch) {
      statusMismatchInvoiceCount += 1;
      invoiceIntegrityIssues.push({ invoiceNumber: invoice.invoiceNo, code: "INVOICE_STATUS_BALANCE_MISMATCH" });
      continue;
    }
    validOutstanding = validOutstanding.add(outstanding);
  }

  const expenseByCategory = Object.fromEntries(
    expenseCategories.map((category) => [category, new D(0)]),
  ) as Record<ExpenseCategory, Prisma.Decimal>;
  for (const group of expenseGroups) {
    expenseByCategory[group.category] = group._sum.amount ?? new D(0);
  }
  const operatingExpenseTotal = expenseCategories.reduce(
    (total, category) => total.add(expenseByCategory[category]),
    new D(0),
  );

  let reconciledProductionMaterialCost = new D(0);
  let reconciledUsageCount = 0;
  let unreconciledUsageCount = 0;
  const activeProductionBatchIds = new Set<string>();
  for (const usage of productionUsages) {
    if (usage.productionBatch.status === "PLANNED" || usage.productionBatch.status === "IN_PROGRESS") {
      activeProductionBatchIds.add(usage.productionBatch.id);
    }
    if (!isUsageReconciled(usage)) {
      unreconciledUsageCount += 1;
      continue;
    }
    reconciledUsageCount += 1;
    reconciledProductionMaterialCost = reconciledProductionMaterialCost.add(usage.totalCost);
  }
  const activeProductionBatchCount = activeProductionBatchIds.size;
  const outstandingIsComplete =
    overpaidInvoiceCount === 0 && statusMismatchInvoiceCount === 0 && invalidInvoiceAmountCount === 0;
  const warnings: Array<{ code: string; count: number; amountETB?: string }> = [];
  if (overpaidInvoiceCount > 0) warnings.push({ code: "OVERPAID_INVOICES", count: overpaidInvoiceCount });
  if (statusMismatchInvoiceCount > 0) warnings.push({ code: "INVOICE_STATUS_BALANCE_MISMATCH", count: statusMismatchInvoiceCount });
  if (invalidInvoiceAmountCount > 0) warnings.push({ code: "INVALID_INVOICE_OR_PAYMENT_AMOUNT", count: invalidInvoiceAmountCount });
  if ((voidInvoicePaymentsAggregate._count?._all ?? 0) > 0) {
    warnings.push({
      code: "PAYMENTS_LINKED_TO_VOID_INVOICES",
      count: voidInvoicePaymentsAggregate._count?._all ?? 0,
      amountETB: fixedMoney(voidInvoicePaymentsAggregate._sum.amount ?? new D(0)),
    });
  }
  if (unreconciledUsageCount > 0) warnings.push({ code: "UNRECONCILED_PRODUCTION_USAGE", count: unreconciledUsageCount });
  if (activeProductionBatchCount > 0) warnings.push({ code: "IN_PROGRESS_PRODUCTION_USAGE", count: activeProductionBatchCount });

  return {
    period: {
      key: bounds.key,
      timeZone: bounds.timeZone,
      start: bounds.start.toISOString(),
      endExclusive: bounds.endExclusive.toISOString(),
    },
    currency: "ETB" as const,
    invoicedSales: {
      totalETB: fixedMoney(invoicedSalesAggregate._sum.totalAmount ?? new D(0)),
      invoiceCount: invoicedSalesAggregate._count._all,
    },
    paymentsReceived: {
      totalETB: fixedMoney(paymentsReceivedAggregate._sum.amount ?? new D(0)),
      paymentCount: paymentsReceivedAggregate._count?._all,
      paymentsLinkedToVoidInvoices: {
        count: voidInvoicePaymentsAggregate._count?._all ?? 0,
        amountETB: fixedMoney(voidInvoicePaymentsAggregate._sum.amount ?? new D(0)),
      },
    },
    currentOutstandingBalances: {
      totalETB: outstandingIsComplete ? fixedMoney(validOutstanding) : null,
      isComplete: outstandingIsComplete,
      eligibleInvoiceCount: eligibleInvoices.length,
      overpaidInvoiceCount,
      statusMismatchInvoiceCount,
      invalidInvoiceAmountCount,
      issues: invoiceIntegrityIssues,
    },
    receivedMaterialPurchases: {
      totalETB: fixedMoney(materialPurchasesAggregate._sum.totalCost ?? new D(0)),
    },
    operatingExpenses: {
      totalETB: fixedMoney(operatingExpenseTotal),
      byCategoryETB: Object.fromEntries(
        expenseCategories.map((category) => [category, fixedMoney(expenseByCategory[category])]),
      ) as Record<ExpenseCategory, string>,
    },
    productionMaterialCost: {
      reconciledActualETB: fixedMoney(reconciledProductionMaterialCost),
      reconciledUsageCount,
      unreconciledUsageCount,
      activeBatchCountWithUsage: activeProductionBatchCount,
      isProvisional: unreconciledUsageCount > 0 || activeProductionBatchCount > 0,
    },
    warnings,
    limitations: [
      "Payments are counted as recorded receipts even when linked to a currently void invoice; no refund or reversal ledger exists.",
      "Material purchases are acquisitions, not supplier cash payments, and are separate from operating expenses and production consumption.",
      "These figures are not profit and do not include complete labor, overhead allocation, tax, supplier payment, or refund accounting.",
      "Expense totals use current expense values by expenseDate; audit history is not a historical financial snapshot.",
    ],
  };
}

export async function getFinancialDashboard(
  businessId: string,
  period: OperationalPeriod,
  now = new Date(),
) {
  const bounds = getOperationalPeriodBounds(period, now);
  return aggregateFinancialRange(businessId, {
    key: bounds.period,
    timeZone: bounds.timeZone,
    start: bounds.start,
    endExclusive: bounds.endExclusive,
  });
}

export async function getFinancialSummaryForRange(businessId: string, start: Date, endExclusive: Date) {
  return aggregateFinancialRange(businessId, {
    key: "custom",
    timeZone: "Africa/Addis_Ababa",
    start,
    endExclusive,
  });
}
